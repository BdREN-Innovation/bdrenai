import uuid

from django.db import models


class Package(models.Model):
    """Commercial or free tier for a specific Product."""

    class BillingInterval(models.TextChoices):
        FREE = "free"
        MONTHLY = "monthly"
        YEARLY = "yearly"

    class Status(models.TextChoices):
        ACTIVE = "active"
        INACTIVE = "inactive"
        ARCHIVED = "archived"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    product = models.ForeignKey("products.Product", on_delete=models.CASCADE, related_name="packages")
    name = models.CharField(max_length=255)
    slug = models.SlugField(max_length=100)
    description = models.TextField(blank=True)
    price = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    currency = models.CharField(max_length=8, default="BDT")
    billing_interval = models.CharField(
        max_length=16, choices=BillingInterval.choices, default=BillingInterval.MONTHLY
    )
    trial_days = models.PositiveIntegerField(default=0)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.ACTIVE)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["product", "slug"], name="uniq_package_product_slug"),
        ]


class PackageVersion(models.Model):
    """Immutable snapshot of a Package's feature limits so existing subscribers are isolated from edits."""

    class Status(models.TextChoices):
        ACTIVE = "active"
        DEPRECATED = "deprecated"
        ARCHIVED = "archived"

    class MigrationPolicy(models.TextChoices):
        NEW_ONLY = "new_only"
        IMMEDIATE = "immediate"
        ON_RENEWAL = "on_renewal"
        SELECTED_ONLY = "selected_only"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    package = models.ForeignKey(Package, on_delete=models.CASCADE, related_name="versions")
    version = models.PositiveIntegerField()
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.ACTIVE)
    migration_policy = models.CharField(
        max_length=24, choices=MigrationPolicy.choices, default=MigrationPolicy.NEW_ONLY
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-version"]
        constraints = [
            models.UniqueConstraint(fields=["package", "version"], name="uniq_package_version_num"),
        ]


class PackageLimit(models.Model):
    """Quota limit for a Feature within a specific PackageVersion."""

    class Period(models.TextChoices):
        DAILY = "daily"
        MONTHLY = "monthly"
        YEARLY = "yearly"
        LIFETIME = "lifetime"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    package_version = models.ForeignKey(PackageVersion, on_delete=models.CASCADE, related_name="limits")
    feature = models.ForeignKey("products.Feature", on_delete=models.PROTECT, related_name="package_limits")
    limit_value = models.BigIntegerField()
    limit_period = models.CharField(max_length=16, choices=Period.choices, default=Period.MONTHLY)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["package_version", "feature"], name="uniq_limit_pkgver_feature"),
            models.CheckConstraint(condition=models.Q(limit_value__gte=0), name="chk_limit_value_nonneg"),
        ]
