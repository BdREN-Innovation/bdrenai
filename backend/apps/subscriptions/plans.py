"""Which personal subscriptions count as a paid personal plan (rules R2 and D1 of the institution admin plan)."""
from django.db.models import Exists, OuterRef, Q
from django.utils import timezone

from apps.accounts.models import Account
from apps.packages.models import Package, PackageVersion

from .models import Subscription

PLAN_STATUSES = (Subscription.Status.ACTIVE, Subscription.Status.TRIAL)
BundledApp = PackageVersion.products.through


def covers_q(product):
    """Subscriptions that cover `product`: a single package of it, or a combined package (`product` null) whose
    version includes it. Usable in `filter()` on Subscription querysets; never duplicates rows."""
    bundled = BundledApp.objects.filter(packageversion_id=OuterRef("package_version_id"), product_id=product.pk)
    return (Exists(bundled) & Q(product__isnull=True)) | Q(product=product)


def covered_apps(subscription):
    """Product ids `subscription` covers (one query for a combined package)."""
    if subscription.product_id:
        return {subscription.product_id}
    return set(subscription.package_version.products.values_list("pk", flat=True))


def paid_personal_q(now=None):
    """Subscriptions that make their owner a personal-plan user: on a personal account, active or trial, on a paid
    (not free) package, not past their expiry."""
    now = now or timezone.now()
    return (
        Q(account__account_type=Account.Type.PERSONAL, status__in=PLAN_STATUSES)
        & ~Q(billing_interval=Package.BillingInterval.FREE)
        & (Q(expires_at__isnull=True) | Q(expires_at__gt=now))
    )


def paid_personal_subscriptions(user, product=None, now=None):
    qs = Subscription.objects.filter(paid_personal_q(now), account__owner_user=user)
    return qs.filter(covers_q(product)) if product is not None else qs


def has_personal_plan(user, product=None, now=None):
    return paid_personal_subscriptions(user, product, now).exists()


def personal_plan_exists(user_ref="user", now=None):
    """`Exists(...)` for annotations: the row's user (`OuterRef(user_ref)`) holds a paid personal plan."""
    return Exists(Subscription.objects.filter(paid_personal_q(now), account__owner_user=OuterRef(user_ref)))
