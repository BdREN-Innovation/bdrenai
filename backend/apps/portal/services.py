"""Institution-admin portal: who may manage which institution, the reads behind its Members page, and the
portal's own limits on top of the shared invitation and membership services.

Access needs an active owner/admin membership in that institution and the institution to be active;
platform roles grant nothing here. Mutations re-check that access with the organization row locked, so an
admin removed or demoted a moment earlier cannot act. Portal admins invite and assign only member/admin,
and never change an owner or themselves. Every audit entry carries `source = "portal"`.
"""
from contextlib import contextmanager

from django.db import transaction
from django.db.models import F

from apps.invitations.errors import ServiceError, invalid
from apps.invitations.models import Invitation
from apps.invitations.services import (
    ADMIN_ROLES,
    PORTAL_ROLES,
    clean_name,
    create_invitation,
    filter_invitations,
    filter_members,
    import_rows,
    lock_organization,
    remove_membership,
    resend_invitation,
    revoke_invitation,
    update_membership,
    with_counts,
    with_seats,
)
from apps.invitations.shapes import paginated, serialize_invitation, serialize_member
from apps.organizations.models import Membership, Organization

SOURCE = Invitation.Source.PORTAL
REASON_LIMIT = 1000


# ---------------------------------------------------------------- access

def _not_found():
    return ServiceError("not_found", "You don't administer an institution at this address.", status=404)


def _check_access(membership):
    """Raises unless `membership` (with its organization loaded) lets its user manage the institution."""
    if membership is None or membership.status != Membership.Status.ACTIVE:
        raise _not_found()
    if membership.role not in ADMIN_ROLES:
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
    """Institutions (not removed) where `user` is an active owner/admin, with seats and their role."""
    orgs = with_seats(
        Organization.objects.filter(
            memberships__user=user,
            memberships__status=Membership.Status.ACTIVE,
            memberships__role__in=ADMIN_ROLES,
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
        },
        "sign_in_domains": org.sign_in_domains,
    }


def _choice(query, key, choices):
    value = query.get(key) or None
    if value is not None and value not in choices:
        raise invalid({key: f"Use one of: {', '.join(choices)}."})
    return value


def list_members(org, query):
    """`?q=&status=&role=&page=`; without `status`, removed (deprovisioned) members are left out."""
    members = filter_members(
        org,
        q=(query.get("q") or "").strip(),
        status=_choice(query, "status", Membership.Status.values),
        role=_choice(query, "role", Membership.Role.values),
    )
    return paginated(members, query, serialize_member)


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


def _member_in(org, actor, membership_id):
    """A membership of `org` the portal may change: not the actor's own, not an owner's."""
    membership = Membership.objects.filter(pk=membership_id, organization=org).first()
    if membership is None:
        raise ServiceError("not_found", "No such member in this institution.", status=404)
    if membership.user_id == actor.id:
        raise ServiceError("cannot_change_self", "You can't change your own membership here.", status=403)
    if membership.role == Membership.Role.OWNER:
        raise ServiceError("cannot_change_owner", "Owners can only be changed by BDREN AI support.", status=403)
    return membership


def update_member(actor, slug, membership_id, data, ip_address=None):
    """`{"role"?: member|admin, "status"?: active|suspended, "reason"?}`; activation is seat-checked."""
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
        updated = update_membership(
            membership, source=SOURCE, actor=actor, role=role, status=status, reason=_reason(data),
            ip_address=ip_address, allowed_roles=PORTAL_ROLES,
        )
    return updated


def remove_member(actor, slug, membership_id, data, ip_address=None):
    """Soft removal (`deprovisioned`), which frees the seat."""
    data = _body(data)
    with managing(actor, slug) as org:
        removed = remove_membership(
            _member_in(org, actor, membership_id), source=SOURCE, actor=actor, reason=_reason(data),
            ip_address=ip_address,
        )
    return removed
