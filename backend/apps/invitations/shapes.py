"""JSON shapes shared by the superadmin and portal APIs (docs/SUPERADMIN_API.md)."""
from datetime import timezone as dt_timezone

from .errors import invalid

DEFAULT_PAGE_SIZE = 25
MAX_PAGE_SIZE = 100


def iso(value):
    """`2026-11-18T07:00:00Z`, or None."""
    return value.astimezone(dt_timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if value else None


def person(user, *, with_email=True):
    if user is None:
        return None
    out = {"id": str(user.id), "name": user.name}
    if with_email:
        out["email"] = user.email
    return out


def serialize_invitation(invitation, *, inviter_email=True):
    """The contract's `Invitation`. Select related `organization`, `invited_by`, `accepted_by` first.
    The portal passes `inviter_email=False`.
    """
    org = invitation.organization
    return {
        "id": str(invitation.id),
        "email": invitation.email,
        "name": invitation.name,
        "institution": {"slug": org.slug, "name": org.name} if org else None,
        "role": invitation.role if org else None,
        "status": invitation.effective_status,
        "source": invitation.source,
        "invited_by": person(invitation.invited_by, with_email=inviter_email),
        "expires_at": iso(invitation.expires_at),
        "created_at": iso(invitation.created_at),
        "last_sent_at": iso(invitation.last_sent_at),
        "sent_count": invitation.sent_count,
        "email_status": invitation.email_status,
        "accepted_by": person(invitation.accepted_by),
        "accepted_at": iso(invitation.accepted_at),
    }


def serialize_member(membership):
    """The contract's `Member`. Select related `user` first."""
    user = membership.user
    return {
        "membership_id": str(membership.id),
        "user": {"id": str(user.id), "name": user.name, "email": user.email, "status": user.status},
        "role": membership.role,
        "status": membership.status,
        "joined_at": iso(membership.created_at),
    }


def _positive_int(query, key, default):
    raw = query.get(key)
    if raw in (None, ""):
        return default
    try:
        value = int(raw)
    except ValueError:
        raise invalid({key: "Use a whole number of at least 1."}) from None
    if value < 1:
        raise invalid({key: "Use a whole number of at least 1."})
    return value


def paginated(queryset, query, serialize):
    """`{"results", "count", "page", "page_size"}` from `?page=` (1-based) and `?page_size=` (default 25, max 100)."""
    page = _positive_int(query, "page", 1)
    size = min(_positive_int(query, "page_size", DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE)
    start = (page - 1) * size
    return {
        "results": [serialize(row) for row in queryset[start:start + size]],
        "count": queryset.count(),
        "page": page,
        "page_size": size,
    }
