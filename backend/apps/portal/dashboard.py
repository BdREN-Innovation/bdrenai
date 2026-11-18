"""The portal's dashboard: seats, member counts, this week's usage, top members and package expiry, in one call."""
from django.utils import timezone

from apps.accounts.models import Account
from apps.invitations.services import with_counts
from apps.invitations.shapes import iso
from apps.organizations.models import Organization
from apps.subscriptions.models import Subscription

from . import usage

CURRENT_SUBSCRIPTION_STATUSES = (
    Subscription.Status.ACTIVE, Subscription.Status.TRIAL, Subscription.Status.PAST_DUE,
)
EXPIRY_WARNING_DAYS = 30


def _package(subscription, now):
    version = subscription.package_version
    days_left = (subscription.expires_at - now).days if subscription.expires_at else None
    return {
        "subscription_id": str(subscription.id),
        "product": {"slug": subscription.product.slug, "name": subscription.product.name},
        "package": {"name": version.package.name, "version": version.version},
        "status": subscription.status,
        "billing_interval": subscription.billing_interval,
        "starts_at": iso(subscription.starts_at),
        "expires_at": iso(subscription.expires_at),
        "auto_renew": subscription.auto_renew,
        "days_left": days_left,
        "expires_soon": days_left is not None and days_left <= EXPIRY_WARNING_DAYS,
    }


def packages(org, now=None):
    """The institution account's current (active, trial or past due) subscriptions, soonest expiry first."""
    now = now or timezone.now()
    subscriptions = (
        Subscription.objects.filter(
            account__organization=org, account__account_type=Account.Type.ORGANIZATION,
            status__in=CURRENT_SUBSCRIPTION_STATUSES,
        )
        .select_related("product", "package_version__package")
        .order_by("expires_at", "product__name")
    )
    return [_package(s, now) for s in subscriptions]


def dashboard(org, query):
    """`?product=<slug>` narrows the usage panel to one app (default: all apps)."""
    product = usage.product_from(query)
    org = with_counts(Organization.objects.filter(pk=org.pk)).get()
    return {
        "slug": org.slug,
        "name": org.name,
        "seats": {"used": org.used_seats, "cap": org.seat_cap},
        "counts": {
            "covered_active": org.active_members,
            "covered_suspended": org.suspended_members,
            "not_covered": org.not_covered_members,
            "personal_plan": org.personal_plan_members,
            "pending_invitations": org.pending_invitations,
            "expired_invitations": org.expired_invitations,
        },
        "product": usage.product_shape(product),
        "usage": usage.week(org, product),
        "packages": packages(org),
    }
