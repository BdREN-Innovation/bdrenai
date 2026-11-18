"""Institution-admin portal: who may manage which institution, the reads behind its Members page, and the
portal's own limits on top of the shared invitation and membership services.

Access needs an active owner/admin membership in that institution and the institution to be active;
platform roles grant nothing here. Mutations re-check that access with the organization row locked, so an
admin removed or demoted a moment earlier cannot act. Portal admins invite and assign only member/admin,
and never change an owner or themselves. Every audit entry carries `source = "portal"`.

Members are covered (on the package), not covered (free tier), personal-plan, or invited (`membership_label`).
The Members page groups them in three tabs (`TABS`): covered, not covered (free tier, invited or not) and personal
plan. Only covered members can be changed or removed; removal uncovers them (they stay affiliated). Not covered
members can be added to the package. Personal-plan members are read-only and shown without role, status, usage or
account details (R2). Pending sign-up requests (awaiting a verified email) are not shown.
"""
from contextlib import contextmanager
from functools import reduce
from operator import or_

from django.db import transaction
from django.db.models import Count, F, Q

from apps.invitations.errors import ServiceError, invalid
from apps.invitations.models import Invitation
from apps.invitations.services import (
    ADMIN_ROLES,
    COVERED,
    NOT_COVERED,
    PORTAL_ROLES,
    SEAT_STATUSES,
    Label,
    already_covered,
    clean_name,
    consent_required,
    cover_membership,
    create_invitation,
    filter_invitations,
    filter_members,
    import_rows,
    is_personal_plan,
    lock_organization,
    not_covered_error,
    portal_member_shape,
    resend_invitation,
    revoke_invitation,
    uncover_membership,
    update_membership,
    with_counts,
    with_seats,
)
from apps.invitations.shapes import paginated, serialize_invitation
from apps.organizations.models import Membership, Organization
from apps.subscriptions.plans import personal_plan_exists

SOURCE = Invitation.Source.PORTAL
REASON_LIMIT = 1000
PORTAL_STATUSES = (Membership.Status.ACTIVE, Membership.Status.SUSPENDED)
TABS = ("covered", "not_covered", "personal_plan")


# ---------------------------------------------------------------- access

def _not_found():
    return ServiceError("not_found", "You don't administer an institution at this address.", status=404)


def _check_access(membership):
    """Raises unless `membership` (with its organization loaded) lets its user manage the institution: an active,
    covered owner/admin (someone not on the package never runs the portal, whatever their role)."""
    if membership is None or membership.status != Membership.Status.ACTIVE:
        raise _not_found()
    if membership.role not in ADMIN_ROLES or membership.coverage != COVERED:
        raise ServiceError(
            "not_institution_admin", "Only the institution's owners and administrators can manage members.",
            status=403,
        )
    status = membership.organization.status
    if status == Organization.Status.SUSPENDED:
        raise ServiceError(
            "institution_suspended", "This institution is suspended. Contact BDREN AI support.", status=403
        )
    if status != Organization.Status.ACTIVE:
        raise ServiceError("institution_inactive", "This institution has been removed.", status=403)


def access(user, slug):
    """The organization `user` may manage through the portal; 404 / 403 otherwise."""
    membership = (
        Membership.objects.select_related("organization").filter(user=user, organization__slug=slug).first()
    )
    _check_access(membership)
    return membership.organization


@contextmanager
def managing(user, slug):
    """A transaction holding the organization lock, entered only while `user` may still manage it."""
    org = access(user, slug)
    with transaction.atomic():
        org = lock_organization(org)
        membership = Membership.objects.filter(user=user, organization=org).first()
        if membership is not None:
            membership.organization = org
        _check_access(membership)
        yield org


# ---------------------------------------------------------------- reads

def administered_institutions(user):
    """Institutions (not removed) where `user` is an active, covered owner/admin, with seats and their role."""
    orgs = with_seats(
        Organization.objects.filter(
            memberships__user=user,
            memberships__status=Membership.Status.ACTIVE,
            memberships__role__in=ADMIN_ROLES,
            memberships__coverage=COVERED,
        )
        .exclude(status=Organization.Status.DEACTIVATED)
        .annotate(my_role=F("memberships__role"))
        .order_by("name")
    )
    return [
        {
            "slug": o.slug,
            "name": o.name,
            "status": o.status,
            "seats": {"used": o.used_seats, "cap": o.seat_cap},
            "role": o.my_role,
        }
        for o in orgs
    ]


def institution_summary(org):
    """`{"slug", "name", "seats", "counts", "sign_in_domains"}` in one query, with the superadmin's seat rule."""
    org = with_counts(Organization.objects.filter(pk=org.pk)).get()
    return {
        "slug": org.slug,
        "name": org.name,
        "seats": {"used": org.used_seats, "cap": org.seat_cap},
        "counts": {
            "members": org.active_members + org.suspended_members,
            "active": org.active_members,
            "suspended": org.suspended_members,
            "pending_invitations": org.pending_invitations,
            "expired_invitations": org.expired_invitations,
            "pending_requests": org.pending_requests,
            "not_covered": org.not_covered_members,
            "personal_plan": org.personal_plan_members,
        },
        "sign_in_domains": org.sign_in_domains,
    }


