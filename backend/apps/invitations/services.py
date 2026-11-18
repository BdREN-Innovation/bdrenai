"""Institution-wide seats, invitations, member imports and membership changes.

Shared by the superadmin API, the institution-admin portal and the public acceptance endpoints.
Every operation that can add a seat locks the organization row (`lock_organization`) and checks the
cap (`ensure_seats`) in the same transaction. Rows are always locked organization first, then
invitation/membership, so concurrent operations cannot deadlock.

Coverage: a membership is `covered` (coverage `institution`, on the institution's package, holding a seat while
active or suspended) or only affiliated (coverage `none`: the free tier, or a personal plan). Inviting or importing
an affiliated free-tier member covers that same account at once; a personal-plan member gets a consent
invitation, and accepting it stops their personal plan from renewing. Invitations accept any email domain.
"""
import re
from dataclasses import dataclass, field
from datetime import timedelta

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.db import IntegrityError, transaction
from django.db.models import Count, Exists, IntegerField, OuterRef, Q, Subquery
from django.db.models.functions import Coalesce, Lower
from django.utils import timezone

from apps.accounts.models import Account
from apps.audit.models import AuditLog
from apps.audit.services import audit_entry, record_audit
from apps.organizations.models import Membership, Organization
from apps.organizations.services import (
    CONFIRMED_STATUSES,
    create_organization,
    ensure_domains_free,
    ensure_single_institution,
    member_of_other_institution,
    save_membership,
)
from apps.organizations.validators import normalize_domains, validate_slug, validate_timezone
from apps.subscriptions.plans import has_personal_plan, paid_personal_subscriptions, personal_plan_exists
from apps.subscriptions.services import resume_renewal, stop_renewal

from .emails import Outbox, covered_notice
from .errors import ServiceError, invalid
from .models import Invitation, hash_token, new_token
from .shapes import iso, serialize_member, serialize_personal_plan_member

ADMIN_ROLES = frozenset({Membership.Role.OWNER, Membership.Role.ADMIN})
PORTAL_ROLES = frozenset({Membership.Role.MEMBER, Membership.Role.ADMIN})
MAX_IMPORT_ROWS = 1000
TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{20,128}$")
CONTROL_RE = re.compile(r"[\x00-\x1f\x7f]")
OPEN_INVITATION_STATUSES = (Invitation.Status.PENDING, Invitation.Status.EXPIRED)
ROLE_RANK = {Membership.Role.MEMBER: 0, Membership.Role.BILLING: 1, Membership.Role.ADMIN: 2, Membership.Role.OWNER: 3}
SEAT_STATUSES = CONFIRMED_STATUSES
COVERED = Membership.Coverage.INSTITUTION
NOT_COVERED = Membership.Coverage.NONE


class Label:
    """How the portal shows a membership (`membership_label`)."""

    COVERED = "covered"
    INVITED = "invited"
    NOT_COVERED = "not_covered"
    PERSONAL_PLAN = "personal_plan"

    values = (COVERED, INVITED, NOT_COVERED, PERSONAL_PLAN)


# ---------------------------------------------------------------- results

@dataclass
class Invited:
    """Result of creating or resending one invitation. Read `email_sent` after the transaction commits.

    Inviting an affiliated free-tier member covers them at once instead: then `invitation` is None, `membership` is
    the covered membership and `outcome` is `covered` (the email sent is the "added to the package" notice).
    """

    invitation: Invitation | None
    outbox: Outbox
    warning: str | None = None
    membership: Membership | None = None

    @property
    def email_sent(self):
        return self.outbox.email_sent

    @property
    def outcome(self):
        return "covered" if self.membership is not None else "invited"


@dataclass
class Covered:
    membership: Membership
    outbox: Outbox

    @property
    def email_sent(self):
        return self.outbox.email_sent


@dataclass
class CreatedInstitution:
    organization: Organization
    invited: Invited | None = None


@dataclass
class Resent:
    count: int
    outbox: Outbox

    def body(self):
        return {"resent": self.count, "email_failures": self.outbox.failures, "email_queued": self.outbox.queued}


@dataclass
class ImportResult:
    rows: list
    summary: dict
    created: int = 0
    covered: int = 0
    outbox: Outbox = field(default_factory=Outbox)

    def body(self):
        return {
            "rows": self.rows,
            "summary": self.summary,
            "created": self.created,
            "covered": self.covered,
            "email_failures": self.outbox.failures,
            "email_queued": self.outbox.queued,
        }


@dataclass
class Standing:
    """What an email already is, seen from one institution (`standings`)."""

    covered: bool = False  # someone with this email is a covered member here (active or suspended)
    elsewhere: bool = False  # a verified user with this email belongs to another institution
    affiliated: list = field(default_factory=list)  # active, not covered memberships here of verified users

    @property
    def coverable(self):
        """The one affiliated free-tier membership that an invite covers directly, or None."""
        if len(self.affiliated) != 1 or self.affiliated[0].personal_plan:
            return None
        return self.affiliated[0]

    @property
    def personal_plan(self):
        return any(m.personal_plan for m in self.affiliated)

    @property
    def action(self):
        """`cover`, `consent_invite` (a personal-plan member must accept) or `invite`."""
        if self.coverable is not None:
            return "cover"
        return "consent_invite" if self.personal_plan else "invite"


# ---------------------------------------------------------------- errors

def _already_invited():
    return ServiceError(
        "already_invited", "This email already has a pending invitation. Resend it instead.", status=409
    )


def _not_pending(invitation):
    return ServiceError(
        "invitation_not_pending", "Only pending or expired invitations can be changed.",
        status=409, extra={"status": invitation.effective_status},
    )


def _bad_role():
    return ServiceError("bad_role", "This role can't be given here.", fields={"role": "Choose an allowed role."})


def _already_member():
    return ServiceError("already_member", "This person is already a member on the institution's package.", status=409)


def not_coverable():
    return ServiceError(
        "not_coverable", "Only active members who are not on the package yet can be added to it.", status=409
    )


def already_covered():
    return ServiceError("already_covered", "This person is already on the institution's package.", status=409)


def consent_required():
    return ServiceError(
        "needs_consent_invitation",
        "This person pays for their own plan. Send them an invitation; they join the package when they accept.",
        status=409,
    )


def not_covered_error(message="This person is not on the institution's package, so there is nothing to change."):
    return ServiceError("not_covered", message, status=409)


def consent_missing():
    return ServiceError(
        "personal_plan_consent_required",
        "You pay for your own plan. Confirm that it should stop renewing before you join the institution's package.",
        status=409,
    )


# ---------------------------------------------------------------- small helpers

def normalize_email(value):
    """Lowercased, trimmed email, or None if it is not a valid address."""
    email = value.strip().lower() if isinstance(value, str) else ""
    if not email or len(email) > 254:
        return None
    try:
        validate_email(email)
    except ValidationError:
        return None
    return email


def clean_name(value, limit=255):
    return CONTROL_RE.sub("", value).strip()[:limit] if isinstance(value, str) else ""


def mask_email(email):
    local, _, domain = email.partition("@")
    return f"{local[:1]}***@{domain}"


def _actor(actor):
    return actor if actor is not None and getattr(actor, "is_authenticated", False) else None


