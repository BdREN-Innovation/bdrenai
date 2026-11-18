"""Superadmin reads and actions on institutions, users, platform admins, the dashboard and the audit log.

Invitations, imports, seats and membership changes live in `apps.invitations.services` (shared with the
portal); this module adds what only the superadmin can do. Every mutation writes an AuditLog entry with
`metadata.source = "superadmin"`, and `metadata.organization_id` when an institution is involved.
"""
import uuid

from django.contrib.sessions.models import Session
from django.db import transaction
from django.db.models import Count, Exists, F, OuterRef, Prefetch, Q
from django.utils import timezone

from apps.administration.models import PlatformRoleAssignment
from apps.audit.models import AuditLog
from apps.audit.services import audit_entry, record_audit
from apps.identities.models import User, UserSession
from apps.invitations.errors import ServiceError, invalid
from apps.invitations.models import Invitation
from apps.invitations.services import (
    ADMIN_ROLES,
    audit_metadata,
    clean_institution,
    clean_name,
    count_per_organization,
    expired_q,
    filter_invitations,
    live_q,
    lock_organization,
    normalize_email,
    seats_expression,
    seats_used,
    with_counts,
    with_seats,
)
from apps.organizations.models import Membership, Organization

from . import shapes

SOURCE = Invitation.Source.SUPERADMIN
SUPER_ADMIN = PlatformRoleAssignment.Role.SUPER_ADMIN
MAX_REASON = 1000
OPTIONS_LIMIT = 20
ATTENTION_LIMIT = 10
RECENT_INSTITUTIONS = 5
RECENT_ACTIVITY = 10
USER_ACTIVITY = 20
OPEN_INVITATIONS = (Invitation.Status.PENDING, Invitation.Status.EXPIRED)
ACTIVE = Organization.Status.ACTIVE
SUSPENDED = Organization.Status.SUSPENDED
DEACTIVATED = Organization.Status.DEACTIVATED
# action -> (new status, statuses it may start from, past tense for the audit action)
STATUS_ACTIONS = {
    "suspend": (SUSPENDED, {ACTIVE}, "suspended"),
    "reactivate": (ACTIVE, {SUSPENDED, DEACTIVATED}, "reactivated"),
    "deactivate": (DEACTIVATED, {ACTIVE, SUSPENDED}, "deactivated"),
}


# ---------------------------------------------------------------- helpers

def _audit(*, actor, action, target_type, target_id, ip_address, organization_id=None, **values):
    return record_audit(
        actor=actor, action=action, target_type=target_type, target_id=target_id,
        metadata=audit_metadata(organization_id, source=SOURCE, **values), ip_address=ip_address,
    )


def clean_reason(value, *, required=False):
    reason = clean_name(value, limit=MAX_REASON)
    if required and not reason:
        raise invalid({"reason": "Give a reason; it is kept in the audit log."})
    return reason


def not_found(message):
    return ServiceError("not_found", message, status=404)


# ---------------------------------------------------------------- institutions

def institutions(now=None):
    """Organizations annotated with seats and the counts the API shows: one query for any number of rows."""
    return with_counts(Organization.objects.all(), now)


def admins_prefetch(limit=None):
    """Active owners/admins as `org.active_admins`, oldest first (one query for the whole page)."""
    qs = (
        Membership.objects.filter(status=Membership.Status.ACTIVE, role__in=ADMIN_ROLES)
        .select_related("user")
        .order_by("created_at", "pk")
    )
    return Prefetch("memberships", queryset=qs[:limit] if limit else qs, to_attr="active_admins")


def institution_list(*, q="", status=None):
    """Removed (deactivated) institutions only show when asked for with `status`."""
    qs = institutions().prefetch_related(admins_prefetch(shapes.LIST_ADMINS))
    qs = qs.filter(status=status) if status else qs.exclude(status=DEACTIVATED)
    if q:
        qs = qs.filter(Q(name__icontains=q) | Q(slug__icontains=q))
    return qs.order_by("name", "pk")


def institution_options(q=""):
    qs = with_seats(Organization.objects.exclude(status=DEACTIVATED))
    if q:
        qs = qs.filter(Q(name__icontains=q) | Q(slug__icontains=q))
    return qs.order_by("name", "pk")[:OPTIONS_LIMIT]


def load_institution(slug):
    """The annotated institution with all its active admins, or a 404."""
    org = institutions().prefetch_related(admins_prefetch()).filter(slug=slug).first()
    if org is None:
        raise not_found("No institution with this slug.")
    return org


