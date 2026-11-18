"""Query-string filters for the superadmin lists (docs/SUPERADMIN_API.md, Conventions)."""
import uuid
from datetime import UTC, datetime, time

from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime

from apps.invitations.errors import invalid

MAX_QUERY_LENGTH = 200


def text(request, name="q"):
    """Trimmed query value ('' when absent)."""
    return (request.GET.get(name) or "").strip()[:MAX_QUERY_LENGTH]


def choice(request, name, choices):
    """A value from `choices`, or None when absent; anything else is a 400."""
    value = text(request, name)
    if not value:
        return None
    if value not in choices:
        raise invalid({name: "Use one of: " + ", ".join(sorted(choices)) + "."})
    return value


def uuid_value(request, name):
    value = text(request, name)
    if not value:
        return None
    try:
        return uuid.UUID(value)
    except ValueError:
        raise invalid({name: "Use an id (UUID)."}) from None


def moment(request, name, *, end_of_day=False):
    """An ISO 8601 date-time (UTC unless it says otherwise), or a date: its first moment, or with
    `end_of_day` its last, so `to=2026-11-18` includes that whole day."""
    value = text(request, name)
    if not value:
        return None
    try:
        day = parse_date(value)
        parsed = None if day else parse_datetime(value)
    except ValueError:
        day = parsed = None
    if day is not None:
        return datetime.combine(day, time.max if end_of_day else time.min, tzinfo=UTC)
    if parsed is None:
        raise invalid({name: "Use an ISO 8601 date or date-time, for example 2026-11-18."})
    return parsed if timezone.is_aware(parsed) else parsed.replace(tzinfo=UTC)
