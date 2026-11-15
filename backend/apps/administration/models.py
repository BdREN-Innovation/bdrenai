import uuid

from django.conf import settings
from django.db import models


class PlatformRoleAssignment(models.Model):
    """Role-Based Access Control (RBAC) for BDREN platform administrators."""

    class Role(models.TextChoices):
        SUPER_ADMIN = "platform_super_admin"
        IDENTITY_ADMIN = "identity_administrator"
        ORG_ADMIN = "organization_administrator"
        PRODUCT_MANAGER = "product_manager"
        BILLING_ADMIN = "billing_administrator"
        SUPPORT_ADMIN = "support_administrator"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="platform_roles")
    role = models.CharField(max_length=32, choices=Role.choices)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user", "role"], name="uniq_user_platform_role"),
        ]