def find_institution(slug, field="institution"):
    """A plain Organization named in a request body (400 on the field if unknown)."""
    org = Organization.objects.filter(slug=slug).first() if isinstance(slug, str) else None
    if org is None:
        raise invalid({field: "No institution with this slug."})
    return org


def update_institution(org, data, *, actor=None, ip_address=None):
    """PATCH: any of name/type/timezone/contact_email/sign_in_domains/seat_cap; a cap change needs `reason`."""
    fields = clean_institution(data, partial=True)
    reason = clean_reason(data.get("reason"))
    with transaction.atomic():
        current = lock_organization(org)
        changes = {k: [getattr(current, k), v] for k, v in fields.items() if getattr(current, k) != v}
        if "seat_cap" in changes and not reason:
            raise invalid({"reason": "Give a reason for changing the seat cap."})
        if not changes:
            return current
        for key, (_, new) in changes.items():
            setattr(current, key, new)
        update = [*changes, "updated_at"]
        if "seat_cap" in changes:
            current.seat_cap_reason = reason
            update.append("seat_cap_reason")
        current.save(update_fields=update)
        _audit(
            actor=actor, action="organization.updated", target_type="Organization", target_id=current.id,
            organization_id=current.id, ip_address=ip_address, changes=changes, reason=reason,
        )
    return current


def over_cap(org):
    return org.seat_cap is not None and seats_used(org) > org.seat_cap


def change_institution_status(org, action, *, reason, confirm=None, actor=None, ip_address=None):
    """`suspend`, `reactivate` or `deactivate` (soft removal; needs the exact name in `confirm` and
    revokes open invitations)."""
    target, allowed, done = STATUS_ACTIONS[action]
    reason = clean_reason(reason, required=True)
    with transaction.atomic():
        current = lock_organization(org)
        if action == "deactivate" and confirm != current.name:
            raise ServiceError(
                "confirm_mismatch", "Type the institution's exact name to confirm.",
                fields={"confirm": "This does not match the institution's name."},
            )
        if current.status not in allowed:
            raise ServiceError(
                "invalid_transition", f"An institution that is {current.status} can't be {done}.",
                status=409, extra={"status": current.status},
            )
        previous = current.status
        current.status = target
        current.save(update_fields=["status", "updated_at"])
        revoked = _revoke_open_invitations(current, actor, ip_address) if target == DEACTIVATED else None
        _audit(
            actor=actor, action=f"organization.{done}", target_type="Organization", target_id=current.id,
            organization_id=current.id, ip_address=ip_address, reason=reason, previous_status=previous,
            revoked_invitations=revoked,
        )
    return current


def _revoke_open_invitations(org, actor, ip_address):
    ids = list(
        Invitation.objects.select_for_update()
        .filter(organization=org, status__in=OPEN_INVITATIONS)
        .values_list("pk", flat=True)
    )
    Invitation.objects.filter(pk__in=ids).update(status=Invitation.Status.REVOKED)
    AuditLog.objects.bulk_create([
        audit_entry(
            actor=actor, action="invitation.revoked", target_type="Invitation", target_id=pk,
            metadata=audit_metadata(org.id, source=SOURCE, reason="institution_deactivated"), ip_address=ip_address,
        )
        for pk in ids
    ])
    return len(ids)


def institution_history(org):
    """Entries about the institution, its memberships and invitations (indexed on metadata.organization_id)."""
    return AuditLog.objects.select_related("actor").filter(metadata__organization_id=str(org.id))


# ---------------------------------------------------------------- users

def users():
    """Users with memberships (and their institutions) prefetched and `is_superadmin` annotated."""
    memberships = Membership.objects.select_related("organization").order_by("created_at", "pk")
    return User.objects.annotate(
        is_superadmin=Exists(PlatformRoleAssignment.objects.filter(user=OuterRef("pk"), role=SUPER_ADMIN))
    ).prefetch_related(Prefetch("memberships", queryset=memberships))


def user_list(*, q="", status=None, institution=None, role=None):
    """`institution` and `role` match one current (not removed) membership together."""
    qs = users()
    if status:
        qs = qs.filter(status=status)
    if q:
        qs = qs.filter(Q(name__icontains=q) | Q(email__icontains=q))
    if institution or role:
        scope = Membership.objects.filter(user=OuterRef("pk")).exclude(status=Membership.Status.DEPROVISIONED)
        if institution:
            scope = scope.filter(organization__slug=institution)
        if role:
            scope = scope.filter(role=role)
        qs = qs.filter(Exists(scope))
    return qs.order_by("-created_at", "pk")


