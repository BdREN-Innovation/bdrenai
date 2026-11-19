"""Subscription creation, upgrades/downgrades, renewals, cancellations, and manual adjustments."""
from datetime import timedelta

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from apps.audit.services import record_audit
from apps.entitlements.services import sync_subscription_entitlements
from apps.packages.models import Package, PackageVersion

from .models import Subscription, SubscriptionHistory


class RenewalStopped(ValueError):
    """The subscription was set not to renew (`auto_renew = False`); it runs to its expiry unless `resume_renewal`
    (or a verified payment for it) sets it to renew again."""


def _default_expiry(starts_at, interval: str, trial_days: int = 0):
    if trial_days > 0:
        return starts_at + timedelta(days=trial_days)
    if interval == Package.BillingInterval.MONTHLY:
        return starts_at + timedelta(days=30)
    if interval == Package.BillingInterval.YEARLY:
        return starts_at + timedelta(days=365)
    return None


class CoveredByBundle(ValueError):
    """A single package for an app the account already gets from a live combined package."""


LIVE_STATUSES = (Subscription.Status.ACTIVE, Subscription.Status.TRIAL)


def latest_version(package):
    return package.versions.filter(status=PackageVersion.Status.ACTIVE).order_by("-version").first()


def version_apps(package_version):
    """Product ids a version covers: its `products` (a single package's own product when that is empty)."""
    ids = set(package_version.products.values_list("pk", flat=True))
    product_id = package_version.package.product_id
    return ids or ({product_id} if product_id else set())


def _organization_meta(account):
    return {"organization_id": str(account.organization_id)} if account.organization_id else {}


@transaction.atomic
def create_subscription(
    *,
    account,
    package_version: PackageVersion = None,
    package: Package = None,
    use_trial: bool = False,
    starts_at=None,
    expires_at=None,
    actor=None,
    notes: str = "",
):
    """Subscribes `account` and cancels the live (active/trial) subscriptions it replaces: a single package
    replaces the account's single of the same app; a combined package replaces the singles of its apps and any
    combined package. A single for an app a live combined package already covers raises `CoveredByBundle`."""
    if package_version is None:
        if package is None:
            raise ValueError("Either package_version or package is required")
        package_version = latest_version(package)
        if package_version is None:
            raise ValueError("Package has no active version")
    else:
        package = package_version.package

    now = starts_at or timezone.now()
    trial_days = package.trial_days if use_trial else 0
    status = Subscription.Status.TRIAL if trial_days > 0 else Subscription.Status.ACTIVE
    exp = expires_at if expires_at is not None else _default_expiry(now, package.billing_interval, trial_days)

    for old_sub in _replaced(account, package, package_version):
        old_sub.status = Subscription.Status.CANCELLED
        old_sub.save(update_fields=["status"])
        sync_subscription_entitlements(old_sub)

    sub = Subscription.objects.create(
        account=account,
        product=package.product,
        package_version=package_version,
        status=status,
        starts_at=now,
        expires_at=exp,
        billing_interval=package.billing_interval,
    )
    SubscriptionHistory.objects.create(
        subscription=sub,
        old_package_version=None,
        new_package_version=package_version,
        change_type=SubscriptionHistory.ChangeType.CREATED,
        changed_by=actor,
        notes=notes or f"Subscribed to {package.name} v{package_version.version}",
    )
    sync_subscription_entitlements(sub)
    record_audit(
        actor=actor,
        action="subscription.created",
        target_type="Subscription",
        target_id=str(sub.id),
        metadata={
            "account_id": str(account.id), "package_version_id": str(package_version.id),
            **_organization_meta(account),
        },
    )
    return sub


def _replaced(account, package, package_version):
    """The account's live subscriptions (locked) that subscribing to `package_version` cancels."""
    live = Subscription.objects.select_for_update().filter(account=account, status__in=LIVE_STATUSES)
    if package.kind == Package.Kind.BUNDLE:
        apps = version_apps(package_version)
        return list(live.filter(Q(product__isnull=True) | Q(product_id__in=apps)))
    bundles = live.filter(product__isnull=True).prefetch_related("package_version__products")
    if any(package.product_id in {p.pk for p in b.package_version.products.all()} for b in bundles):
        raise CoveredByBundle("This app is already included in the account's combined package.")
    return list(live.filter(product=package.product))


