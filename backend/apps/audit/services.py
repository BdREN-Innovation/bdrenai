import ipaddress

from django.conf import settings

from .models import AuditLog


def audit_entry(*, actor=None, action: str, target_type: str, target_id: str, metadata=None, ip_address=None):
    """An unsaved AuditLog, for callers that write many entries with one bulk_create."""
    return AuditLog(
        actor=actor if (actor and getattr(actor, "is_authenticated", False)) else None,
        action=action,
        target_type=target_type,
        target_id=str(target_id),
        metadata=metadata or {},
        ip_address=ip_address,
    )


def record_audit(*, actor=None, action: str, target_type: str, target_id: str, metadata=None, ip_address=None):
    entry = audit_entry(
        actor=actor, action=action, target_type=target_type, target_id=target_id,
        metadata=metadata, ip_address=ip_address,
    )
    entry.save()
    return entry


def _trusted_networks():
    return [ipaddress.ip_network(net, strict=False) for net in settings.TRUSTED_PROXIES]


def _parse_ip(value):
    try:
        return ipaddress.ip_address((value or "").strip())
    except ValueError:
        return None


def client_ip(request):
    """The client's address for audit entries: `X-Real-IP` when the direct peer is a trusted proxy (the bundled
    nginx sets it to its own peer address), else the peer address itself."""
    peer = _parse_ip(request.META.get("REMOTE_ADDR"))
    if peer is None:
        return None
    if any(peer in net for net in _trusted_networks()):
        forwarded = _parse_ip(request.META.get("HTTP_X_REAL_IP"))
        if forwarded is not None:
            return str(forwarded)
    return str(peer)