def audit_metadata(organization_id, **values):
    """Audit metadata without empty values, plus `organization_id` so the entry shows in the institution's history."""
    meta = {k: v for k, v in values.items() if v not in (None, "")}
    if organization_id:
        meta["organization_id"] = str(organization_id)
    return meta


def audit(*, actor, action, target_type, target_id, organization_id, ip_address, **values):
    return record_audit(
        actor=actor, action=action, target_type=target_type, target_id=target_id,
        metadata=audit_metadata(organization_id, **values), ip_address=ip_address,
    )


def _check_role(role, allowed_roles=None):
    if role not in (allowed_roles or Membership.Role.values):
        raise _bad_role()


def _check_open(org):
    if org.status == Organization.Status.DEACTIVATED:
        raise ServiceError("institution_inactive", "This institution has been removed.", status=409)


def _expiry(now):
    return now + timedelta(days=settings.INVITATION_TTL_DAYS)


# ---------------------------------------------------------------- seats

def count_per_organization(queryset):
    """Subquery count of `queryset` rows (filtered on `organization=OuterRef("pk")`) per organization, 0 if none."""
    counts = queryset.order_by().values("organization").annotate(n=Count("pk")).values("n")[:1]
    return Coalesce(Subquery(counts, output_field=IntegerField()), 0)


def expired_q(now):
    """Invitations reported as `expired`: persisted as expired, or still pending past their expiry."""
    return Q(status=Invitation.Status.EXPIRED) | Q(status=Invitation.Status.PENDING, expires_at__lte=now)


def live_q(now):
    return Q(status=Invitation.Status.PENDING, expires_at__gt=now)


def holds_seat_q():
    """Memberships that hold a seat: covered, and active or suspended."""
    return Q(coverage=COVERED, status__in=SEAT_STATUSES)


def seats_expression(now=None):
    """Seats used per organization: covered memberships that are active or suspended + pending invitations not yet
    expired, one seat per person (an invitation to someone who already holds a seat takes no second one)."""
    now = now or timezone.now()
    members = Membership.objects.filter(holds_seat_q(), organization=OuterRef("pk"))
    joined = (
        Membership.objects.filter(holds_seat_q(), organization=OuterRef("organization"))
        .annotate(email_lower=Lower("user__email"))
        .filter(email_lower=OuterRef("email"))
    )
    invites = Invitation.objects.filter(live_q(now), organization=OuterRef("pk")).exclude(Exists(joined))
    return count_per_organization(members) + count_per_organization(invites)


def with_counts(queryset, now=None):
    """Annotates seats and the member / invitation / request counts both APIs show, in one query for any rows.
    `active_members` / `suspended_members` are covered members; affiliated ones are split into
    `not_covered_members` and `personal_plan_members`; `pending_requests` are sign-ups awaiting a verified email."""
    now = now or timezone.now()
    members = Membership.objects.filter(organization=OuterRef("pk"))
    covered = members.filter(coverage=COVERED)
    affiliated = members.filter(coverage=NOT_COVERED, status=Membership.Status.ACTIVE)
    invites = Invitation.objects.filter(organization=OuterRef("pk"))
    return queryset.annotate(
        used_seats=seats_expression(now),
        active_members=count_per_organization(covered.filter(status=Membership.Status.ACTIVE)),
        suspended_members=count_per_organization(covered.filter(status=Membership.Status.SUSPENDED)),
        not_covered_members=count_per_organization(affiliated.filter(~personal_plan_exists("user", now))),
        personal_plan_members=count_per_organization(affiliated.filter(personal_plan_exists("user", now))),
        pending_requests=count_per_organization(members.filter(status=Membership.Status.PENDING)),
        pending_invitations=count_per_organization(invites.filter(live_q(now))),
        expired_invitations=count_per_organization(invites.filter(expired_q(now))),
    )


def filter_invitations(queryset, *, status=None, q=""):
    """Invitations lists, newest first. `status` is the reported one: pending past its expiry is `expired`."""
    now = timezone.now()
    if status == Invitation.Status.PENDING:
        queryset = queryset.filter(live_q(now))
    elif status == Invitation.Status.EXPIRED:
        queryset = queryset.filter(expired_q(now))
    elif status:
        queryset = queryset.filter(status=status)
    if q:
        queryset = queryset.filter(Q(email__icontains=q) | Q(name__icontains=q))
    return queryset.order_by("-created_at", "pk")


def with_seats(queryset):
    """Annotates `used_seats` on an Organization queryset, so lists need no per-row query."""
    return queryset.annotate(used_seats=seats_expression())


def seats_used(org):
    """Fresh count (one query); never reads a stale annotation."""
    return Organization.objects.filter(pk=org.pk).annotate(n=seats_expression()).values_list("n", flat=True).get()


def seat_summary(org):
    """`{"used", "cap"}`; uses the `with_seats` annotation when present."""
    used = getattr(org, "used_seats", None)
    return {"used": seats_used(org) if used is None else used, "cap": org.seat_cap}


def lock_organization(org):
    """Re-reads the organization FOR UPDATE. Call inside transaction.atomic()."""
    return Organization.objects.select_for_update().get(pk=org.pk)


def seats_free(org):
    """Seats still available (None = unlimited). `org` must be locked in the current transaction."""
    if org.seat_cap is None:
        return None
    return max(org.seat_cap - seats_used(org), 0)


def seats_to_join(org, email):
    """Seats a membership for `email` adds when it becomes covered: 0 when a live pending invitation to that email
    already holds its seat (one person, one seat), else 1."""
    held = Invitation.objects.filter(live_q(timezone.now()), organization=org, email=(email or "").strip().lower())
    return 0 if held.exists() else 1


def _seat_shortfall(org, needed):
    """Seats used now if `needed` more do not fit, else None. `org` must come from lock_organization."""
    if not transaction.get_connection().in_atomic_block:
        raise RuntimeError("seat checks must run inside the transaction that locked the organization")
    if org.seat_cap is None or needed <= 0:
        return None
    used = seats_used(org)
    return used if used + needed > org.seat_cap else None


def seats_fit(org, needed=1):
    return _seat_shortfall(org, needed) is None


def ensure_seats(org, needed=1):
    """Raises 409 `seat_cap_reached` unless `needed` more seats fit. `org` must come from lock_organization."""
    used = _seat_shortfall(org, needed)
    if used is not None:
        raise ServiceError(
            "seat_cap_reached",
            f"{used} / {org.seat_cap} seats are in use: raise the cap or remove members first.",
            status=409, extra={"seats_used": used, "seat_cap": org.seat_cap},
        )


# ---------------------------------------------------------------- institutions

