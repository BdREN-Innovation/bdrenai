"""Read-only usage reports over UsageDaily, always scoped to one Account (an institution's organization account).

Every function takes a saved `Account` instance, an inclusive `start_day`..`end_day` range, an optional `product`,
an optional `user_ids` iterable (or queryset) that restricts rows to those members, and an optional
`exclude_user_ids` iterable (or queryset) whose members' rows are left out (rows with no recorded member stay).
"""
from datetime import date, timedelta

from django.db.models import Count, F, Max, Q, QuerySet, Sum

from apps.accounts.models import Account

from .models import UsageDaily

SUMMARY_METRICS = ("quantity", "requests", "members_with_usage", "features_used")
TREND_WINDOW_DAYS = 7
DEFAULT_MEMBER_LIMIT = 50


def _check_scope(account: Account, start_day: date, end_day: date):
    if not isinstance(account, Account) or account.pk is None:
        raise TypeError("account must be a saved Account instance")
    if start_day > end_day:
        raise ValueError("start_day must not be after end_day")


def _ids(user_ids):
    return user_ids if isinstance(user_ids, QuerySet) else list(user_ids)


def _scoped(account: Account, start_day: date, end_day: date, product, user_ids, exclude_user_ids=None) -> QuerySet:
    rows = UsageDaily.objects.filter(account=account, day__gte=start_day, day__lte=end_day)
    if product is not None:
        rows = rows.filter(product=product)
    if exclude_user_ids is not None:
        rows = rows.exclude(user_id__in=_ids(exclude_user_ids))
    if user_ids is None:
        return rows
    return rows.filter(user_id__in=_ids(user_ids))


def _totals():
    return {"sum_quantity": Sum("quantity", default=0), "sum_requests": Sum("requests", default=0)}


def _named(row: dict) -> dict:
    named = {k: v for k, v in row.items() if k not in ("sum_quantity", "sum_requests")}
    return {**named, "quantity": row["sum_quantity"], "requests": row["sum_requests"]}


def _period_metrics(prefix: str, condition: Q) -> dict:
    return {
        f"{prefix}quantity": Sum("quantity", filter=condition, default=0),
        f"{prefix}requests": Sum("requests", filter=condition, default=0),
        f"{prefix}members_with_usage": Count("user", distinct=True, filter=condition),
        f"{prefix}features_used": Count("feature", distinct=True, filter=condition),
    }


def _percent_change(current: int, previous: int):
    if not previous:
        return None
    return round((current - previous) * 100 / previous, 1)


def summary(
    account: Account, start_day: date, end_day: date, *, product=None, user_ids=None, exclude_user_ids=None
) -> dict:
    """Totals for the range and for the immediately preceding range of equal length, with percent change."""
    _check_scope(account, start_day, end_day)
    length = (end_day - start_day).days + 1
    previous_end = start_day - timedelta(days=1)
    previous_start = previous_end - timedelta(days=length - 1)
    values = _scoped(account, previous_start, end_day, product, user_ids, exclude_user_ids).aggregate(
        **_period_metrics("current_", Q(day__gte=start_day)),
        **_period_metrics("previous_", Q(day__lte=previous_end)),
    )
    current = {m: values[f"current_{m}"] for m in SUMMARY_METRICS}
    previous = {m: values[f"previous_{m}"] for m in SUMMARY_METRICS}
    return {
        "start_day": start_day,
        "end_day": end_day,
        **current,
        "previous": {"start_day": previous_start, "end_day": previous_end, **previous},
        "change": {m: _percent_change(current[m], previous[m]) for m in SUMMARY_METRICS},
    }


def by_member(
    account: Account,
    start_day: date,
    end_day: date,
    *,
    product=None,
    user_ids=None,
    exclude_user_ids=None,
    limit: int = DEFAULT_MEMBER_LIMIT,
    offset: int = 0,
) -> list:
    """Per-member totals, most quantity first. Usage with no recorded member is left out."""
    _check_scope(account, start_day, end_day)
    if limit < 0 or offset < 0:
        raise ValueError("limit and offset must not be negative")
    rows = (
        _scoped(account, start_day, end_day, product, user_ids, exclude_user_ids)
        .filter(user__isnull=False)
        .values("user_id")
        .annotate(**_totals(), last_used=Max("day"))
        .order_by("-sum_quantity", "-sum_requests", "user_id")
    )
    return [_named(r) for r in rows[offset : offset + limit]]


def by_feature(
    account: Account, start_day: date, end_day: date, *, product=None, user_ids=None, exclude_user_ids=None
) -> list:
    """Per product+feature totals with each one's share of the overall quantity (0..1)."""
    _check_scope(account, start_day, end_day)
    rows = list(
        _scoped(account, start_day, end_day, product, user_ids, exclude_user_ids)
        .values(
            "product_id",
            "feature_id",
            product_slug=F("product__slug"),
            feature_key=F("feature__key"),
            feature_name=F("feature__name"),
            unit=F("feature__unit"),
        )
        .annotate(**_totals())
        .order_by("-sum_quantity", "product_slug", "feature_key")
    )
    total = sum(r["sum_quantity"] for r in rows)
    return [{**_named(r), "share": round(r["sum_quantity"] / total, 4) if total else 0.0} for r in rows]


def by_day(
    account: Account, start_day: date, end_day: date, *, product=None, user_ids=None, exclude_user_ids=None
) -> list:
    """One row per day in the range, zero-filled, with the trailing 7-day average of quantity."""
    _check_scope(account, start_day, end_day)
    lead = TREND_WINDOW_DAYS - 1
    first_day = start_day - timedelta(days=lead)
    found = {
        r["day"]: r
        for r in _scoped(account, first_day, end_day, product, user_ids, exclude_user_ids)
        .values("day")
        .annotate(**_totals())
        .order_by()
    }
    days = [first_day + timedelta(days=i) for i in range((end_day - first_day).days + 1)]
    quantities = [found[d]["sum_quantity"] if d in found else 0 for d in days]
    window = sum(quantities[:lead])
    rows = []
    for i in range(lead, len(days)):
        window += quantities[i]
        rows.append({
            "day": days[i],
            "quantity": quantities[i],
            "requests": found[days[i]]["sum_requests"] if days[i] in found else 0,
            "quantity_avg_7d": round(window / TREND_WINDOW_DAYS, 2),
        })
        window -= quantities[i - lead]
    return rows


def by_product(
    account: Account, start_day: date, end_day: date, *, product=None, user_ids=None, exclude_user_ids=None
) -> list:
    """Per product totals, most quantity first (feeds the "All apps" switcher)."""
    _check_scope(account, start_day, end_day)
    rows = (
        _scoped(account, start_day, end_day, product, user_ids, exclude_user_ids)
        .values("product_id", product_slug=F("product__slug"), product_name=F("product__name"))
        .annotate(**_totals())
        .order_by("-sum_quantity", "product_slug")
    )
    return [_named(r) for r in rows]
