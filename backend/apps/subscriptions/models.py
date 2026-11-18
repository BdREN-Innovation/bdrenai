import uuid

from django.conf import settings
from django.db import models


class Subscription(models.Model):
    """Binds a Personal or Organization Account to a specific PackageVersion of a Product."""

    class Status(models.TextChoices):
        TRIAL = "trial"
        ACTIVE = "active"
        EXPIRED = "expired"
        CANCELLED = "cancelled"
        PAST_DUE = "past_due"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    account = models.ForeignKey("accounts.Account", on_delete=models.PROTECT, related_name="subscriptions")
    product = models.ForeignKey("products.Product", on_delete=models.PROTECT, related_name="subscriptions")
    package_version = models.ForeignKey(
        "packages.PackageVersion", on_delete=models.PROTECT, related_name="subscriptions"
    )
    pending_package_version = models.ForeignKey(
        "packages.PackageVersion",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="pending_subscriptions",
    )
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.ACTIVE)
    starts_at = models.DateTimeField()
    expires_at = models.DateTimeField(null=True, blank=True)
    billing_interval = models.CharField(max_length=16)
    # False: runs to `expires_at` and is never renewed (set when the owner joins an institution's package).
    auto_renew = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=["account", "product", "status"]),
        ]


class SubscriptionHistory(models.Model):
    """Immutable audit record of every package/status change on a Subscription."""

    class ChangeType(models.TextChoices):
        CREATED = "created"
        UPGRADED = "upgraded"
        DOWNGRADED = "downgraded"
        RENEWED = "renewed"
        MIGRATED = "migrated"
        CANCELLED = "cancelled"
        EXPIRED = "expired"
        MANUAL_ADJUSTMENT = "manual_adjustment"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    subscription = models.ForeignKey(Subscription, on_delete=models.CASCADE, related_name="history")
    old_package_version = models.ForeignKey(
        "packages.PackageVersion", null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )
    new_package_version = models.ForeignKey(
        "packages.PackageVersion", on_delete=models.PROTECT, related_name="+"
    )
    change_type = models.CharField(max_length=24, choices=ChangeType.choices)
    changed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    notes = models.TextField(blank=True)
    changed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-changed_at"]