def clean_institution(data, *, partial=False):
    """Validated institution fields from a request body. `partial` (PATCH): only keys present, no slug."""
    if not isinstance(data, dict):
        raise invalid({"non_field": "Send a JSON object."})
    errors, out = {}, {}

    def present(key):
        return key in data if partial else True

    if present("name"):
        name = clean_name(data.get("name"))
        if len(name) < 2:
            errors["name"] = "Enter the institution's name."
        out["name"] = name
    if not partial:
        slug = data.get("slug").strip().lower() if isinstance(data.get("slug"), str) else ""
        try:
            validate_slug(slug)
        except ValidationError as e:
            errors["slug"] = e.messages[0]
        out["slug"] = slug
    if present("type") and (data.get("type") is not None or partial):
        kind = data.get("type")
        if kind not in Organization.Type.values:
            errors["type"] = "Choose a type."
        out["type"] = kind
    if present("sector") and (data.get("sector") is not None or partial):
        sector = data.get("sector") or ""
        if sector and sector not in Organization.Sector.values:
            errors["sector"] = "Choose public, private or other."
        out["sector"] = sector
    if present("timezone") and (data.get("timezone") is not None or partial):
        try:
            validate_timezone(data.get("timezone"))
        except ValidationError as e:
            errors["timezone"] = e.messages[0]
        out["timezone"] = data.get("timezone")
    if present("contact_email"):
        raw = data.get("contact_email") or ""
        email = normalize_email(raw) if raw else ""
        if email is None:
            errors["contact_email"] = "Enter a valid email address."
        out["contact_email"] = email or ""
    if present("sign_in_domains"):
        try:
            out["sign_in_domains"] = normalize_domains(data.get("sign_in_domains") or [])
        except ValidationError as e:
            errors["sign_in_domains"] = e.messages[0]
    if present("seat_cap"):
        cap = data.get("seat_cap")
        if cap is not None and (isinstance(cap, bool) or not isinstance(cap, int) or cap < 1):
            errors["seat_cap"] = "Use a whole number of at least 1, or leave it empty for unlimited."
        out["seat_cap"] = cap
    if errors:
        raise invalid(errors)
    return out


def create_institution(*, data, admin=None, admin_role=Membership.Role.ADMIN, actor=None, ip_address=None,
                       source=Invitation.Source.SUPERADMIN):
    """Organization + organization Account + optional admin invitation, all or nothing.

    `admin` is `{"email", "name"}`; its validation errors are reported as `admin.email` / `admin.name`.
    """
    fields = clean_institution(data)
    if admin is not None and not isinstance(admin, dict):
        raise invalid({"admin": "Give the admin's email and name."})
    with transaction.atomic():
        if Organization.objects.filter(slug=fields["slug"]).exists():
            raise _slug_taken()
        ensure_domains_free(fields.get("sign_in_domains"))
        try:
            with transaction.atomic():
                org = create_organization(**fields)
        except IntegrityError:
            raise _slug_taken() from None
        audit(
            actor=actor, action="organization.created", target_type="Organization", target_id=org.id,
            organization_id=org.id, ip_address=ip_address, source=source, slug=org.slug,
            seat_cap=org.seat_cap,
        )
        invited = None
        if admin is not None:
            try:
                invited = create_invitation(
                    organization=org, email=admin.get("email"), name=admin.get("name", ""), role=admin_role,
                    source=source, actor=actor, ip_address=ip_address,
                )
            except ServiceError as e:
                e.fields = {f"admin.{k}": v for k, v in e.fields.items()}
                raise
    return CreatedInstitution(organization=org, invited=invited)


def _slug_taken():
    return ServiceError("slug_taken", "Another institution already uses this slug.", status=409,
                        fields={"slug": "This slug is taken."})


# ---------------------------------------------------------------- invitations

def _new_invitation(*, organization, email, name, role, source, actor, now):
    token, digest = new_token()
    invitation = Invitation(
        organization=organization, email=email, name=name, role=role, token_hash=digest, source=source,
        invited_by=_actor(actor), expires_at=_expiry(now), last_sent_at=now,
    )
    return invitation, token


def sees_other_institutions(source):
    """Whether whoever acts through `source` may learn that an email belongs to another institution: BDREN AI staff
    may; a portal admin may not, so the portal invites such people and the accept refuses them (`_join`)."""
    return source != Invitation.Source.PORTAL


def standings(org, emails, *, other_institutions=True):
    """`{email: Standing}` for each lowercased email in `emails`, in two queries whatever their number. Without
    `other_institutions`, `elsewhere` is never set (one query)."""
    out = {email: Standing() for email in emails}
    if not out:
        return out
    here = (
        Membership.objects.filter(organization=org, status__in=SEAT_STATUSES)
        .select_related("user")
        .annotate(email_lower=Lower("user__email"), personal_plan=personal_plan_exists("user"))
        .filter(email_lower__in=out)
    )
    for m in here:
        standing = out[m.email_lower]
        if m.coverage == COVERED:
            standing.covered = True
        elif m.status == Membership.Status.ACTIVE and m.user.email_verified:
            standing.affiliated.append(m)
    if not other_institutions:
        return out
    elsewhere = (
        Membership.objects.filter(status__in=CONFIRMED_STATUSES, user__email_verified=True)
        .exclude(organization=org)
        .annotate(email_lower=Lower("user__email"))
        .filter(email_lower__in=out)
        .values_list("email_lower", flat=True)
    )
    for email in elsewhere:
        out[email].elsewhere = True
    return out


def _check_standing(standing):
    """Raises `already_member` (a covered member, active or suspended) or `member_of_other_institution`."""
    if standing.covered:
        raise _already_member()
    if standing.elsewhere:
        raise member_of_other_institution()


def _check_eligible(org, email, source):
    """Raises unless `email` may hold an invitation to `org`: not already a covered member there, and (for BDREN AI
    staff, `sees_other_institutions`) not a member of another institution. Any email domain may be invited."""
    _check_standing(standings(org, {email}, other_institutions=sees_other_institutions(source))[email])


def _check_not_invited(org, email):
    """409 `already_invited` if `email` already has a live invitation to `org` (None = individual)."""
    existing = (
        Invitation.objects.select_for_update()
        .filter(organization=org, email=email, status=Invitation.Status.PENDING)
        .first()
    )
    if existing is not None and not existing.is_expired:
        raise _already_invited()


def _retire_expired(org, emails, *, reason, source, actor=None, ip_address=None, live=False):
    """Revokes the expired invitations (or pending past expiry) to `emails` in `org` (None = individual); with
    `live`, the live pending ones too (the person was covered directly, so the invitation has nothing left to do).

    Called when a new invitation or the person joining supersedes them, so they stop counting as expired and
    stop offering Resend. Each one gets an `invitation.revoked` entry with `reason` (`superseded` / `joined`).
    """
    scope = Q(status__in=OPEN_INVITATION_STATUSES) if live else expired_q(timezone.now())
    ids = list(
        Invitation.objects.select_for_update()
        .filter(scope, organization=org, email__in=emails)
        .values_list("pk", flat=True)
    )
    if not ids:
        return 0
    Invitation.objects.filter(pk__in=ids).update(status=Invitation.Status.REVOKED)
    AuditLog.objects.bulk_create([
        audit_entry(
            actor=_actor(actor), action="invitation.revoked", target_type="Invitation", target_id=pk,
            metadata=audit_metadata(org.id if org else None, source=source, reason=reason), ip_address=ip_address,
        )
        for pk in ids
    ])
    return len(ids)


def _warning(org):
    return "institution_suspended" if org is not None and org.status == Organization.Status.SUSPENDED else None