@transaction.atomic
def change_subscription_package(
    *,
    subscription: Subscription,
    new_package_version: PackageVersion,
    change_type: str = SubscriptionHistory.ChangeType.UPGRADED,
    actor=None,
    notes: str = "",
):
    sub = Subscription.objects.select_for_update().get(id=subscription.id)
    old_ver = sub.package_version
    sub.package_version = new_package_version
    sub.pending_package_version = None
    sub.billing_interval = new_package_version.package.billing_interval
    sub.status = Subscription.Status.ACTIVE
    sub.save(update_fields=["package_version", "pending_package_version", "billing_interval", "status"])

    SubscriptionHistory.objects.create(
        subscription=sub,
        old_package_version=old_ver,
        new_package_version=new_package_version,
        change_type=change_type,
        changed_by=actor,
        notes=notes,
    )
    sync_subscription_entitlements(sub)
    record_audit(
        actor=actor,
        action=f"subscription.{change_type}",
        target_type="Subscription",
        target_id=str(sub.id),
        metadata={"from": str(old_ver.id), "to": str(new_package_version.id)},
    )
    return sub


@transaction.atomic
def renew_subscription(*, subscription: Subscription, actor=None, notes: str = ""):
    """Renews a subscription and applies `pending_package_version` if an ON_RENEWAL package migration was queued."""
    sub = Subscription.objects.select_for_update().get(id=subscription.id)
    if not sub.auto_renew:
        raise RenewalStopped("This subscription is set not to renew.")
    old_ver = sub.package_version
    if sub.pending_package_version_id:
        sub.package_version = sub.pending_package_version
        sub.pending_package_version = None

    base_time = max(sub.expires_at or timezone.now(), timezone.now())
    sub.expires_at = _default_expiry(base_time, sub.billing_interval)
    sub.status = Subscription.Status.ACTIVE
    sub.expiry_reminder_sent_at = None
    sub.save(update_fields=["package_version", "pending_package_version", "expires_at", "status",
                            "expiry_reminder_sent_at"])

    SubscriptionHistory.objects.create(
        subscription=sub,
        old_package_version=old_ver,
        new_package_version=sub.package_version,
        change_type=SubscriptionHistory.ChangeType.RENEWED,
        changed_by=actor,
        notes=notes or "Subscription renewed",
    )
    sync_subscription_entitlements(sub)
    return sub


@transaction.atomic
def cancel_subscription(*, subscription: Subscription, actor=None, notes: str = "", ends_at=None, metadata=None,
                        ip_address=None):
    """Cancels now; `ends_at` (when earlier than its expiry) also ends its period then."""
    sub = Subscription.objects.select_for_update().select_related("account").get(id=subscription.id)
    sub.status = Subscription.Status.CANCELLED
    fields = ["status"]
    if ends_at is not None and (sub.expires_at is None or ends_at < sub.expires_at):
        sub.expires_at = ends_at
        fields.append("expires_at")
    sub.save(update_fields=fields)
    SubscriptionHistory.objects.create(
        subscription=sub,
        old_package_version=sub.package_version,
        new_package_version=sub.package_version,
        change_type=SubscriptionHistory.ChangeType.CANCELLED,
        changed_by=actor,
        notes=notes or "Subscription cancelled",
    )
    sync_subscription_entitlements(sub)
    record_audit(
        actor=actor, action="subscription.cancelled", target_type="Subscription", target_id=str(sub.id),
        metadata={"account_id": str(sub.account_id), **_organization_meta(sub.account), **(metadata or {})},
        ip_address=ip_address,
    )
    return sub


@transaction.atomic
def stop_renewal(*, subscription: Subscription, actor=None, notes: str = "", metadata=None, ip_address=None):
    """Sets `auto_renew = False`: the subscription keeps its limits until `expires_at`, then is not renewed. No refund.
    Returns False when it was already set not to renew."""
    sub = Subscription.objects.select_for_update().get(id=subscription.id)
    if not sub.auto_renew:
        return False
    sub.auto_renew = False
    sub.save(update_fields=["auto_renew"])
    SubscriptionHistory.objects.create(
        subscription=sub,
        old_package_version=sub.package_version,
        new_package_version=sub.package_version,
        change_type=SubscriptionHistory.ChangeType.MANUAL_ADJUSTMENT,
        changed_by=actor,
        notes=notes or "Set not to renew",
    )
    record_audit(
        actor=actor, action="subscription.renewal_stopped", target_type="Subscription", target_id=str(sub.id),
        metadata={
            "account_id": str(sub.account_id),
            "expires_at": sub.expires_at.isoformat() if sub.expires_at else None,
            **(metadata or {}),
        },
        ip_address=ip_address,
    )
    return True