def audit_filter_options():
    """The actions and target types that occur in the log, for the audit page's fixed filters."""
    actions = AuditLog.objects.order_by("action").values_list("action", flat=True).distinct()
    target_types = AuditLog.objects.order_by("target_type").values_list("target_type", flat=True).distinct()
    return {
        "actions": list(actions),
        "target_types": list(target_types),
        "roles": [{"value": value, "label": label} for value, label in AuditLog.ActorRole.choices],
    }


def load_user(user_id):
    user = users().prefetch_related("external_identities").filter(pk=user_id).first()
    if user is None:
        raise not_found("No user with this id.")
    return user


def user_activity(user):
    """Latest entries where the user is the actor or the target."""
    return (
        AuditLog.objects.select_related("actor")
        .filter(Q(actor=user) | Q(target_type="User", target_id=str(user.id)))
        .order_by("-created_at")[:USER_ACTIVITY]
    )


def end_sessions(user):
    """Deletes the user's server-side sessions, found through the UserSession rows written at sign-in.

    Costs one indexed lookup per user, whatever the number of sessions on the platform. A suspended user is
    signed out on their next request anyway (inactive users never authenticate); this removes the rows.
    """
    keys = list(UserSession.objects.filter(user=user).values_list("session_key", flat=True))
    ended, _ = Session.objects.filter(session_key__in=keys).delete()
    UserSession.objects.filter(user=user).delete()
    return ended


def set_user_status(user, *, status, reason, actor, ip_address=None):
    """`active` or `suspended`; suspending signs the user out everywhere. Nobody can suspend themself."""
    if status not in (User.Status.ACTIVE, User.Status.SUSPENDED):
        raise invalid({"status": "Use active or suspended."})
    reason = clean_reason(reason, required=True)
    if status == User.Status.SUSPENDED and user.pk == actor.pk:
        raise ServiceError("cannot_suspend_self", "You can't suspend your own account.", status=409)
    with transaction.atomic():
        current = User.objects.select_for_update().get(pk=user.pk)
        if current.status == status:
            return current
        previous = current.status
        current.status = status
        current.save(update_fields=["status"])
        ended = end_sessions(current) if status == User.Status.SUSPENDED else None
        _audit(
            actor=actor, action="user.status_changed", target_type="User", target_id=current.id,
            ip_address=ip_address, previous_status=previous, status=status, reason=reason, sessions_ended=ended,
        )
    return current


# ---------------------------------------------------------------- invitations

def invitations():
    return Invitation.objects.select_related("organization", "invited_by", "accepted_by")


def invitation_list(*, q="", status=None, institution=None):
    """`status` is the reported one: a pending invitation past its expiry counts as `expired`."""
    qs = invitations()
    if institution:
        qs = qs.filter(organization__slug=institution)
    return filter_invitations(qs, status=status, q=q)


# ---------------------------------------------------------------- platform admins

def platform_admins():
    return PlatformRoleAssignment.objects.filter(role=SUPER_ADMIN).select_related("user").order_by("created_at", "pk")


def find_user(*, user_id=None, email=None):
    """Exactly one existing user, by id or by a verified email (anyone can register an account with any email
    without proving it, so unverified rows never match; emails are not unique, so 409 when several match)."""
    if user_id not in (None, ""):
        try:
            uid = uuid.UUID(str(user_id))
        except ValueError:
            raise invalid({"user_id": "Use a user id (UUID)."}) from None
        user = User.objects.filter(pk=uid).first()
        if user is None:
            raise not_found("No user with this id.")
        return user
    if email in (None, ""):
        raise invalid({"user_id": "Give a user id or an email."})
    clean = normalize_email(email)
    if clean is None:
        raise invalid({"email": "Enter a valid email address."})
    matches = list(User.objects.filter(email__iexact=clean, email_verified=True)[:2])
    if not matches:
        raise not_found(
            "No user has verified this email. They must sign in once and verify it first, or choose the user by id."
        )
    if len(matches) > 1:
        raise ServiceError(
            "ambiguous_email", "More than one user has this email; choose the user by id.", status=409,
            fields={"email": "Several users have this email."},
        )
    return matches[0]


def grant_superadmin(user, *, actor, ip_address=None):
    with transaction.atomic():
        assignment, created = PlatformRoleAssignment.objects.get_or_create(user=user, role=SUPER_ADMIN)
        if not created:
            raise ServiceError("already_superadmin", "This user is already a superadmin.", status=409)
        _audit(
            actor=actor, action="platform_role.granted", target_type="User", target_id=user.id,
            ip_address=ip_address, role=SUPER_ADMIN,
        )
    return assignment