def create_invitation(*, organization, email, name="", role=Membership.Role.MEMBER, source, actor=None,
                      ip_address=None, allowed_roles=None):
    """Invites `email` to `organization` (None = individual personal account; role is then ignored).

    Any email domain may be invited. Refused for a covered member, active or suspended (`already_member`), and, unless
    `source` is the portal (`sees_other_institutions`), for someone who belongs to another institution
    (`member_of_other_institution`; the portal's invitation is refused on accept). An affiliated free-tier member of
    `organization`
    is covered at once instead (no invitation; `Invited.outcome == "covered"`); a personal-plan member gets a normal
    invitation, which asks for their consent. `allowed_roles` limits the role (portal: PORTAL_ROLES). Seat-checked
    under the organization lock. Older expired invitations to the same email are revoked as superseded.
    """
    clean_email = normalize_email(email)
    if clean_email is None:
        raise invalid({"email": "Enter a valid email address."})
    if organization is None:
        role = Membership.Role.MEMBER
    else:
        _check_role(role, allowed_roles)
    outbox = Outbox()
    with transaction.atomic():
        org = lock_organization(organization) if organization is not None else None
        if org is not None:
            _check_open(org)
            standing = standings(org, {clean_email}, other_institutions=sees_other_institutions(source))[clean_email]
            _check_standing(standing)
            target = standing.coverable
            if target is not None:
                ensure_seats(org, seats_to_join(org, clean_email))
                [covered] = _cover(org, [(target, role)], source=source, actor=actor, ip_address=ip_address,
                                   outbox=outbox, via="invitation")
                return Invited(invitation=None, outbox=outbox, warning=_warning(org), membership=covered)
        _check_not_invited(org, clean_email)
        if org is not None:
            ensure_seats(org)
        _retire_expired(org, [clean_email], reason="superseded", source=source, actor=actor, ip_address=ip_address)
        invitation, token = _new_invitation(
            organization=org, email=clean_email, name=clean_name(name), role=role, source=source, actor=actor,
            now=timezone.now(),
        )
        invitation.email_status = outbox.reserve()
        try:
            with transaction.atomic():
                invitation.save()
        except IntegrityError:
            raise _already_invited() from None
        audit(
            actor=actor, action="invitation.created", target_type="Invitation", target_id=invitation.id,
            organization_id=org.id if org else None, ip_address=ip_address, source=source,
            email=clean_email, role=role if org else None,
        )
        outbox.add(invitation, token)
    return Invited(invitation=invitation, outbox=outbox, warning=_warning(org))


def _reissue(invitation, now, outbox):
    """New token (old link stops working), new expiry, sent_count + 1, email status from `outbox`.
    Returns the raw token; add it to `outbox` once the transaction can no longer fail on this row."""
    token, invitation.token_hash = new_token()
    invitation.status = Invitation.Status.PENDING
    invitation.expires_at = _expiry(now)
    invitation.last_sent_at = now
    invitation.sent_count += 1
    invitation.email_status = outbox.reserve()
    invitation.save(
        update_fields=["token_hash", "status", "expires_at", "last_sent_at", "sent_count", "email_status"]
    )
    return token


def _check_cooldown(invitation, now):
    """429 `resend_too_soon` while the last email is younger than INVITATION_RESEND_COOLDOWN_MINUTES."""
    wait = invitation.last_sent_at + timedelta(minutes=settings.INVITATION_RESEND_COOLDOWN_MINUTES) - now
    if wait.total_seconds() > 0:
        raise ServiceError(
            "resend_too_soon", "This invitation was just sent. Wait a few minutes before sending it again.",
            status=429, extra={"retry_after": int(wait.total_seconds()) + 1},
        )


def resend_invitation(invitation, *, source, actor=None, ip_address=None):
    """Re-sends a pending or expired invitation; an expired one takes a seat again, so it is seat-checked.

    The same rules as a new invitation apply (the person may have joined meanwhile, or the sign-in domains
    changed), and one invitation is emailed at most once per INVITATION_RESEND_COOLDOWN_MINUTES.
    """
    outbox = Outbox()
    with transaction.atomic():
        org = lock_organization(invitation.organization) if invitation.organization_id else None
        current = Invitation.objects.select_for_update().get(pk=invitation.pk)
        if current.status not in OPEN_INVITATION_STATUSES:
            raise _not_pending(current)
        now = timezone.now()
        _check_cooldown(current, now)
        if org is not None:
            _check_open(org)
            _check_eligible(org, current.email, source)
            if current.is_expired:
                ensure_seats(org)
        current.organization = org
        try:
            with transaction.atomic():
                token = _reissue(current, now, outbox)
        except IntegrityError:
            raise _already_invited() from None
        audit(
            actor=actor, action="invitation.resent", target_type="Invitation", target_id=current.id,
            organization_id=current.organization_id, ip_address=ip_address, source=source,
            sent_count=current.sent_count,
        )
        outbox.add(current, token)
    return Invited(invitation=current, outbox=outbox)


def revoke_invitation(invitation, *, source, actor=None, reason="", ip_address=None):
    with transaction.atomic():
        current = Invitation.objects.select_for_update().get(pk=invitation.pk)
        if current.status not in OPEN_INVITATION_STATUSES:
            raise _not_pending(current)
        current.status = Invitation.Status.REVOKED
        current.save(update_fields=["status"])
        audit(
            actor=actor, action="invitation.revoked", target_type="Invitation", target_id=current.id,
            organization_id=current.organization_id, ip_address=ip_address, source=source, reason=reason,
        )
    return current


def _expired_candidates(organization):
    """Latest expired invitation per (organization, email) with no live pending invite, outside removed institutions."""
    now = timezone.now()
    scope = Q(organization=organization) if organization is not None else Q()
    qs = Invitation.objects.filter(scope, expired_q(now)).exclude(organization__status=Organization.Status.DEACTIVATED)
    live = set(Invitation.objects.filter(scope, live_q(now)).values_list("organization_id", "email"))
    latest = {}
    for inv in qs.order_by("-created_at").only("id", "organization_id", "email"):
        key = (inv.organization_id, inv.email)
        if key not in live and key not in latest:
            latest[key] = inv.id
    by_org = {}
    for (org_id, _), inv_id in latest.items():
        by_org.setdefault(org_id, []).append(inv_id)
    return by_org


def resend_expired(*, organization=None, source, actor=None, ip_address=None):
    """Re-sends every expired invitation (in `organization`, or everywhere), oldest first, up to each seat cap.

    Rows the institution would no longer accept (the person is now a covered member there, or, as `standings` reports
    to `source`, belongs to another institution) are skipped.
    Beyond INVITATION_INLINE_EMAILS the emails are left `queued` for the mail worker.
    """
    outbox = Outbox()
    count = 0
    by_org = _expired_candidates(organization)
    for org_id in sorted(by_org, key=lambda k: (k is not None, str(k))):
        with transaction.atomic():
            org = Organization.objects.select_for_update().get(pk=org_id) if org_id else None
            free = seats_free(org) if org is not None else None
            invitations = (
                Invitation.objects.select_for_update(of=("self",))
                .select_related("invited_by")
                .filter(pk__in=by_org[org_id], status__in=OPEN_INVITATION_STATUSES)
                .order_by("created_at")
            )
            invitations = list(invitations)
            found = (
                standings(org, {inv.email for inv in invitations}, other_institutions=sees_other_institutions(source))
                if org is not None else {}
            )
            now = timezone.now()
            for inv in invitations:
                standing = found.get(inv.email)
                eligible = standing is None or not (standing.covered or standing.elsewhere)
                if not inv.is_expired or not eligible:
                    continue
                if free is not None and free <= 0:
                    break
                inv.organization = org
                try:
                    with transaction.atomic():
                        token = _reissue(inv, now, outbox)
                except IntegrityError:  # a new invitation to this email was created meanwhile
                    continue
                audit(
                    actor=actor, action="invitation.resent", target_type="Invitation", target_id=inv.id,
                    organization_id=org_id, ip_address=ip_address, source=source, sent_count=inv.sent_count,
                    bulk=True,
                )
                outbox.add(inv, token)
                count += 1
                free = None if free is None else free - 1
    return Resent(count=count, outbox=outbox)


