import uuid

from django.db import models


class Entitlement(models.Model):
    """Effective quota limit for an Account + Product + Feature (derived from Subscription or manual override)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    account = models.ForeignKey("accounts.Account", on_delete=models.CASCADE, related_name="entitlements")
    product = models.ForeignKey("products.Product", on_delete=models.CASCADE, related_name="entitlements")
    feature = models.ForeignKey("products.Feature", on_delete=models.CASCADE, related_name="entitlements")
    limit = models.BigIntegerField()
    period = models.CharField(max_length=16)
    source_subscription = models.ForeignKey(
        "subscriptions.Subscription", null=True, blank=True, on_delete=models.CASCADE, related_name="entitlements"
    )
    is_override = models.BooleanField(default=False)
    effective_from = models.DateTimeField()
    effective_until = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=["account", "product", "feature"]),
        ]
        constraints = [
            models.CheckConstraint(condition=models.Q(limit__gte=0), name="chk_entitlement_limit_nonneg"),
        ]