def _choice(query, key, choices):
    value = query.get(key) or None
    if value is not None and value not in choices:
        raise invalid({key: f"Use one of: {', '.join(choices)}."})
    return value


def _tab_q(tab, paying=Q(personal_plan=True)):
    """Members of a Members-page tab. `paying` says who holds a paid personal plan: by default the `with_labels`
    annotation (`filter_members` adds it)."""
    affiliated = Q(coverage=NOT_COVERED, status__in=SEAT_STATUSES)
    return {
        "covered": Q(coverage=COVERED, status__in=SEAT_STATUSES),
        "not_covered": affiliated & ~paying,
        "personal_plan": affiliated & paying,
    }[tab]


def tab_counts(org, q=""):
    """`{"covered", "not_covered", "personal_plan"}` member counts matching the search `q`, in one query."""
    members = Membership.objects.filter(organization=org, status__in=SEAT_STATUSES)
    if q:
        members = members.filter(Q(user__name__icontains=q) | Q(user__email__icontains=q))
    paying = Q(personal_plan_exists("user"))
    return members.aggregate(**{tab: Count("pk", filter=_tab_q(tab, paying)) for tab in TABS})


def list_members(org, query):
    """`?tab=covered|not_covered|personal_plan&q=&status=active|suspended&role=&label=covered|invited|not_covered|
    personal_plan&page=`, plus `tabs` (counts per tab for `q`). Removed members and pending sign-up requests are never
    listed. Role and status are not shown for personal-plan members, so those filters never match them."""
    q = (query.get("q") or "").strip()
    tab = _choice(query, "tab", TABS)
    status = _choice(query, "status", PORTAL_STATUSES)
    role = _choice(query, "role", Membership.Role.values)
    if tab == "personal_plan" and (status or role):
        raise invalid({"tab": "Personal-plan members can't be filtered by role or status."})
    members = filter_members(
        org, q=q, status=status, role=role, label=_choice(query, "label", Label.values), include_pending=False
    )
    if status or role:
        members = members.exclude(_tab_q("personal_plan"))
    if tab:
        members = members.filter(_tab_q(tab))
    return {**paginated(members, query, portal_member_shape), "tabs": tab_counts(org, q)}


def _domain_q(domain):
    return Q(user__email__iendswith="@" + domain) | Q(user__email__iendswith="." + domain)


def sign_in_domains(org):
    """The institution's sign-in domains with how many confirmed (active or suspended) members have an email on each
    (exact or subdomain), plus those on none of them (people invited from other domains). One query."""
    domains = list(org.sign_in_domains or [])
    confirmed = Membership.objects.filter(organization=org, status__in=PORTAL_STATUSES)
    metrics = {f"d{i}": Count("pk", filter=_domain_q(d)) for i, d in enumerate(domains)}
    if domains:
        metrics["listed"] = Count("pk", filter=reduce(or_, map(_domain_q, domains)))
    counts = confirmed.aggregate(total=Count("pk"), **metrics)
    return {
        "domains": [{"domain": d, "confirmed_members": counts[f"d{i}"]} for i, d in enumerate(domains)],
        "confirmed_members": counts["total"],
        "other_domains": counts["total"] - counts.get("listed", 0),
    }


def portal_invitation(invitation):
    return serialize_invitation(invitation, inviter_email=False)


def list_invitations(org, query):
    """`?status=pending|accepted|revoked|expired&q=&page=`, where `expired` includes pending past expiry."""
    invitations = filter_invitations(
        Invitation.objects.filter(organization=org).select_related("organization", "invited_by", "accepted_by"),
        status=_choice(query, "status", Invitation.Status.values),
        q=(query.get("q") or "").strip(),
    )
    return paginated(invitations, query, portal_invitation)


# ---------------------------------------------------------------- mutations

def _body(data):
    if not isinstance(data, dict):
        raise invalid({"non_field": "Send a JSON object."})
    return data


def _role(value):
    """A portal role string, or 400 `bad_role` (owner/billing and anything else)."""
    if value not in PORTAL_ROLES:
        raise ServiceError("bad_role", "Portal admins can give only the member or admin role.",
                           fields={"role": "Choose member or admin."})
    return value


def _reason(data):
    return clean_name(data.get("reason"), REASON_LIMIT)


def invite(actor, slug, data, ip_address=None):
    data = _body(data)
    role = data.get("role") or Membership.Role.MEMBER
    role = _role(role if isinstance(role, str) else None)
    with managing(actor, slug) as org:
        invited = create_invitation(
            organization=org, email=data.get("email"), name=data.get("name") or "", role=role, source=SOURCE,
            actor=actor, ip_address=ip_address, allowed_roles=PORTAL_ROLES,
        )
    return invited


def _invitation_in(org, invitation_id):
    invitation = Invitation.objects.filter(pk=invitation_id, organization=org).first()
    if invitation is None:
        raise ServiceError("not_found", "No such invitation in this institution.", status=404)
    invitation.organization = org
    return invitation