# ---------------------------------------------------------------- acceptance

def find_by_token(token):
    if not isinstance(token, str) or not TOKEN_RE.match(token):
        return None
    return (
        Invitation.objects.select_related("organization", "invited_by")
        .filter(token_hash=hash_token(token))
        .first()
    )


def _user_email(user):
    return (user.email or "").strip().lower()


def preview_invitation(token, user=None):
    """Public view of an invitation for the /invite/<token> page, or None for an unknown token."""
    invitation = find_by_token(token)
    if invitation is None:
        return None
    signed_in = bool(user is not None and user.is_authenticated)
    matches = signed_in and _user_email(user) == invitation.email
    org = invitation.organization
    inviter = invitation.invited_by
    ends_plan = bool(matches and org is not None and has_personal_plan(user))
    return {
        "status": invitation.effective_status,
        "email_masked": mask_email(invitation.email),
        "email": invitation.email if matches else None,
        "institution": {"name": org.name} if org else None,
        "role": invitation.role if org else None,
        "invited_by_name": (inviter.name or "BDREN AI") if inviter else "BDREN AI",
        "expires_at": iso(invitation.expires_at),
        "signed_in": signed_in,
        "email_matches": matches,
        "ends_personal_plan": ends_plan,
        "personal_plan_ends_at": iso(_personal_plan_end(user)) if ends_plan else None,
    }


def _personal_plan_end(user):
    """When the last of `user`'s paid personal plans expires, or None when one has no expiry."""
    ends = list(paid_personal_subscriptions(user).values_list("expires_at", flat=True))
    return None if not ends or None in ends else max(ends)


def _join(org, user, role, invitation, ip_address):
    """Active, covered membership for `user`: created, or upgraded from a sign-up request, from affiliated (not
    covered), or reactivated. Refused for someone who belongs to another institution.

    The pending invitation already holds a seat, which the membership now takes over, so joining never
    adds a seat and is not refused at the cap. An already active member gets the invited role only when it
    is higher than their current one (an invitation never demotes).
    """
    ensure_single_institution(user, org, source="invitation", actor=user, ip_address=ip_address)
    membership = Membership.objects.select_for_update().filter(user=user, organization=org).first()
    previous = membership.status if membership else None
    previous_role = membership.role if membership else None
    previous_coverage = membership.coverage if membership else None
    if membership is None:
        membership = save_membership(Membership(
            user=user, organization=org, role=role, status=Membership.Status.ACTIVE, coverage=COVERED,
        ))
    elif (
        membership.status != Membership.Status.ACTIVE or membership.coverage != COVERED
        or ROLE_RANK[role] > ROLE_RANK[membership.role]
    ):
        membership.role = role if ROLE_RANK[role] > ROLE_RANK[membership.role] else membership.role
        membership.status = Membership.Status.ACTIVE
        membership.coverage = COVERED
        save_membership(membership, update_fields=["role", "status", "coverage"])
    audit(
        actor=user, action="membership.joined", target_type="Membership", target_id=membership.id,
        organization_id=org.id, ip_address=ip_address, source="invitation", invitation_id=str(invitation.id),
        previous_status=previous, previous_role=previous_role, previous_coverage=previous_coverage,
        role=membership.role,
    )
    _retire_expired(org, [invitation.email], reason="joined", source="invitation", actor=user, ip_address=ip_address)
    return membership


def accept_invitation(token, *, user, ip_address=None, end_personal_plan=False):
    """Accepts for the signed-in `user`, whose verified email must equal the invitation's. Into an institution, the
    membership becomes active and covered (409 `member_of_other_institution` if they belong to another one), and
    any paid personal plan is set not to renew. Decision D1 needs the person's consent for that: someone holding a
    paid personal plan must send `end_personal_plan` (409 `personal_plan_consent_required` otherwise)."""
    found = find_by_token(token)
    if found is None:
        raise ServiceError("not_found", "This invitation link is not valid.", status=404)
    with transaction.atomic():
        org = lock_organization(found.organization) if found.organization_id else None
        invitation = Invitation.objects.select_for_update().get(pk=found.pk)
        if invitation.effective_status != Invitation.Status.PENDING:
            raise ServiceError(
                "invitation_not_pending", "This invitation can no longer be accepted.", status=409,
                extra={"status": invitation.effective_status},
            )
        if _user_email(user) != invitation.email:
            raise ServiceError(
                "email_mismatch", "This invitation was sent to a different email address.", status=403,
                extra={"email_masked": mask_email(invitation.email)},
            )
        if not user.email_verified:
            raise ServiceError("email_unverified", "Verify your email address before accepting.", status=403)
        membership = None
        renewal_stopped = 0
        if org is not None:
            _check_open(org)
            if not end_personal_plan and has_personal_plan(user):
                raise consent_missing()
            membership = _join(org, user, invitation.role, invitation, ip_address)
            renewal_stopped = _stop_personal_renewals(org, user, ip_address)
        else:
            Account.objects.get_or_create(owner_user=user, account_type=Account.Type.PERSONAL)
        invitation.status = Invitation.Status.ACCEPTED
        invitation.accepted_by = user
        invitation.accepted_at = timezone.now()
        invitation.save(update_fields=["status", "accepted_by", "accepted_at"])
        audit(
            actor=user, action="invitation.accepted", target_type="Invitation", target_id=invitation.id,
            organization_id=org.id if org else None, ip_address=ip_address, source="invitation",
        )
    if membership is None:
        return {"institution": None, "role": None, "redirect": "/profile", "renewal_stopped": False}
    redirect = f"/admin/portal/{org.slug}/members" if membership.role in ADMIN_ROLES else "/profile"
    return {
        "institution": {"slug": org.slug, "name": org.name}, "role": membership.role, "redirect": redirect,
        "renewal_stopped": renewal_stopped > 0,
    }


def _stop_personal_renewals(org, user, ip_address):
    """D1: a personal-plan user who accepts runs their paid personal plans to expiry, then they do not renew."""
    stopped = 0
    for subscription in paid_personal_subscriptions(user).filter(auto_renew=True):
        stopped += stop_renewal(
            subscription=subscription, actor=user, ip_address=ip_address,
            notes=f"Joined the {org.name} package; runs to its expiry and does not renew",
            metadata={"source": "invitation", "organization_id": str(org.id), "reason": "covered_by_institution"},
        )
    return stopped


