import uuid

from django.conf import settings
from django.db import models
from django.db.models.fields.json import KeyTransform


class AuditLog(models.Model):
    """Immutable audit trail for security-sensitive and administrative operations."""

    class ActorRole(models.TextChoices):
        SUPERADMIN = "superadmin", "Superadmin"
        INSTITUTION_ADMIN = "institution_admin", "Institution admin"
        USER = "user", "User"
        SYSTEM = "system", "System"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="audit_logs"
    )
    # The role the actor acted in, fixed when the entry is written (see `role_for`).
    actor_role = models.CharField(max_length=32, choices=ActorRole.choices, db_index=True)
    action = models.CharField(max_length=128, db_index=True)
    target_type = models.CharField(max_length=64)
    target_id = models.CharField(max_length=128)
    metadata = models.JSONField(default=dict, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            # Institution history: filter(metadata__organization_id=<id>) uses this expression index.
            models.Index(KeyTransform("organization_id", "metadata"), "created_at", name="audit_organization_id"),
            # A user's activity: filter(Q(actor=user) | Q(target_type="User", target_id=...)) and the audit filters.
            models.Index(fields=["target_type", "target_id", "created_at"], name="audit_target"),
        ]

    def save(self, *args, **kwargs):
        if not self.actor_role:
            self.actor_role = role_for(self.actor, self.metadata)
        super().save(*args, **kwargs)


def role_for(actor, metadata):
    """System without an actor; superadmin by platform role; institution admin when acting from the portal; else user.

    The superadmin lookup is cached on the user object, so writing many entries for one actor costs one query.
    """
    if actor is None:
        return AuditLog.ActorRole.SYSTEM
    cached = getattr(actor, "_audit_is_superadmin", None)
    if cached is None:
        from apps.administration.models import PlatformRoleAssignment

        cached = PlatformRoleAssignment.objects.filter(
            user_id=actor.pk, role=PlatformRoleAssignment.Role.SUPER_ADMIN
        ).exists()
        actor._audit_is_superadmin = cached
    if cached:
        return AuditLog.ActorRole.SUPERADMIN
    if (metadata or {}).get("source") == "portal":
        return AuditLog.ActorRole.INSTITUTION_ADMIN
    return AuditLog.ActorRole.USER