def resend(actor, slug, invitation_id, ip_address=None):
    with managing(actor, slug) as org:
        invited = resend_invitation(
            _invitation_in(org, invitation_id), source=SOURCE, actor=actor, ip_address=ip_address
        )
    return invited


def revoke(actor, slug, invitation_id, data, ip_address=None):
    data = _body(data)
    with managing(actor, slug) as org:
        invitation = revoke_invitation(
            _invitation_in(org, invitation_id), source=SOURCE, actor=actor, reason=_reason(data),
            ip_address=ip_address,
        )
        invitation.organization = org
    return invitation


def import_members(actor, slug, data, ip_address=None):
    """Dry run unless `"dry_run": false` is sent; rows limited to the member/admin roles."""
    data = _body(data)
    dry_run = data.get("dry_run", True)
    if not isinstance(dry_run, bool):
        raise invalid({"dry_run": "Use true or false."})
    options = {"source": SOURCE, "actor": actor, "allowed_roles": PORTAL_ROLES, "ip_address": ip_address}
    if dry_run:
        return import_rows(access(actor, slug), data.get("rows"), dry_run=True, **options)
    with managing(actor, slug) as org:
        result = import_rows(org, data.get("rows"), dry_run=False, **options)
    return result


def _personal_plan_member():
    return ServiceError(
        "personal_plan_member", "This person pays for their own plan; their membership can't be changed here.",
        status=403,
    )


def _member_in(org, actor, membership_id):
    """A membership of `org` the portal may change: not the actor's own, not an owner's, not a pending sign-up
    request (those are not shown) and not a personal-plan member's."""
    membership = (
        Membership.objects.select_related("user").filter(pk=membership_id, organization=org)
        .exclude(status=Membership.Status.PENDING).first()
    )
    if membership is None:
        raise ServiceError("not_found", "No such member in this institution.", status=404)
    if is_personal_plan(membership):
        raise _personal_plan_member()
    if membership.user_id == actor.id:
        raise ServiceError("cannot_change_self", "You can't change your own membership here.", status=403)
    if membership.role == Membership.Role.OWNER:
        raise ServiceError("cannot_change_owner", "Owners can only be changed by BDREN AI support.", status=403)
    return membership


def update_member(actor, slug, membership_id, data, ip_address=None):
    """`{"role"?: member|admin, "status"?: active|suspended, "reason"?}` for covered members only (409 `not_covered`,
    403 `personal_plan_member`). Suspending keeps the seat."""
    data = _body(data)
    role, status = data.get("role"), data.get("status")
    if role is None and status is None:
        raise invalid({"non_field": "Send a role or a status."})
    if role is not None:
        _role(role if isinstance(role, str) else None)
    if status is not None and status not in (Membership.Status.ACTIVE, Membership.Status.SUSPENDED):
        raise invalid({"status": "Use active or suspended."})
    with managing(actor, slug) as org:
        membership = _member_in(org, actor, membership_id)
        if membership.status == Membership.Status.DEPROVISIONED:
            raise ServiceError(
                "membership_removed", "This member was removed. Invite them again instead.", status=409
            )
        if membership.coverage != Membership.Coverage.INSTITUTION:
            raise not_covered_error()
        updated = update_membership(
            membership, source=SOURCE, actor=actor, role=role, status=status, reason=_reason(data),
            ip_address=ip_address, allowed_roles=PORTAL_ROLES,
        )
    return updated


def remove_member(actor, slug, membership_id, data, ip_address=None):
    """Takes a covered member off the package (R5): coverage `none`, role `member`, seat freed; they keep their
    account and stay affiliated (Not covered). 409 `not_covered` otherwise; 403 `personal_plan_member`."""
    data = _body(data)
    with managing(actor, slug) as org:
        removed = uncover_membership(
            _member_in(org, actor, membership_id), source=SOURCE, actor=actor, reason=_reason(data),
            ip_address=ip_address,
        )
    return removed


def add_to_package(actor, slug, membership_id, data, ip_address=None):
    """"Add to package" (R4) for a not covered (free-tier) member: covers the same account, seat-checked, audited and
    notified by email. `{"role"?: member|admin, "reason"?}`; the role only ever rises. 409 `already_covered` for a
    covered member; personal-plan members need an invitation (409 `needs_consent_invitation`)."""
    data = _body(data)
    role = data.get("role")
    if role is not None:
        _role(role if isinstance(role, str) else None)
    with managing(actor, slug) as org:
        membership = Membership.objects.select_related("user").filter(
            pk=membership_id, organization=org, status__in=PORTAL_STATUSES
        ).first()
        if membership is None:
            raise ServiceError("not_found", "No such member in this institution.", status=404)
        if membership.coverage == COVERED:
            raise already_covered()
        if is_personal_plan(membership):
            raise consent_required()
        covered = cover_membership(
            membership, source=SOURCE, actor=actor, role=role, reason=_reason(data), ip_address=ip_address,
            allowed_roles=PORTAL_ROLES,
        )
    return covered
