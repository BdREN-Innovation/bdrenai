"""Entitlement synchronization and mixed-quota resolution.

Which plan a person uses, per product: covered by an institution (an active membership with coverage `institution` in
an active institution) whose account has a current subscription or entitlement for the product -> the institution's
account; else an active personal subscription -> the personal account; else the product's BDREN free package
(`Package.billing_interval = free`), applied to the personal account.
"""
from datetime import datetime, timedelta
from datetime import timezone as dt_tz

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from apps.accounts.models import Account
from apps.organizations.models import Membership, Organization
from apps.packages.models import Package, PackageLimit, PackageVersion
from apps.products.models import Feature, Product
from apps.subscriptions.models import Subscription
from apps.subscriptions.plans import PLAN_STATUSES, covers_q, has_personal_plan

from .models import Entitlement


def current_period_bounds(period: str, now=None):
    """Returns (period_start, period_end) in UTC for a limit period."""
    now = now or timezone.now()
    if period == PackageLimit.Period.DAILY:
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        return start, start + timedelta(days=1)
    if period == PackageLimit.Period.WEEKLY:
        start = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
        return start, start + timedelta(days=7)
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
    """Rebuilds subscription-derived Entitlements from the Subscription's current PackageVersion. A combined
    package's limits apply to each feature's own app."""
    Entitlement.objects.filter(source_subscription=subscription, is_override=False).delete()
    if subscription.status not in (Subscription.Status.ACTIVE, Subscription.Status.TRIAL):
        return []
    created = []
    for pl in subscription.package_version.limits.select_related("feature").all():
        created.append(
            Entitlement.objects.create(
                account=subscription.account,
                product_id=subscription.product_id or pl.feature.product_id,
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


def effective_entitlement_for_account(account: Account, product: Product, feature: Feature, now=None, *,
                                      free_fallback=False):
    """Returns the effective Entitlement for a single Account (manual override takes precedence over subscription).
    With `free_fallback`, a personal account with no current subscription to `product` gets the product's free
    package limit instead (an unsaved Entitlement), or None when the free package does not include `feature`."""
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
    found = qs.filter(is_override=False).order_by("-limit", "-created_at").first()
    if found is not None or not free_fallback or account.account_type != Account.Type.PERSONAL:
        return found
    if _has_current_subscription(account, product, now):
        return None
    return free_entitlement(account, product, feature, now)


def _has_current_subscription(account, product, now):
    return Subscription.objects.filter(
        covers_q(product), account=account, status__in=PLAN_STATUSES
    ).filter(Q(expires_at__isnull=True) | Q(expires_at__gt=now)).exists()


def provides(account, product, now=None):
    """Whether `account` has a current subscription or entitlement for `product`."""
    now = now or timezone.now()
    if _has_current_subscription(account, product, now):
        return True
    return Entitlement.objects.filter(
        account=account, product=product, effective_from__lte=now
    ).filter(models_q_not_expired(now)).exists()


def free_package(product: Product):
    """The product's BDREN free package (active, `billing_interval = free`; the oldest if several), or None."""
    return (
        Package.objects.filter(
            kind=Package.Kind.SINGLE,
            product=product,
            billing_interval=Package.BillingInterval.FREE,
            status=Package.Status.ACTIVE,
        )
        .order_by("created_at", "pk")
        .first()
    )


def free_entitlement(account: Account, product: Product, feature: Feature, now=None):
    """Unsaved Entitlement carrying the free package's limit for `feature` (latest active version), or None."""
    package = free_package(product)
    if package is None:
        return None
    limit = (
        PackageLimit.objects.filter(
            package_version__package=package, package_version__status=PackageVersion.Status.ACTIVE, feature=feature
        )
        .order_by("-package_version__version")
        .first()
    )
    if limit is None:
        return None
    return Entitlement(
        account=account, product=product, feature=feature, limit=limit.limit_value, period=limit.limit_period,
        is_override=False, effective_from=now or timezone.now(),
    )


def models_q_not_expired(now):
    return Q(effective_until__isnull=True) | Q(effective_until__gt=now)


# ---------------------------------------------------------------- who covers the user

def institution_membership(user):
    """The user's membership in an institution (active or suspended, institution not removed), or None. A person
    belongs to one institution at most."""
    return (
        Membership.objects.select_related("organization")
        .filter(user=user, status__in=(Membership.Status.ACTIVE, Membership.Status.SUSPENDED))
        .exclude(organization__status=Organization.Status.DEACTIVATED)
        .first()
    )


def is_covered(membership):
    return (
        membership is not None
        and membership.status == Membership.Status.ACTIVE
        and membership.coverage == Membership.Coverage.INSTITUTION
        and membership.organization.status == Organization.Status.ACTIVE
    )


def covered_organization_account(user):
    """The active organization Account of the institution covering `user`, or None."""
    membership = institution_membership(user)
    if not is_covered(membership):
        return None
    return _organization_account(membership.organization_id)


def _organization_account(organization_id):
    return Account.objects.filter(
        organization_id=organization_id, account_type=Account.Type.ORGANIZATION, status=Account.Status.ACTIVE,
    ).first()


def _covers(membership, product):
    """Whether `membership` covers its user for `product` (any product when None)."""
    if not is_covered(membership):
        return False
    if product is None:
        return True
    account = _organization_account(membership.organization_id)
    return account is not None and provides(account, product)


def user_plan(user, product: Product = None):
    """`{"institution": {"slug","name"}|null, "coverage": "institution"|"none"|null, "membership_status",
    "plan_source": "institution"|"personal"|"free"}` for apps that gate institution-only content: only
    `plan_source == "institution"` (covered, active, institution active, and for `product` when given, the
    institution's account provides it) grants it. `personal` means a paid personal plan (for `product` when given)."""
    membership = institution_membership(user)
    if _covers(membership, product):
        source = "institution"
    elif has_personal_plan(user, product):
        source = "personal"
    else:
        source = "free"
    org = membership.organization if membership else None
    return {
        "institution": {"slug": org.slug, "name": org.name} if org else None,
        "coverage": membership.coverage if membership else None,
        "membership_status": membership.status if membership else None,
        "plan_source": source,
    }


def plan_accounts(*, user, organization_account: Account = None, quota_policy: str, product: Product = None):
    """`(candidates, organization account in play)`: like `resolve_candidate_accounts`, and also says whether an
    institution covers the user here (when it does not, the personal account falls back to the free package). For
    `product`, a covered member counts as covered only when the organization account provides that product;
    otherwise they are treated like a member who is not covered (personal plan, else free package)."""
    personal_acct = Account.objects.filter(
        owner_user=user, account_type=Account.Type.PERSONAL, status=Account.Status.ACTIVE
    ).first()

    org_acct = None
    if organization_account is not None:
        if organization_account.account_type != Account.Type.ORGANIZATION or organization_account.status != Account.Status.ACTIVE:
            raise PermissionError("Organization account is not active")
        membership = Membership.objects.filter(
            user=user,
            organization_id=organization_account.organization_id,
            status=Membership.Status.ACTIVE,
            organization__status=Organization.Status.ACTIVE,
        ).first()
        if membership is None:
            raise PermissionError("User is not an active member of the organization")
        covered = membership.coverage == Membership.Coverage.INSTITUTION
        if covered and (product is None or provides(organization_account, product)):
            org_acct = organization_account

    return _order_by_policy(personal_acct, org_acct, quota_policy), org_acct


def _order_by_policy(personal_acct, org_acct, quota_policy):
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


def resolve_candidate_accounts(*, user, organization_account: Account = None, quota_policy: str,
                               product: Product = None):
    """Determines the ordered list of Accounts to check/consume based on the feature's mixed quota policy.
    Always validates that `user` owns the personal account and has an active Membership in the organization; the
    organization account is a candidate only while that membership is covered (coverage `institution`).
    """
    return plan_accounts(
        user=user, organization_account=organization_account, quota_policy=quota_policy, product=product
    )[0]