@transaction.atomic
def resume_renewal(*, subscription: Subscription, actor=None, notes: str = "", metadata=None, ip_address=None):
    """Undoes `stop_renewal`: sets `auto_renew = True` again, with a history row and a `subscription.renewal_resumed`
    audit entry. Returns False when it already renews."""
    sub = Subscription.objects.select_for_update().get(id=subscription.id)
    if sub.auto_renew:
        return False
    sub.auto_renew = True
    sub.save(update_fields=["auto_renew"])
    SubscriptionHistory.objects.create(
        subscription=sub,
        old_package_version=sub.package_version,
        new_package_version=sub.package_version,
        change_type=SubscriptionHistory.ChangeType.MANUAL_ADJUSTMENT,
        changed_by=actor,
        notes=notes or "Set to renew again",
    )
    record_audit(
        actor=actor, action="subscription.renewal_resumed", target_type="Subscription", target_id=str(sub.id),
        metadata={"account_id": str(sub.account_id), **(metadata or {})},
        ip_address=ip_address,
    )
    return True


@transaction.atomic
def extend_subscription(*, subscription: Subscription, package_version: PackageVersion, expires_at, actor=None,
                        notes: str = ""):
    """A paid renewal: moves the subscription onto `package_version` (the same package's latest version, or the
    scheduled downgrade's target, which then applies), sets `expires_at`, renews again (`auto_renew`), and clears
    the scheduled change and the expiry reminder."""
    sub = Subscription.objects.select_for_update().get(id=subscription.id)
    old_ver = sub.package_version
    sub.package_version = package_version
    sub.pending_package_version = None
    sub.billing_interval = package_version.package.billing_interval
    sub.expires_at = expires_at
    sub.status = Subscription.Status.ACTIVE
    sub.auto_renew = True
    sub.expiry_reminder_sent_at = None
    sub.save(update_fields=[
        "package_version", "pending_package_version", "billing_interval", "expires_at", "status", "auto_renew",
        "expiry_reminder_sent_at",
    ])
    changed = old_ver.package_id != package_version.package_id
    SubscriptionHistory.objects.create(
        subscription=sub,
        old_package_version=old_ver,
        new_package_version=package_version,
        change_type=SubscriptionHistory.ChangeType.DOWNGRADED if changed else SubscriptionHistory.ChangeType.RENEWED,
        changed_by=actor,
        notes=notes or "Subscription renewed",
    )
    sync_subscription_entitlements(sub)
    record_audit(
        actor=actor, action="subscription.renewed", target_type="Subscription", target_id=str(sub.id),
        metadata={
            "account_id": str(sub.account_id), "package_version_id": str(package_version.id),
            "expires_at": expires_at.isoformat() if expires_at else None, **_organization_meta(sub.account),
        },
    )
    return sub


@transaction.atomic
def schedule_change(*, subscription: Subscription, package_version, actor=None, notes: str = "", ip_address=None):
    """Sets (or with `package_version=None` clears) the change applied at the next renewal. Returns the
    subscription; raises `RenewalStopped` when scheduling on a subscription that will not renew."""
    sub = Subscription.objects.select_for_update().select_related("account").get(id=subscription.id)
    if package_version is not None and not sub.auto_renew:
        raise RenewalStopped("This subscription is set not to renew.")
    previous = sub.pending_package_version
    sub.pending_package_version = package_version
    sub.save(update_fields=["pending_package_version"])
    target = package_version or previous
    SubscriptionHistory.objects.create(
        subscription=sub,
        old_package_version=sub.package_version,
        new_package_version=target or sub.package_version,
        change_type=SubscriptionHistory.ChangeType.MANUAL_ADJUSTMENT,
        changed_by=actor,
        notes=notes or (
            f"Change to {package_version.package.name} scheduled for the next renewal" if package_version
            else "Scheduled change cancelled"
        ),
    )
    record_audit(
        actor=actor,
        action="subscription.change_scheduled" if package_version else "subscription.scheduled_change_cancelled",
        target_type="Subscription", target_id=str(sub.id),
        metadata={
            "account_id": str(sub.account_id),
            "package_version_id": str(target.id) if target else None,
            **_organization_meta(sub.account),
        },
        ip_address=ip_address,
    )
    return sub
