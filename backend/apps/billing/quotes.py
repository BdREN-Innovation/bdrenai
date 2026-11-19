"""Prices and periods: one `quote()` used by bKash checkout, manual payments and the portal's offers
(docs/BILLING_API.md "Pricing and periods").

A package's per-period price is compared as a daily rate (price / days of its interval), so a monthly and a yearly
package can be ranked: an upgrade costs more per day than what the institution has now, a downgrade less.
"""
from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal

from django.db.models import Prefetch
from django.utils import timezone

from apps.invitations.errors import ServiceError
from apps.invitations.shapes import iso
from apps.packages.models import Package, PackageVersion
from apps.products.models import Product
from apps.subscriptions.models import Subscription
from apps.subscriptions.services import latest_version

from .models import PaymentRecord

KINDS = (PaymentRecord.Kind.NEW, PaymentRecord.Kind.RENEW, PaymentRecord.Kind.UPGRADE)
INTERVAL_DAYS = {Package.BillingInterval.MONTHLY: 30, Package.BillingInterval.YEARLY: 365}
LIVE = (Subscription.Status.ACTIVE, Subscription.Status.TRIAL, Subscription.Status.PAST_DUE)
MAX_PERIODS = 36


@dataclass(frozen=True)
class Quote:
    package_version: PackageVersion
    amount: Decimal
    currency: str
    periods: int
    period_start: datetime
    period_end: datetime
    kind: str
    subscription: Subscription | None  # the subscription renewed or upgraded from

    def body(self):
        return {
            "package_version": self.package_version.version,
            "amount": f"{self.amount:.2f}",
            "currency": self.currency,
            "periods": self.periods,
            "period_start": iso(self.period_start),
            "period_end": iso(self.period_end),
            "kind": self.kind,
        }


def refused(code, message, status=400, **extra):
    return ServiceError(code, message, status=status, extra=extra)


def not_offered(message):
    return refused("package_not_offered", message)


def period_end(start, interval, periods):
    return start + timedelta(days=INTERVAL_DAYS[interval] * periods)


def daily_rate(version):
    days = INTERVAL_DAYS.get(version.billing_interval)
    return version.price / days if days else Decimal(0)


def apps_of(version):
    """Product ids the version covers (prefetched `products` when present)."""
    ids = {p.pk for p in version.products.all()}
    return ids or ({version.package.product_id} if version.package.product_id else set())


def live_subscriptions(account):
    """The account's live subscriptions with version, package and apps loaded (two queries)."""
    return list(
        Subscription.objects.filter(account=account, status__in=LIVE)
        .select_related("package_version__package", "pending_package_version__package")
        .prefetch_related(Prefetch("package_version__products", queryset=Product.objects.only("id")))
        .order_by("starts_at")
    )


def buyable_version(package, *, public_only=False, version=None):
    """The package's latest active version (`version` when the caller has loaded it) if it can be bought;
    `free_package` / `package_unavailable` otherwise."""
    version = version or latest_version(package)
    if version is not None and (version.billing_interval == Package.BillingInterval.FREE or version.price <= 0):
        raise refused("free_package", "This package is free; there is nothing to pay.")
    unavailable = (
        version is None
        or package.status != Package.Status.ACTIVE
        or (public_only and not package.is_public)
        or version.billing_interval not in INTERVAL_DAYS
        or version.products.exclude(status=Product.Status.ACTIVE).exists()
        or (package.product_id and package.product.status != Product.Status.ACTIVE)
    )
    if unavailable:
        raise refused("package_unavailable", "This package cannot be bought now.")
    return version


def _bundle_covering(package, live):
    if package.kind != Package.Kind.SINGLE:
        return None
    return next(
        (s for s in live if s.product_id is None and package.product_id in apps_of(s.package_version)), None
    )


def _renewed(package, live):
    """The live subscription a renewal of `package` extends: on that package, or scheduled to change to it."""
    for sub in live:
        if sub.package_version.package_id == package.pk:
            return sub
        pending = sub.pending_package_version
        if pending is not None and pending.package_id == package.pk:
            return sub
    return None


