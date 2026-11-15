from .models import AuditLog


def record_audit(*, actor=None, action: str, target_type: str, target_id: str, metadata=None, ip_address=None):
    return AuditLog.objects.create(
        actor=actor if (actor and getattr(actor, "is_authenticated", False)) else None,
        action=action,
        target_type=target_type,
        target_id=str(target_id),
        metadata=metadata or {},
        ip_address=ip_address,
    )
