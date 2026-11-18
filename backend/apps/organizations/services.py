"""Organization and membership business logic.

One person belongs to at most one institution: a live (not deprovisioned) membership is unique per user
(`uniq_membership_one_institution`). A sign-up's choice of institution is only a pending request until the
person's verified email turns out to be on one of the institution's sign-in domains.
"""
import zlib

from django.db import IntegrityError, connection, transaction
from django.db.models import Q

from apps.accounts.models import Account
from apps.audit.services import record_audit
from apps.invitations.errors import ServiceError

from .models import InstitutionalIdentityProvider, Membership, Organization
from .validators import email_domain, email_domain_matches

CONFIRMED_STATUSES = (Membership.Status.ACTIVE, Membership.Status.SUSPENDED)
SIGN_IN_DOMAINS_LOCK = zlib.crc32(b"organizations.sign_in_domains")


def member_of_other_institution():
    """409 for anyone who already belongs to another institution; which one is not disclosed."""
    return ServiceError(
        "member_of_other_institution",
        "This person already belongs to another institution. BDREN AI support can move them if that is wrong.",
        status=409,
    )


def _audit(*, actor, action, membership, source, ip_address=None, **values):
    meta = {k: v for k, v in values.items() if v not in (None, "")}
    record_audit(
        actor=actor, action=action, target_type="Membership", target_id=str(membership.id),
        metadata={**meta, "source": source, "organization_id": str(membership.organization_id),
                  "user_id": str(membership.user_id)},
        ip_address=ip_address,
    )


# ---------------------------------------------------------------- one institution per person

def ensure_single_institution(user, organization, *, source, actor=None, ip_address=None):
    """Raises 409 `member_of_other_institution` if `user` is active or suspended in another institution. A pending
    sign-up request elsewhere is dropped (audited): joining through an invitation or the institution's own sign-in
    is stronger proof than an unconfirmed choice. Call inside the transaction that then writes the membership."""
    others = list(
        Membership.objects.select_for_update()
        .filter(user=user)
        .exclude(organization=organization)
        .exclude(status=Membership.Status.DEPROVISIONED)
    )
    if any(m.status in CONFIRMED_STATUSES for m in others):
        raise member_of_other_institution()
    for request in others:
        _audit(
            actor=actor, action="membership.request_dropped", membership=request, source=source,
            ip_address=ip_address, reason="joined_other_institution", joined_organization_id=str(organization.id),
        )
        request.delete()


def save_membership(membership, update_fields=None):
    """Saves in a savepoint; a concurrent join into another institution (unique live membership) becomes 409."""
    try:
        with transaction.atomic():
            membership.save(update_fields=update_fields)
    except IntegrityError:
        raise member_of_other_institution() from None
    return membership


# ---------------------------------------------------------------- sign-up requests

def request_institution(user, organization, *, ip_address=None):
    """Records a sign-up's choice of `organization` as a pending, not covered membership. Nothing is recorded for
    someone who already belongs to an institution. Confirmed by `confirm_signup_institution`."""
    if Membership.objects.filter(user=user).exclude(status=Membership.Status.DEPROVISIONED).exists():
        return None
    membership = Membership(
        user=user, organization=organization, status=Membership.Status.PENDING, coverage=Membership.Coverage.NONE
    )
    try:
        save_membership(membership)
    except ServiceError:
        return None
    if user.email_verified:
        return confirm_signup_institution(user, ip_address=ip_address)
    return membership


def confirm_signup_institution(user, *, ip_address=None):
    """Runs when `user`'s email is verified: a pending sign-up request becomes an active, not covered membership if the
    email is on one of the institution's sign-in domains (subdomains included); otherwise the request is removed and
    the person belongs to no institution. Both outcomes are audited. Returns the membership or None."""
    if not user.email_verified:
        return None
    with transaction.atomic():
        request = (
            Membership.objects.select_for_update(of=("self",)).select_related("organization")
            .filter(user=user, status=Membership.Status.PENDING).first()
        )
        if request is None:
            return None
        org = request.organization
        if org.status != Organization.Status.DEACTIVATED and email_domain_matches(org, user.email):
            request.status = Membership.Status.ACTIVE
            request.coverage = Membership.Coverage.NONE
            request.save(update_fields=["status", "coverage"])
            _audit(
                actor=user, action="membership.confirmed", membership=request, source="signup", ip_address=ip_address,
            )
            return request
        reason = "institution_inactive" if org.status == Organization.Status.DEACTIVATED else "domain_mismatch"
        _audit(
            actor=user, action="membership.request_dropped", membership=request, source="signup",
            ip_address=ip_address, reason=reason, email_domain=email_domain(user.email or ""),
        )
        request.delete()
    return None