def quote(account, package, kind, *, periods=1, period_start=None, public_only=False, live=None, now=None,
          version=None):
    """The `Quote` for buying `package` as `kind` for `account`; a ServiceError when it cannot be bought so."""
    now = now or timezone.now()
    if kind not in KINDS:
        raise ServiceError("invalid", "Choose new, renew or upgrade.", fields={"kind": "Use new, renew or upgrade."})
    # A package that is not public can still be renewed by the institution already on it.
    version = buyable_version(package, public_only=public_only and kind != PaymentRecord.Kind.RENEW, version=version)
    live = live_subscriptions(account) if live is None else live
    apps = apps_of(version)
    if kind != PaymentRecord.Kind.RENEW and _bundle_covering(package, live) is not None:
        raise refused(
            "covered_by_bundle", "This app is already included in the institution's combined package.", status=409,
        )
    covering = [s for s in live if apps & apps_of(s.package_version)]
    current = None
    if kind == PaymentRecord.Kind.NEW:
        if covering:
            raise not_offered("A package for these apps is already active; renew or upgrade it instead.")
        start = now
    elif kind == PaymentRecord.Kind.RENEW:
        current = _renewed(package, covering)
        if current is None:
            raise not_offered("There is no current subscription to this package to renew.")
        start = max(current.expires_at or now, now)
    else:
        if not covering:
            raise not_offered("There is no current package to upgrade from; buy it as new.")
        if any(s.package_version.package_id == package.pk for s in covering):
            raise not_offered("This is the current package; renew it instead.")
        rate = daily_rate(version)
        if any(daily_rate(s.package_version) >= rate for s in covering):
            raise not_offered("An upgrade must cost more per period than the current package.")
        current = max(covering, key=lambda s: daily_rate(s.package_version))
        start = now
    start = period_start or start
    return Quote(
        package_version=version,
        amount=version.price * periods,
        currency=version.currency,
        periods=periods,
        period_start=start,
        period_end=period_end(start, version.billing_interval, periods),
        kind=kind,
        subscription=current,
    )


def offers(account, *, now=None):
    """What the institution console offers: a renewal of each live subscription (into its scheduled change when
    one is set), upgrades to public packages covering at least the same apps at a higher rate, and, when nothing is
    live, every public package as `new`. Packages that cannot be bought are left out."""
    now = now or timezone.now()
    live = live_subscriptions(account)
    candidates = _public_packages()
    latest = {package.pk: version for package, version in candidates}
    found = []
    for sub in live:
        target = sub.pending_package_version.package if sub.pending_package_version_id else sub.package_version.package
        found.append((target, PaymentRecord.Kind.RENEW))
    for package, version in candidates:
        apps = apps_of(version)
        rate = daily_rate(version)
        upgrades = [
            s for s in live
            if apps_of(s.package_version) <= apps and s.package_version.package_id != package.pk
            and daily_rate(s.package_version) < rate
        ]
        if upgrades:
            found.append((package, PaymentRecord.Kind.UPGRADE))
        elif not live:
            found.append((package, PaymentRecord.Kind.NEW))
    out = []
    for package, kind in found:
        try:
            q = quote(account, package, kind, public_only=True, live=live, now=now, version=latest.get(package.pk))
        except ServiceError:
            continue
        out.append((package, q))
    return out


def offered(account, package, kind, *, now=None):
    """Whether (`package`, `kind`) is one of `offers(account)`."""
    return any(p.pk == package.pk and q.kind == kind for p, q in offers(account, now=now))


def _public_packages():
    packages = (
        Package.objects.filter(status=Package.Status.ACTIVE, is_public=True)
        .exclude(billing_interval=Package.BillingInterval.FREE)
        .select_related("product")
        .order_by("sort_order", "name")
    )
    versions = (
        PackageVersion.objects.filter(package__in=packages, status=PackageVersion.Status.ACTIVE)
        .select_related("package")
        .prefetch_related(Prefetch("products", queryset=Product.objects.order_by("sort_order", "name")))
        .order_by("package_id", "-version")
    )
    latest = {}
    for version in versions:
        latest.setdefault(version.package_id, version)
    return [(p, latest[p.pk]) for p in packages if p.pk in latest]
