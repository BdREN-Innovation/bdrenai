"""Package and PackageVersion creation, limit editing, and subscriber migration policies."""
from django.db import transaction
from django.db.models import Max

from apps.audit.services import record_audit
from apps.entitlements.services import sync_subscription_entitlements
from apps.subscriptions.models import Subscription, SubscriptionHistory

from .models import Package, PackageLimit, PackageVersion


@transaction.atomic
def create_package_with_version(
    *,
    product,
    name: str,
    slug: str,
    description: str = "",
    price=0,
    currency: str = "BDT",
    billing_interval: str = Package.BillingInterval.MONTHLY,
    trial_days: int = 0,
    limits: list[dict],
    actor=None,
):
    """Creates a Package along with its initial v1 PackageVersion and PackageLimits."""
    pkg = Package.objects.create(
        product=product,
        name=name,
        slug=slug,
        description=description,
        price=price,
        currency=currency,
        billing_interval=billing_interval,
        trial_days=trial_days,
    )
    ver = PackageVersion.objects.create(
        package=pkg,
        version=1,
        status=PackageVersion.Status.ACTIVE,
        migration_policy=PackageVersion.MigrationPolicy.NEW_ONLY,
    )
    for item in limits:
        PackageLimit.objects.create(
            package_version=ver,
            feature=item["feature"],
            limit_value=item["limit_value"],
            limit_period=item.get("limit_period", PackageLimit.Period.MONTHLY),
        )
    record_audit(
        actor=actor,
        action="package.created",
        target_type="Package",
        target_id=str(pkg.id),
        metadata={"version": 1, "slug": slug},
    )
    return pkg, ver


@transaction.atomic
def publish_new_package_version(
    *,
    package: Package,
    limits: list[dict],
    migration_policy: str = PackageVersion.MigrationPolicy.NEW_ONLY,
    selected_subscription_ids: list = None,
    actor=None,
):
    """Publishes a new immutable PackageVersion for an existing Package.
    Applies the administrator-selected migration_policy to existing subscribers:
      - new_only: existing subscribers stay on their current version.
      - immediate: active/trial subscribers of this package are migrated immediately.
      - on_renewal: existing subscribers have pending_package_version set to the new version.
      - selected_only: only subscriptions in `selected_subscription_ids` are migrated immediately.
    """
    max_ver = package.versions.aggregate(m=Max("version"))["m"] or 0
    new_ver = PackageVersion.objects.create(
        package=package,
        version=max_ver + 1,
        status=PackageVersion.Status.ACTIVE,
        migration_policy=migration_policy,
    )
    for item in limits:
        PackageLimit.objects.create(
            package_version=new_ver,
            feature=item["feature"],
            limit_value=item["limit_value"],
            limit_period=item.get("limit_period", PackageLimit.Period.MONTHLY),
        )

    active_subs = Subscription.objects.select_for_update().filter(
        package_version__package=package,
        status__in=[Subscription.Status.ACTIVE, Subscription.Status.TRIAL],
    ).exclude(package_version=new_ver)

    migrated_count = 0
    scheduled_count = 0

    if migration_policy == PackageVersion.MigrationPolicy.IMMEDIATE:
        for sub in active_subs:
            old_ver = sub.package_version
            sub.package_version = new_ver
            sub.pending_package_version = None
            sub.save(update_fields=["package_version", "pending_package_version"])
            SubscriptionHistory.objects.create(
                subscription=sub,
                old_package_version=old_ver,
                new_package_version=new_ver,
                change_type=SubscriptionHistory.ChangeType.MIGRATED,
                changed_by=actor,
                notes=f"Immediate migration to v{new_ver.version}",
            )
            sync_subscription_entitlements(sub)
            migrated_count += 1

    elif migration_policy == PackageVersion.MigrationPolicy.ON_RENEWAL:
        for sub in active_subs:
            sub.pending_package_version = new_ver
            sub.save(update_fields=["pending_package_version"])
            scheduled_count += 1

    elif migration_policy == PackageVersion.MigrationPolicy.SELECTED_ONLY and selected_subscription_ids:
        for sub in active_subs.filter(id__in=selected_subscription_ids):
            old_ver = sub.package_version
            sub.package_version = new_ver
            sub.pending_package_version = None
            sub.save(update_fields=["package_version", "pending_package_version"])
            SubscriptionHistory.objects.create(
                subscription=sub,
                old_package_version=old_ver,
                new_package_version=new_ver,
                change_type=SubscriptionHistory.ChangeType.MIGRATED,
                changed_by=actor,
                notes=f"Selected migration to v{new_ver.version}",
            )
            sync_subscription_entitlements(sub)
            migrated_count += 1

    record_audit(
        actor=actor,
        action="package.version_published",
        target_type="PackageVersion",
        target_id=str(new_ver.id),
        metadata={
            "package_id": str(package.id),
            "version": new_ver.version,
            "migration_policy": migration_policy,
            "migrated_count": migrated_count,
            "scheduled_count": scheduled_count,
        },
    )
    return new_ver, {"migrated": migrated_count, "scheduled": scheduled_count}