def revoke_superadmin(user_id, *, actor, ip_address=None):
    """Locks every superadmin row, so two admins removing each other cannot leave none."""
    if str(user_id) == str(actor.pk):
        raise ServiceError("cannot_remove_self", "You can't remove your own superadmin role.", status=409)
    with transaction.atomic():
        rows = list(platform_admins().select_for_update(of=("self",)))
        target = next((row for row in rows if str(row.user_id) == str(user_id)), None)
        if target is None:
            raise not_found("This user is not a superadmin.")
        if len(rows) <= 1:
            raise ServiceError("last_superadmin", "The platform must keep at least one superadmin.", status=409)
        target.delete()
        _audit(
            actor=actor, action="platform_role.revoked", target_type="User", target_id=user_id,
            ip_address=ip_address, role=SUPER_ADMIN,
        )


# ---------------------------------------------------------------- dashboard and audit

def _counts(now):
    orgs = Organization.objects.aggregate(
        institutions=Count("pk", filter=~Q(status=DEACTIVATED)),
        active_institutions=Count("pk", filter=Q(status=ACTIVE)),
    )
    people = User.objects.aggregate(users=Count("pk"), active_users=Count("pk", filter=Q(status=User.Status.ACTIVE)))
    invites = Invitation.objects.exclude(organization__status=DEACTIVATED).aggregate(
        pending_invitations=Count("pk", filter=live_q(now)),
        expired_invitations=Count("pk", filter=expired_q(now)),
    )
    requests = Membership.objects.filter(status=Membership.Status.PENDING).exclude(
        organization__status=DEACTIVATED
    ).count()
    return {**orgs, **people, **invites, "pending_requests": requests}


def _attention(now, counts):
    live = Organization.objects.exclude(status=DEACTIVATED)
    near_cap = (
        live.filter(seat_cap__isnull=False)
        .annotate(used_seats=seats_expression(now))
        .alias(used_tenths=F("used_seats") * 10, cap_ninths=F("seat_cap") * 9)
        .filter(used_tenths__gte=F("cap_ninths"))
        .order_by("-used_seats", "name")[:ATTENTION_LIMIT]
    )
    requests = (
        live.annotate(pending=count_per_organization(
            Membership.objects.filter(organization=OuterRef("pk"), status=Membership.Status.PENDING)
        ))
        .filter(pending__gt=0)
        .order_by("-pending", "name")[:ATTENTION_LIMIT]
    )
    items = [
        {"kind": "seats_near_cap", "institution": shapes.institution_ref(org), "seats": shapes.seats(org)}
        for org in near_cap
    ]
    if counts["expired_invitations"]:
        items.append({"kind": "expired_invitations", "count": counts["expired_invitations"]})
    items.extend(
        {"kind": "pending_requests", "institution": shapes.institution_ref(org), "count": org.pending}
        for org in requests
    )
    return items


def dashboard():
    now = timezone.now()
    counts = _counts(now)
    recent = with_seats(Organization.objects.exclude(status=DEACTIVATED)).order_by("-created_at")[:RECENT_INSTITUTIONS]
    activity = AuditLog.objects.select_related("actor").order_by("-created_at")[:RECENT_ACTIVITY]
    return {
        "counts": counts,
        "attention": _attention(now, counts),
        "recent_institutions": [shapes.institution_summary(org) for org in recent],
        "recent_activity": [shapes.audit_entry(entry) for entry in activity],
    }


def audit_entries(*, q="", action=None, actor=None, role=None, target_type=None, target_id=None, since=None,
                  until=None):
    qs = AuditLog.objects.select_related("actor")
    if q:
        qs = qs.filter(
            Q(action__icontains=q) | Q(target_type__icontains=q) | Q(target_id__icontains=q)
            | Q(actor__email__icontains=q) | Q(actor__name__icontains=q)
        )
    if action:
        qs = qs.filter(action=action)
    if actor:
        qs = qs.filter(actor_id=actor)
    if role:
        qs = qs.filter(actor_role=role)
    if target_type:
        qs = qs.filter(target_type=target_type)
    if target_id:
        qs = qs.filter(target_id=target_id)
    if since:
        qs = qs.filter(created_at__gte=since)
    if until:
        qs = qs.filter(created_at__lte=until)
    return qs.order_by("-created_at", "pk")
