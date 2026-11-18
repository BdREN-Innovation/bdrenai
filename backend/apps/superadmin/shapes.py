"""JSON shapes of the superadmin API (docs/SUPERADMIN_API.md). Querysets come from `services`, annotated."""
from apps.invitations.shapes import iso, person

LIST_ADMINS = 3


def seats(org):
    return {"used": org.used_seats, "cap": org.seat_cap}


def institution_ref(org):
    return {"slug": org.slug, "name": org.name}


def initials(user):
    words = (user.name or "").split()
    letters = "".join(word[0] for word in words[:2]) or (user.email or "?")[:1]
    return letters.upper()


def session(user, roles):
    return {
        "user": {"id": str(user.id), "email": user.email, "name": user.name, "initials": initials(user)},
        "roles": sorted(roles),
    }


def institution_row(org):
    """Needs `services.institutions()` and `services.admins_prefetch(LIST_ADMINS)`."""
    return {
        "id": str(org.id),
        "slug": org.slug,
        "name": org.name,
        "type": org.type,
        "sector": org.sector,
        "status": org.status,
        "seats": seats(org),
        "admins": [person(m.user) for m in org.active_admins],
        "members_count": org.active_members + org.suspended_members,
        "pending_invitations": org.pending_invitations,
        "pending_requests": org.pending_requests,
        "created_at": iso(org.created_at),
    }


def institution_option(org):
    return {"slug": org.slug, "name": org.name, "status": org.status, "seats": seats(org)}


def institution_summary(org):
    return {**institution_ref(org), "created_at": iso(org.created_at), "seats": seats(org)}


def institution_detail(org):
    """Needs `services.institutions()` and `services.admins_prefetch()`."""
    return {
        "id": str(org.id),
        "slug": org.slug,
        "name": org.name,
        "type": org.type,
        "sector": org.sector,
        "status": org.status,
        "timezone": org.timezone,
        "contact_email": org.contact_email,
        "sign_in_domains": org.sign_in_domains,
        "seats": seats(org),
        "seat_cap_reason": org.seat_cap_reason,
        "counts": {
            "members": org.active_members + org.suspended_members,
            "active": org.active_members,
            "suspended": org.suspended_members,
            "pending_invitations": org.pending_invitations,
            "expired_invitations": org.expired_invitations,
            "pending_requests": org.pending_requests,
        },
        "admins": [
            {
                "membership_id": str(m.id),
                "user_id": str(m.user_id),
                "name": m.user.name,
                "email": m.user.email,
                "role": m.role,
            }
            for m in org.active_admins
        ],
        "created_at": iso(org.created_at),
        "updated_at": iso(org.updated_at),
    }


def user_membership(membership):
    return {
        "membership_id": str(membership.id),
        "institution": institution_ref(membership.organization),
        "role": membership.role,
        "status": membership.status,
    }


def user_row(user):
    """Needs `services.users()` (memberships prefetched, `is_superadmin` annotated)."""
    return {
        "id": str(user.id),
        "name": user.name,
        "email": user.email,
        "email_verified": user.email_verified,
        "status": user.status,
        "created_at": iso(user.created_at),
        "last_login_at": iso(user.last_login_sync_at),
        "memberships": [user_membership(m) for m in user.memberships.all()],
        "is_superadmin": user.is_superadmin,
    }


def user_detail(user, activity):
    return {
        **user_row(user),
        "zitadel_subject": user.zitadel_subject,
        "issuer": user.issuer,
        "external_identities": [
            {
                "issuer": identity.issuer,
                "subject": identity.subject,
                "provider_type": identity.provider_type,
                "created_at": iso(identity.created_at),
            }
            for identity in user.external_identities.all()
        ],
        "recent_activity": [audit_entry(entry) for entry in activity],
    }


def audit_entry(entry):
    """Select related `actor` first."""
    return {
        "id": str(entry.id),
        "action": entry.action,
        "target_type": entry.target_type,
        "target_id": entry.target_id,
        "actor": person(entry.actor),
        "metadata": entry.metadata,
        "ip_address": entry.ip_address,
        "created_at": iso(entry.created_at),
    }


def platform_admin(assignment):
    user = assignment.user
    return {
        "user": {"id": str(user.id), "name": user.name, "email": user.email, "status": user.status},
        "granted_at": iso(assignment.created_at),
    }