# ---------------------------------------------------------------- import

def _row_result(index, email, status, reason=None, action=None):
    return {"index": index, "email": email, "status": status, "reason": reason, "action": action}


def _parse_rows(org, rows, allowed_roles, source):
    """Classifies each row. Returns (results, ok rows as (result, email, name, role, standing, seats)), where `seats`
    is what the row adds: 0 for a cover row whose live invitation already holds its seat, else 1."""
    if not isinstance(rows, list):
        raise invalid({"rows": "Send a list of rows."})
    if len(rows) > MAX_IMPORT_ROWS:
        raise ServiceError(
            "too_many_rows", f"Import at most {MAX_IMPORT_ROWS} rows at a time.",
            fields={"rows": f"At most {MAX_IMPORT_ROWS} rows."},
        )
    parsed = []
    for index, row in enumerate(rows):
        row = row if isinstance(row, dict) else {}
        raw_role = row.get("role")
        role = raw_role.strip().lower() if isinstance(raw_role, str) and raw_role.strip() else Membership.Role.MEMBER
        raw_email = row.get("email")
        parsed.append((index, normalize_email(raw_email), raw_email, clean_name(row.get("name")), role))
    found = standings(
        org, {email for _, email, _, _, _ in parsed if email}, other_institutions=sees_other_institutions(source)
    )
    pending = {
        inv.email: inv
        for inv in Invitation.objects.filter(organization=org, status=Invitation.Status.PENDING, email__in=found)
    }
    allowed = allowed_roles or Membership.Role.values
    results, ok, seen = [], [], set()  # `seen`: emails an earlier row already invites or covers
    for index, email, raw_email, name, role in parsed:
        shown = email or (raw_email.strip()[:254] if isinstance(raw_email, str) else "")
        if email is None:
            results.append(_row_result(index, shown, "error", "invalid_email"))
            continue
        standing = found[email]
        if role not in allowed:
            result = _row_result(index, email, "error", "bad_role")
        elif email in seen:
            result = _row_result(index, email, "skip", "duplicate_in_file")
        elif standing.covered:
            result = _row_result(index, email, "skip", "already_member")
        elif standing.elsewhere:
            result = _row_result(index, email, "skip", "member_of_other_institution")
        elif standing.coverable is None and email in pending and not pending[email].is_expired:
            result = _row_result(index, email, "skip", "already_invited")
        else:
            result = _row_result(index, email, "ok", action=standing.action)
            held = standing.action == "cover" and email in pending and not pending[email].is_expired
            ok.append((result, email, name, role, standing, 0 if held else 1))
            seen.add(email)
        results.append(result)
    return results, ok


def _fit(ok, free):
    """Splits the `ok` rows, in file order, into those that fit `free` seats (None = unlimited) and those over the
    cap. A row that adds no seat always fits."""
    if free is None:
        return ok, []
    fitting, over = [], []
    for row in ok:
        seats = row[-1]
        if seats > free:
            over.append(row)
            continue
        free -= seats
        fitting.append(row)
    return fitting, over


def _summary(results, fits, org):
    tally = {"ok": 0, "error": 0, "skip": 0}
    actions = {"invite": 0, "cover": 0, "consent_invite": 0}
    for r in results:
        tally[r["status"]] += 1
        if r["status"] == "ok":
            actions[r["action"]] += 1
    return {**tally, "fits": fits, "actions": actions, "seats": seat_summary(org)}


def import_rows(org, rows, *, dry_run, source, actor=None, allowed_roles=None, ip_address=None):
    """CSV-style member import. Dry run classifies only; a real run handles the `ok` rows in file order until the
    seat cap and marks the rest `error` / `over_cap`. Nothing is cut silently: the dry run's `fits` says how many will
    go, and the rows that will not fit stay `ok` with reason `over_cap`. A cover row whose live invitation already
    holds its seat needs no new one.

    Each `ok` row has an `action`: `invite` (a new invitation), `cover` (an affiliated free-tier member, covered at
    once and sent a notice) or `consent_invite` (a personal-plan member, invited so they can consent). People in
    another institution are skipped (`member_of_other_institution`). The first INVITATION_INLINE_EMAILS emails go out
    after commit; the rest are `queued` for the mail worker. Invitations get source `import`; `source`
    (superadmin/portal) is who ran it, for the audit trail.
    """
    if dry_run:
        _check_open(org)
        results, ok = _parse_rows(org, rows, allowed_roles, source)
        fitting, over = _fit(ok, seats_free(org))
        for result, *_ in over:
            result["reason"] = "over_cap"
        return ImportResult(rows=results, summary=_summary(results, len(fitting), org))

    outbox = Outbox()
    with transaction.atomic():
        org = lock_organization(org)
        _check_open(org)
        results, ok = _parse_rows(org, rows, allowed_roles, source)
        fitting, over = _fit(ok, seats_free(org))
        for result, *_ in over:
            result.update(status="error", reason="over_cap", action=None)
        covers = [
            (standing.coverable, role) for result, _, _, role, standing, _ in fitting if result["action"] == "cover"
        ]
        invites = [(email, name, role) for result, email, name, role, *_ in fitting if result["action"] != "cover"]
        covered = _cover(org, covers, source=source, actor=actor, ip_address=ip_address, outbox=outbox, via="import")
        _retire_expired(
            org, [email for email, _, _ in invites], reason="superseded", source=source, actor=actor,
            ip_address=ip_address,
        )
        now = timezone.now()
        created = [
            _new_invitation(
                organization=org, email=email, name=name, role=role, source=Invitation.Source.IMPORT,
                actor=actor, now=now,
            )
            for email, name, role in invites
        ]
        for inv, _ in created:
            inv.email_status = outbox.reserve()
        Invitation.objects.bulk_create([inv for inv, _ in created])
        AuditLog.objects.bulk_create([
            audit_entry(
                actor=actor, action="invitation.created", target_type="Invitation", target_id=inv.id,
                metadata=audit_metadata(org.id, source=source, email=inv.email, role=inv.role, via="import"),
                ip_address=ip_address,
            )
            for inv, _ in created
        ])
        for inv, token in created:
            outbox.add(inv, token)
        summary = _summary(results, len(created) + len(covered), org)
        audit(
            actor=actor, action="organization.members_imported", target_type="Organization", target_id=org.id,
            organization_id=org.id, ip_address=ip_address, source=source, rows=len(results),
            created=len(created), covered=len(covered), skipped=summary["skip"], errors=summary["error"],
        )
    return ImportResult(rows=results, summary=summary, created=len(created), covered=len(covered), outbox=outbox)


# ---------------------------------------------------------------- memberships

def _guard_last_admin(org, membership, new_role, new_status, force):
    """409 `last_admin` if the change leaves an active institution with no active owner/admin."""
    if force or org.status != Organization.Status.ACTIVE:
        return
    was_admin = membership.status == Membership.Status.ACTIVE and membership.role in ADMIN_ROLES
    stays_admin = new_status == Membership.Status.ACTIVE and new_role in ADMIN_ROLES
    if not was_admin or stays_admin:
        return
    others = (
        Membership.objects.filter(organization=org, status=Membership.Status.ACTIVE, role__in=ADMIN_ROLES)
        .exclude(pk=membership.pk)
        .exists()
    )
    if not others:
        raise ServiceError(
            "last_admin", "The institution must keep at least one active owner or administrator.", status=409
        )


