"""JSON shapes of the superadmin API (docs/SUPERADMIN_API.md). Querysets come from `services`, annotated."""
from decimal import Decimal

from apps.invitations.shapes import iso, person
from apps.packages.services import AppsChange, TermChange

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
        "actor_role": entry.actor_role,
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


# ---------------------------------------------------------------- configuration: apps, features, packages

def app_ref(product):
    return {"slug": product.slug, "name": product.name}


def feature(item):
    """Needs `in_use` (`apps.packages.services` annotates it)."""
    return {
        "id": str(item.id),
        "key": item.key,
        "name": item.name,
        "unit": item.unit,
        "description": item.description,
        "quota_policy": item.quota_policy,
        "status": item.status,
        "in_use": item.in_use,
    }


def app(product):
    """Needs `apps.packages.services.apps()`."""
    return {
        "id": str(product.id),
        "slug": product.slug,
        "name": product.name,
        "description": product.description,
        "status": product.status,
        "sort_order": product.sort_order,
        "features": [feature(f) for f in product.features.all()],
        "packages": {"single": product.single_packages, "bundle": product.bundle_packages},
    }


def money(value):
    return f"{value:.2f}"


def limit_feature(item):
    return {
        "id": str(item.id),
        "key": item.key,
        "name": item.name,
        "unit": item.unit,
        "app": app_ref(item.product),
    }


def limit(item):
    return {
        "feature": limit_feature(item.feature),
        "limit_value": item.limit_value,
        "limit_period": item.limit_period,
        "on_limit": item.on_limit,
    }


def _terms(version):
    return {
        "price": money(version.price),
        "billing_interval": version.billing_interval,
        "price_unit": version.price_unit,
        "trial_days": version.trial_days,
        "seat_limit": version.seat_limit,
        "apps": [app_ref(p) for p in version.products.all()],
    }


def package_row(pkg, current):
    """`pkg` from `apps.packages.services.packages()`; `current` is its latest version, apps prefetched."""
    return {
        "id": str(pkg.id),
        "kind": pkg.kind,
        "name": pkg.name,
        "slug": pkg.slug,
        "status": pkg.status,
        "audience": pkg.audience,
        "is_public": pkg.is_public,
        "highlight": pkg.highlight,
        "sort_order": pkg.sort_order,
        **_terms(current),
        "currency": current.currency,
        "current_version": current.version,
        "subscribers": pkg.subscribers,
        "updated_at": iso(pkg.updated_at),
    }


def package_list_row(pkg):
    """Needs `apps.packages.services.package_list()`."""
    return package_row(pkg, pkg.current_versions[0])


def package_version(version):
    return {
        "version": version.version,
        "created_at": iso(version.created_at),
        "created_by": person(version.created_by),
        "change_reason": version.change_reason,
        "migration_policy": version.migration_policy,
        **_terms(version),
        "limits": [limit(item) for item in version.limits.all()],
        "subscribers": version.subscribers,
    }


def package_detail(pkg):
    """Needs `apps.packages.services.load_package()`."""
    current = pkg.all_versions[0]
    return {
        **package_row(pkg, current),
        "description": pkg.description,
        "limits": [limit(item) for item in current.limits.all()],
        "versions": [package_version(v) for v in pkg.all_versions],
    }


def _term_value(value):
    return money(value) if isinstance(value, Decimal) else value


def package_change(change):
    """A `TermChange`, `AppsChange` or `LimitChange` from `apps.packages.services.version_changes()`."""
    if isinstance(change, TermChange):
        return {"field": change.field, "from": _term_value(change.before), "to": _term_value(change.after)}
    if isinstance(change, AppsChange):
        return {
            "field": "apps",
            "added": [app_ref(p) for p in change.added],
            "removed": [app_ref(p) for p in change.removed],
        }
    return {"field": "limit", "feature": limit_feature(change.feature), "from": change.before, "to": change.after}


def _holder(subscription):
    """The institution holding a subscription, or for a personal account its owner."""
    org = subscription.account.organization
    if org is not None:
        return institution_ref(org)
    owner = subscription.account.owner_user
    return {"slug": None, "name": owner.name or owner.email}


def affected(subscriptions):
    """Select related `account__organization` and `account__owner_user` first."""
    rows = [
        {**_holder(sub), "subscription_id": str(sub.id), "status": sub.status}
        for sub in subscriptions
    ]
    return {"subscriptions": len(rows), "institutions": rows}