# ---------------------------------------------------------------- sign-in domains

def lock_sign_in_domains():
    """Serializes changes to any institution's sign-in domains (a transaction-scoped advisory lock), so two
    institutions cannot claim the same domain at once. Call inside transaction.atomic()."""
    with connection.cursor() as cursor:
        cursor.execute("SELECT pg_advisory_xact_lock(%s)", [SIGN_IN_DOMAINS_LOCK])


def domains_in_use(domains, *, exclude=None):
    """`{domain: Organization}` for each of `domains` that another institution already lists. `exclude` is the
    institution being edited."""
    if not domains:
        return {}
    query = Q()
    for domain in domains:
        query |= Q(sign_in_domains__contains=[domain])
    taken = {}
    for org in Organization.objects.filter(query).exclude(pk=getattr(exclude, "pk", None)).order_by("name"):
        for domain in domains:
            if domain in org.sign_in_domains:
                taken.setdefault(domain, org)
    return taken


def ensure_domains_free(domains, *, exclude=None):
    """409 `domain_taken` when another institution already lists one of `domains` (a domain confirms one
    institution only). Takes the sign-in domains lock first; call inside the transaction that saves them."""
    lock_sign_in_domains()
    taken = domains_in_use(domains, exclude=exclude)
    if not taken:
        return
    names = "; ".join(f"{domain} belongs to {org.name}" for domain, org in taken.items())
    raise ServiceError(
        "domain_taken", "A sign-in domain can belong to one institution only.", status=409,
        fields={"sign_in_domains": names + "."},
        extra={"conflicts": [{"domain": d, "institution": {"slug": o.slug, "name": o.name}} for d, o in taken.items()]},
    )


# ---------------------------------------------------------------- organizations

@transaction.atomic
def create_organization(*, name, slug, zitadel_organization_id=None, owner_user=None, **details):
    """`details` are further Organization fields (type, timezone, contact_email, sign_in_domains, seat_cap, ...)."""
    org = Organization.objects.create(
        name=name,
        slug=slug,
        zitadel_organization_id=zitadel_organization_id,
        **details,
    )
    Account.objects.create(
        account_type=Account.Type.ORGANIZATION,
        organization=org,
        owner_user=owner_user,
    )
    if owner_user is not None:
        ensure_single_institution(owner_user, org, source="organization_created")
        save_membership(Membership(
            user=owner_user, organization=org, role=Membership.Role.OWNER, status=Membership.Status.ACTIVE,
        ))
    return org


@transaction.atomic
def add_or_update_membership(*, user, organization, role=Membership.Role.MEMBER, status=Membership.Status.ACTIVE,
                             coverage=Membership.Coverage.INSTITUTION):
    """Low-level upsert (no seat check, no audit) for provisioning and tests; refuses a second institution."""
    if status != Membership.Status.DEPROVISIONED:
        ensure_single_institution(user, organization, source="provisioning")
    membership = Membership.objects.filter(user=user, organization=organization).first() or Membership(
        user=user, organization=organization
    )
    membership.role, membership.status, membership.coverage = role, status, coverage
    return save_membership(membership)


@transaction.atomic
def register_institutional_idp(*, organization, name, protocol, zitadel_idp_id, issuer_or_entity_id, auto_join_role=Membership.Role.MEMBER):
    return InstitutionalIdentityProvider.objects.create(
        organization=organization,
        name=name,
        protocol=protocol,
        zitadel_idp_id=zitadel_idp_id,
        issuer_or_entity_id=issuer_or_entity_id,
        auto_join_role=auto_join_role,
    )