def _locked_membership(membership):
    org = lock_organization(membership.organization)
    current = Membership.objects.select_for_update(of=("self",)).select_related("user").get(pk=membership.pk)
    current.organization = org
    return org, current


def _takes_seat(membership, new_status):
    """Whether moving a covered membership to `new_status` makes it hold a seat it does not hold now."""
    return (
        membership.coverage == COVERED and new_status in SEAT_STATUSES and membership.status not in SEAT_STATUSES
    )


def update_membership(membership, *, source, actor=None, role=None, status=None, reason="", force=False,
                      ip_address=None, allowed_roles=None):
    """Changes role and/or status (`active` / `suspended`); coverage is unchanged. A covered membership that starts
    holding a seat again (from pending or deprovisioned) is seat-checked; suspending keeps the seat, so
    reactivating a suspended member needs none. Only covered members can be suspended or made owner/admin (409
    `not_covered`): someone not on the package holds no seat to keep and must not run the portal. Reviving a removed
    membership is refused while the person belongs to another institution. `force` skips the last-admin rule."""
    if role is not None:
        _check_role(role, allowed_roles)
    if status is not None and status not in (Membership.Status.ACTIVE, Membership.Status.SUSPENDED):
        raise invalid({"status": "Use active or suspended."})
    with transaction.atomic():
        org, current = _locked_membership(membership)
        new_role = role or current.role
        new_status = status or current.status
        changes = {
            key: [old, new]
            for key, old, new in (("role", current.role, new_role), ("status", current.status, new_status))
            if old != new
        }
        if not changes:
            return current
        _check_covered_change(current, changes)
        joining = new_status == Membership.Status.ACTIVE and current.status != Membership.Status.ACTIVE
        if joining:
            _check_open(org)
        if current.status == Membership.Status.DEPROVISIONED:
            ensure_single_institution(current.user, org, source=source, actor=actor, ip_address=ip_address)
        if _takes_seat(current, new_status):
            ensure_seats(org, seats_to_join(org, current.user.email))
        _guard_last_admin(org, current, new_role, new_status, force)
        current.role, current.status = new_role, new_status
        save_membership(current, update_fields=["role", "status"])
        if joining:
            _retire_expired(
                org, [_user_email(current.user)], reason="joined", source=source, actor=actor, ip_address=ip_address,
            )
        audit(
            actor=actor, action="membership.updated", target_type="Membership", target_id=current.id,
            organization_id=org.id, ip_address=ip_address, source=source, changes=changes, reason=reason,
            forced=force or None, user_id=str(current.user_id), coverage=current.coverage,
        )
    return current


def _check_covered_change(membership, changes):
    if membership.coverage == COVERED:
        return
    if changes.get("status", [None, None])[1] == Membership.Status.SUSPENDED:
        raise not_covered_error("Only members on the institution's package can be suspended.")
    if changes.get("role", [None, None])[1] in ADMIN_ROLES:
        raise not_covered_error("Only members on the institution's package can be owners or administrators.")


def _cover(org, targets, *, source, actor=None, ip_address=None, outbox, via, reason=""):
    """Covers affiliated free-tier memberships of `org` (`targets`: [(membership, role or None)]): coverage becomes
    `institution`, the role rises to `role` when that is higher (never lower), open invitations to their emails are
    revoked as `joined`, each gets a `membership.covered` audit entry and an emailed notice. The caller holds the
    organization lock and has checked seats. Raises `not_coverable` if one changed meanwhile. Returns the
    memberships."""
    if not targets:
        return []
    roles = {m.pk: role for m, role in targets}
    current = list(
        Membership.objects.select_for_update(of=("self",)).select_related("user")
        .filter(pk__in=roles, organization=org).order_by("pk")
    )
    if len(current) != len(roles) or any(
        m.coverage != NOT_COVERED or m.status != Membership.Status.ACTIVE for m in current
    ):
        raise not_coverable()
    previous_roles = {m.pk: m.role for m in current}
    for m in current:
        role = roles[m.pk]
        m.coverage = COVERED
        if role and ROLE_RANK[role] > ROLE_RANK[m.role]:
            m.role = role
    Membership.objects.bulk_update(current, ["coverage", "role"])
    _retire_expired(
        org, [_user_email(m.user) for m in current], reason="joined", source=source, actor=actor,
        ip_address=ip_address, live=True,
    )
    AuditLog.objects.bulk_create([
        audit_entry(
            actor=_actor(actor), action="membership.covered", target_type="Membership", target_id=m.id,
            metadata=audit_metadata(
                org.id, source=source, via=via, reason=reason, user_id=str(m.user_id), role=m.role,
                previous_role=previous_roles[m.pk] if previous_roles[m.pk] != m.role else None,
            ),
            ip_address=ip_address,
        )
        for m in current
    ])
    outbox.notify([covered_notice(org, m.user) for m in current])
    return current


def cover_membership(membership, *, source, actor=None, role=None, reason="", ip_address=None, allowed_roles=None):
    """"Add to package" (R4): covers an active, affiliated free-tier member of the institution directly, under the
    organization lock and seat cap, audited, with an emailed notice. Personal-plan members need a consent invitation
    instead (409 `needs_consent_invitation`); a covered member is 409 `already_covered`; anyone else (not active) is
    409 `not_coverable`."""
    if role is not None:
        _check_role(role, allowed_roles)
    outbox = Outbox()
    with transaction.atomic():
        org, current = _locked_membership(membership)
        _check_open(org)
        if current.coverage == COVERED:
            raise already_covered()
        if current.status != Membership.Status.ACTIVE:
            raise not_coverable()
        if has_personal_plan(current.user):
            raise consent_required()
        ensure_seats(org, seats_to_join(org, current.user.email))
        [covered] = _cover(org, [(current, role)], source=source, actor=actor, ip_address=ip_address,
                           outbox=outbox, via="add_to_package", reason=reason)
    return Covered(membership=covered, outbox=outbox)


def uncover_membership(membership, *, source, actor=None, reason="", force=False, ip_address=None):
    """Portal removal (R5): the member leaves the institution's package but stays affiliated. Coverage becomes
    `none`, status `active`, role `member`; their seat is freed; account and data stay. A paid personal plan that
    stopped renewing when they joined (D1) renews again. The last-admin rule applies (`force` skips it). 409
    `not_covered` if they are not covered."""
    with transaction.atomic():
        org, current = _locked_membership(membership)
        if current.coverage != COVERED or current.status not in SEAT_STATUSES:
            raise not_covered_error()
        _guard_last_admin(org, current, Membership.Role.MEMBER, Membership.Status.ACTIVE, force)
        previous_status, previous_role = current.status, current.role
        current.coverage = NOT_COVERED
        current.status = Membership.Status.ACTIVE
        current.role = Membership.Role.MEMBER
        current.save(update_fields=["coverage", "status", "role"])
        audit(
            actor=actor, action="membership.uncovered", target_type="Membership", target_id=current.id,
            organization_id=org.id, ip_address=ip_address, source=source, reason=reason,
            previous_status=previous_status, previous_role=previous_role, forced=force or None,
            user_id=str(current.user_id),
        )
        _resume_personal_renewals(org, current.user, source=source, actor=actor, ip_address=ip_address)
    return current


