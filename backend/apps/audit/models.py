import uuid

from django.conf import settings
from django.db import models


class AuditLog(models.Model):
    """Immutable audit trail for security-sensitive and administrative operations."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="audit_logs"
    )
    action = models.CharField(max_length=128, db_index=True)
    target_type = models.CharField(max_length=64)
    target_id = models.CharField(max_length=128)
    metadata = models.JSONField(default=dict, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]
