import uuid

from django.conf import settings
from django.db import models


class Package(models.Model):
    """What BdREN AI sells: a single package for one Product, or a bundle (combined package) of several.

    `price`, `currency`, `billing_interval`, `price_unit` and `trial_days` mirror the latest PackageVersion
    (updated on publish) so catalog and subscription code can read them straight off the package."""

    class Kind(models.TextChoices):
        SINGLE = "single"
        BUNDLE = "bundle"

    class BillingInterval(models.TextChoices):
        FREE = "free"
        MONTHLY = "monthly"
        YEARLY = "yearly"

    class PriceUnit(models.TextChoices):
        PER_SEAT = "per_seat"
        PER_INSTITUTION = "per_institution"
        FLAT = "flat"

    class Status(models.TextChoices):
        ACTIVE = "active"
        INACTIVE = "inactive"
        ARCHIVED = "archived"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    kind = models.CharField(max_length=16, choices=Kind.choices, default=Kind.SINGLE)
    product = models.ForeignKey(
        "products.Product", null=True, blank=True, on_delete=models.CASCADE, related_name="packages"
    )
    name = models.CharField(max_length=255)
    slug = models.SlugField(max_length=100)
    description = models.TextField(blank=True)
    audience = models.CharField(max_length=255, blank=True)
    price = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    currency = models.CharField(max_length=8, default="BDT")
    billing_interval = models.CharField(
        max_length=16, choices=BillingInterval.choices, default=BillingInterval.MONTHLY
    )
    price_unit = models.CharField(max_length=24, choices=PriceUnit.choices, default=PriceUnit.PER_SEAT)
    trial_days = models.PositiveIntegerField(default=0)
    is_public = models.BooleanField(default=True)
    highlight = models.BooleanField(default=False)
    sort_order = models.IntegerField(default=0)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.ACTIVE)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["product", "slug"], name="uniq_package_product_slug"),
            models.UniqueConstraint(
                fields=["slug"], condition=models.Q(product__isnull=True), name="uniq_bundle_slug"
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(kind="single", product__isnull=False)
                    | models.Q(kind="bundle", product__isnull=True)
                ),
                name="chk_package_kind_product",
            ),
        ]


class PackageVersion(models.Model):
    """Immutable commercial snapshot of a Package (terms, included apps, limits), so existing subscribers are
    isolated from edits."""

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
    price = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    currency = models.CharField(max_length=8, default="BDT")
    billing_interval = models.CharField(
        max_length=16, choices=Package.BillingInterval.choices, default=Package.BillingInterval.MONTHLY
    )
    price_unit = models.CharField(
        max_length=24, choices=Package.PriceUnit.choices, default=Package.PriceUnit.PER_SEAT
    )
    trial_days = models.PositiveIntegerField(default=0)
    seat_limit = models.PositiveIntegerField(null=True, blank=True)
    products = models.ManyToManyField("products.Product", blank=True, related_name="package_versions")
    change_reason = models.TextField(blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
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
        WEEKLY = "weekly"
        MONTHLY = "monthly"
        YEARLY = "yearly"
        LIFETIME = "lifetime"

    class OnLimit(models.TextChoices):
        BLOCK = "block"
        WARN = "warn"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    package_version = models.ForeignKey(PackageVersion, on_delete=models.CASCADE, related_name="limits")
    feature = models.ForeignKey("products.Feature", on_delete=models.PROTECT, related_name="package_limits")
    limit_value = models.BigIntegerField()
    limit_period = models.CharField(max_length=16, choices=Period.choices, default=Period.MONTHLY)
    on_limit = models.CharField(max_length=8, choices=OnLimit.choices, default=OnLimit.BLOCK)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["package_version", "feature"], name="uniq_limit_pkgver_feature"),
            models.CheckConstraint(condition=models.Q(limit_value__gte=0), name="chk_limit_value_nonneg"),
        ]
