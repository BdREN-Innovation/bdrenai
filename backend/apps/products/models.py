import hashlib
import secrets
import uuid

from django.db import models


def hash_api_key(raw_key: str) -> str:
    return hashlib.sha256(raw_key.encode()).hexdigest()


class Product(models.Model):
    """Independent SaaS application offered by BDREN (e.g. Mindspear, Synapse)."""

    class Status(models.TextChoices):
        ACTIVE = "active"
        INACTIVE = "inactive"
        ARCHIVED = "archived"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)
    slug = models.SlugField(max_length=100, unique=True)
    description = models.TextField(blank=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.ACTIVE)
    api_key_hash = models.CharField(max_length=64, blank=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def rotate_api_key(self) -> str:
        raw = f"bdren_prod_{self.slug}_{secrets.token_urlsafe(32)}"
        self.api_key_hash = hash_api_key(raw)
        self.save(update_fields=["api_key_hash"])
        return raw

    def __str__(self):
        return self.name


class Feature(models.Model):
    """A measurable capability or entitlement unit (e.g. ai_requests, workflow_executions, storage_gb)."""

    class Status(models.TextChoices):
        ACTIVE = "active"
        INACTIVE = "inactive"

    class QuotaPolicy(models.TextChoices):
        PERSONAL_ONLY = "personal_only"
        ORGANIZATION_ONLY = "organization_only"
        PERSONAL_THEN_ORG = "personal_then_org"
        ORG_THEN_PERSONAL = "org_then_personal"
        BOTH = "both"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    product = models.ForeignKey(Product, null=True, blank=True, on_delete=models.CASCADE, related_name="features")
    key = models.SlugField(max_length=100)
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    unit = models.CharField(max_length=64, default="count")
    quota_policy = models.CharField(
        max_length=32, choices=QuotaPolicy.choices, default=QuotaPolicy.PERSONAL_THEN_ORG
    )
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.ACTIVE)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["product", "key"], name="uniq_feature_product_key"),
        ]

    def __str__(self):
        return f"{self.key} ({self.unit})"
