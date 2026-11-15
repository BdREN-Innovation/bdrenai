"""Entitlement synchronization and mixed-quota resolution."""
from datetime import datetime, timedelta
from datetime import timezone as dt_tz

from django.db import transaction
from django.utils import timezone

from apps.accounts.models import Account
from apps.organizations.models import Membership, Organization
from apps.packages.models import PackageLimit
from apps.products.models import Feature, Product
from apps.subscriptions.models import Subscription

from .models import Entitlement


def current_period_bounds(period: str, now=None):
    """Returns (period_start, period_end) in UTC for a limit period."""
    now = now or timezone.now()
    if period == PackageLimit.Period.DAILY:
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        return start, start + timedelta(days=1)
    if period == PackageLimit.Period.YEARLY:
        start = datetime(now.year, 1, 1, tzinfo=dt_tz.utc)
        end = datetime(now.year + 1, 1, 1, tzinfo=dt_tz.utc)
        return start, end
    if period == PackageLimit.Period.LIFETIME:
        start = datetime(2020, 1, 1, tzinfo=dt_tz.utc)
        end = datetime(2099, 1, 1, tzinfo=dt_tz.utc)
        return start, end
    # Default: MONTHLY
    start = datetime(now.year, now.month, 1, tzinfo=dt_tz.utc)
    if now.month == 12:
        end = datetime(now.year + 1, 1, 1, tzinfo=dt_tz.utc)
    else:
        end = datetime(now.year, now.month + 1, 1, tzinfo=dt_tz.utc)
    return start, end


@transaction.atomic
def sync_subscription_entitlements(subscription: Subscription):
    """Rebuilds subscription-derived Entitlements from the Subscription's current PackageVersion."""
    Entitlement.objects.filter(source_subscription=subscription, is_override=False).delete()
    if subscription.status not in (Subscription.Status.ACTIVE, Subscription.Status.TRIAL):
        return []
    created = []
    for pl in subscription.package_version.limits.select_related("feature").all():
        created.append(
            Entitlement.objects.create(
                account=subscription.account,
                product=subscription.product,
                feature=pl.feature,
                limit=pl.limit_value,
                period=pl.limit_period,
                source_subscription=subscription,
                is_override=False,
                effective_from=subscription.starts_at,
                effective_until=subscription.expires_at,
            )
        )
    return created


@transaction.atomic
def set_entitlement_override(*, account: Account, product: Product, feature: Feature, limit: int, period: str = "monthly", effective_until=None):
    """Creates or updates an administrator manual entitlement override for an account."""
    Entitlement.objects.filter(account=account, product=product, feature=feature, is_override=True).delete()
    return Entitlement.objects.create(
        account=account,
        product=product,
        feature=feature,
        limit=limit,
        period=period,
        is_override=True,
        effective_from=timezone.now(),
        effective_until=effective_until,
    )


def effective_entitlement_for_account(account: Account, product: Product, feature: Feature, now=None):
    """Returns the effective Entitlement for a single Account (manual override takes precedence over subscription)."""
    now = now or timezone.now()
    qs = Entitlement.objects.filter(
        account=account,
        product=product,
        feature=feature,
        effective_from__lte=now,
    ).filter(models_q_not_expired(now))
    override = qs.filter(is_override=True).order_by("-created_at").first()
    if override is not None:
        return override
    return qs.filter(is_override=False).order_by("-limit", "-created_at").first()


def models_q_not_expired(now):
    from django.db.models import Q
    return Q(effective_until__isnull=True) | Q(effective_until__gt=now)


def resolve_candidate_accounts(*, user, organization_account: Account = None, quota_policy: str):
    """Determines the ordered list of Accounts to check/consume based on the feature's mixed quota policy.
    Always validates that `user` owns the personal account and has an active Membership in the organization.
    """
    personal_acct = Account.objects.filter(
        owner_user=user, account_type=Account.Type.PERSONAL, status=Account.Status.ACTIVE
    ).first()

    org_acct = None
    if organization_account is not None:
        if organization_account.account_type != Account.Type.ORGANIZATION or organization_account.status != Account.Status.ACTIVE:
            raise PermissionError("Organization account is not active")
        has_mem = Membership.objects.filter(
            user=user,
            organization_id=organization_account.organization_id,
            status=Membership.Status.ACTIVE,
            organization__status=Organization.Status.ACTIVE,
        ).exists()
        if not has_mem:
            raise PermissionError("User is not an active member of the organization")
        org_acct = organization_account

    if quota_policy == Feature.QuotaPolicy.PERSONAL_ONLY:
        return [personal_acct] if personal_acct else []
    if quota_policy == Feature.QuotaPolicy.ORGANIZATION_ONLY:
        return [org_acct] if org_acct else []
    if quota_policy == Feature.QuotaPolicy.ORG_THEN_PERSONAL:
        return [a for a in (org_acct, personal_acct) if a is not None]
    if quota_policy == Feature.QuotaPolicy.BOTH:
        if personal_acct and org_acct:
            return [personal_acct, org_acct]
        return []
    # Default: PERSONAL_THEN_ORG
    return [a for a in (personal_acct, org_acct) if a is not None]
