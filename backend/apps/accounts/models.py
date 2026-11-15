import uuid

from django.conf import settings
from django.db import models


class Account(models.Model):
    """Billing and entitlement subject: either a PERSONAL account or an ORGANIZATION account."""

    class Type(models.TextChoices):
        PERSONAL = "personal"
        ORGANIZATION = "organization"

    class Status(models.TextChoices):
        ACTIVE = "active"
        SUSPENDED = "suspended"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    account_type = models.CharField(max_length=16, choices=Type.choices)
    owner_user = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name="accounts"
    )
    organization = models.OneToOneField(
        "organizations.Organization", null=True, blank=True, on_delete=models.PROTECT, related_name="account"
    )
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.ACTIVE)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["owner_user"],
                condition=models.Q(account_type="personal"),
                name="uniq_personal_account_per_user",
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(account_type="personal", owner_user__isnull=False, organization__isnull=True)
                    | models.Q(account_type="organization", organization__isnull=False)
                ),
                name="chk_account_owner_or_organization",
            ),
        ]
