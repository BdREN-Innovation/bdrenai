"""Subscription creation, upgrades/downgrades, renewals, cancellations, and manual adjustments."""
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from apps.audit.services import record_audit
from apps.entitlements.services import sync_subscription_entitlements
from apps.packages.models import Package, PackageVersion

from .models import Subscription, SubscriptionHistory


def _default_expiry(starts_at, interval: str, trial_days: int = 0):
    if trial_days > 0:
        return starts_at + timedelta(days=trial_days)
    if interval == Package.BillingInterval.MONTHLY:
        return starts_at + timedelta(days=30)
    if interval == Package.BillingInterval.YEARLY:
        return starts_at + timedelta(days=365)
    return None


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
    if package_version is None:
        if package is None:
            raise ValueError("Either package_version or package is required")
        package_version = package.versions.filter(status=PackageVersion.Status.ACTIVE).order_by("-version").first()
        if package_version is None:
            raise ValueError("Package has no active version")
    else:
        package = package_version.package

    now = starts_at or timezone.now()
    trial_days = package.trial_days if use_trial else 0
    status = Subscription.Status.TRIAL if trial_days > 0 else Subscription.Status.ACTIVE
    exp = expires_at if expires_at is not None else _default_expiry(now, package.billing_interval, trial_days)

    # Cancel any prior active/trial subscription for the same (account, product)
    for old_sub in Subscription.objects.select_for_update().filter(
        account=account,
        product=package.product,
        status__in=[Subscription.Status.ACTIVE, Subscription.Status.TRIAL],
    ):
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
        metadata={"account_id": str(account.id), "package_version_id": str(package_version.id)},
    )
    return sub


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
    old_ver = sub.package_version
    if sub.pending_package_version_id:
        sub.package_version = sub.pending_package_version
        sub.pending_package_version = None

    base_time = max(sub.expires_at or timezone.now(), timezone.now())
    sub.expires_at = _default_expiry(base_time, sub.billing_interval)
    sub.status = Subscription.Status.ACTIVE
    sub.save(update_fields=["package_version", "pending_package_version", "expires_at", "status"])

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
def cancel_subscription(*, subscription: Subscription, actor=None, notes: str = ""):
    sub = Subscription.objects.select_for_update().get(id=subscription.id)
    sub.status = Subscription.Status.CANCELLED
    sub.save(update_fields=["status"])
    SubscriptionHistory.objects.create(
        subscription=sub,
        old_package_version=sub.package_version,
        new_package_version=sub.package_version,
        change_type=SubscriptionHistory.ChangeType.CANCELLED,
        changed_by=actor,
        notes=notes or "Subscription cancelled",
    )
    sync_subscription_entitlements(sub)
    record_audit(actor=actor, action="subscription.cancelled", target_type="Subscription", target_id=str(sub.id))
    return sub