def join_by_institution_sign_in(org, user):
    """Sign-in through the institution's own IdP proves the person belongs there: approves their pending sign-up
    request, or creates an active membership with role `member`. It does not cover them (coverage `none`, no seat),
    so it never gives an admin role (the IdP's `auto_join_role` is not applied): the institution's admins add them
    to the package. Someone who belongs to another institution gets 409
    `member_of_other_institution`. Other existing memberships here are returned unchanged for the caller to judge.
    Call inside a transaction.
    """
    org = lock_organization(org)
    membership = Membership.objects.select_for_update().filter(user=user, organization=org).first()
    if membership is not None and membership.status != Membership.Status.PENDING:
        return membership
    ensure_single_institution(user, org, source="institution_sign_in", actor=user)
    previous = membership.status if membership else None
    if membership is None:
        membership = Membership(user=user, organization=org, role=Membership.Role.MEMBER, coverage=NOT_COVERED)
    membership.status = Membership.Status.ACTIVE
    save_membership(membership)
    audit(
        actor=user, action="membership.joined", target_type="Membership", target_id=membership.id,
        organization_id=org.id, ip_address=None, source="institution_sign_in", previous_status=previous,
        role=membership.role, coverage=membership.coverage,
    )
    _retire_expired(org, [_user_email(user)], reason="joined", source="institution_sign_in", actor=user)
    return membership


def activate_membership(membership, **kwargs):
    """Confirms a pending sign-up request (affiliation only) or reactivates a suspended/removed member."""
    return update_membership(membership, status=Membership.Status.ACTIVE, **kwargs)


def suspend_membership(membership, **kwargs):
    return update_membership(membership, status=Membership.Status.SUSPENDED, **kwargs)


def remove_membership(membership, *, source, actor=None, reason="", force=False, ip_address=None):
    """Superadmin removal: status `deprovisioned`, which takes the person out of the institution (and frees any
    seat). This is how BDREN support fixes a wrong institution; the portal uncovers instead (`uncover_membership`).
    A paid personal plan that stopped renewing when they joined (D1) renews again."""
    with transaction.atomic():
        org, current = _locked_membership(membership)
        if current.status == Membership.Status.DEPROVISIONED:
            return current
        _guard_last_admin(org, current, current.role, Membership.Status.DEPROVISIONED, force)
        previous = current.status
        current.status = Membership.Status.DEPROVISIONED
        current.save(update_fields=["status"])
        audit(
            actor=actor, action="membership.removed", target_type="Membership", target_id=current.id,
            organization_id=org.id, ip_address=ip_address, source=source, reason=reason,
            previous_status=previous, forced=force or None, user_id=str(current.user_id),
        )
        _resume_personal_renewals(org, current.user, source=source, actor=actor, ip_address=ip_address)
    return current


def _resume_personal_renewals(org, user, *, source, actor, ip_address):
    """Undoes D1 for someone leaving `org`'s package: their paid personal plans that were set not to renew when they
    joined `org`, and have not expired, renew again. Returns how many."""
    stopped = {str(s.id): s for s in paid_personal_subscriptions(user).filter(auto_renew=False)}
    if not stopped:
        return 0
    joined = AuditLog.objects.filter(
        action="subscription.renewal_stopped", target_type="Subscription", target_id__in=stopped,
        metadata__organization_id=str(org.id),
    ).values_list("target_id", flat=True)
    return sum(
        resume_renewal(
            subscription=stopped[pk], actor=_actor(actor), ip_address=ip_address,
            notes=f"Left the {org.name} package; renews again",
            metadata={"source": source, "organization_id": str(org.id), "reason": "left_institution_package"},
        )
        for pk in set(joined)
    )


# ---------------------------------------------------------------- labels and lists

def with_labels(queryset, now=None):
    """Annotates `personal_plan` (the user holds a paid personal plan) and `invited` (a live invitation to their
    email in the membership's institution) on a Membership queryset, for `membership_label` without a query per row."""
    now = now or timezone.now()
    invited = Invitation.objects.filter(
        live_q(now), organization=OuterRef("organization"), email=OuterRef("email_lower")
    )
    return queryset.annotate(
        email_lower=Lower("user__email"),
        personal_plan=personal_plan_exists("user", now),
    ).annotate(invited=Exists(invited))


def _label_q(label):
    affiliated = Q(coverage=NOT_COVERED, status__in=SEAT_STATUSES)
    return {
        Label.COVERED: Q(coverage=COVERED, status__in=SEAT_STATUSES),
        Label.INVITED: affiliated & Q(invited=True),
        Label.PERSONAL_PLAN: affiliated & Q(invited=False, personal_plan=True),
        Label.NOT_COVERED: affiliated & Q(invited=False, personal_plan=False),
    }[label]


def membership_label(membership):
    """`covered` (on the package, active or suspended), `invited` (not covered, with a live invitation),
    `personal_plan` (not covered, pays for their own plan) or `not_covered` (free tier); None for pending sign-up
    requests and removed memberships. Uses `with_labels` annotations when present, else reads them."""
    if membership.status not in SEAT_STATUSES:
        return None
    if membership.coverage == COVERED:
        return Label.COVERED
    invited = getattr(membership, "invited", None)
    if invited is None:
        invited = Invitation.objects.filter(
            live_q(timezone.now()), organization_id=membership.organization_id, email=_user_email(membership.user)
        ).exists()
    if invited:
        return Label.INVITED
    return Label.PERSONAL_PLAN if is_personal_plan(membership) else Label.NOT_COVERED


def is_personal_plan(membership):
    """Not covered and paying for their own plan: R2 keeps such members read-only and their usage private."""
    if membership.coverage != NOT_COVERED:
        return False
    flag = getattr(membership, "personal_plan", None)
    return has_personal_plan(membership.user) if flag is None else flag


def filter_members(org, *, q="", status=None, role=None, coverage=None, label=None, include_pending=True):
    """Memberships of `org` for the members lists, newest first, annotated by `with_labels`. Without `status`,
    removed members are left out (and pending sign-up requests too unless `include_pending`)."""
    qs = with_labels(Membership.objects.filter(organization=org).select_related("user"))
    if status:
        qs = qs.filter(status=status)
    else:
        hidden = [Membership.Status.DEPROVISIONED] + ([] if include_pending else [Membership.Status.PENDING])
        qs = qs.exclude(status__in=hidden)
    if role:
        qs = qs.filter(role=role)
    if coverage:
        qs = qs.filter(coverage=coverage)
    if label:
        qs = qs.filter(_label_q(label))
    if q:
        qs = qs.filter(Q(user__name__icontains=q) | Q(user__email__icontains=q))
    return qs.order_by("-created_at", "pk")


def member_shape(membership):
    """The contract's `Member`, with its `label`."""
    return serialize_member(membership, membership_label(membership))


def portal_member_shape(membership):
    """`member_shape`, reduced to name, email, joined date and label for a personal-plan member (R2)."""
    if is_personal_plan(membership):
        return serialize_personal_plan_member(membership, membership_label(membership))
    return member_shape(membership)
