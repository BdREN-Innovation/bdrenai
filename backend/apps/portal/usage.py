"""Institution usage for the portal's Usage page, dashboard and CSV export: `apps.usage.reports` over the
institution's organization account, on calendar days in BDREN_USAGE_TIMEZONE (how UsageDaily buckets them).

Usage by anyone who now pays for a personal plan and is not a covered member of this institution is left out of
every figure (R2: their usage is private), including totals, so totals minus member rows reveal nothing.
"""
import csv
import re
from dataclasses import dataclass
from datetime import date, timedelta

from django.db.models import Exists, OuterRef, QuerySet
from django.utils import timezone

from apps.accounts.models import Account
from apps.identities.models import User
from apps.invitations.errors import ServiceError, invalid
from apps.invitations.models import Invitation
from apps.invitations.services import SEAT_STATUSES, audit, holds_seat_q, membership_label, with_labels
from apps.organizations.models import Membership
from apps.products.models import Product
from apps.subscriptions.models import Subscription
from apps.subscriptions.plans import paid_personal_q
from apps.usage import reports
from apps.usage.models import usage_day, usage_timezone

DEFAULT_DAYS = 30
MAX_DAYS = 366
DEFAULT_LIMIT = 50
MAX_LIMIT = 200
EXPORT_BATCH = 500
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")
SOURCE = Invitation.Source.PORTAL
CSV_HEADER = ("name", "email", "label", "quantity", "requests", "last_used")


@dataclass(frozen=True)
class Scope:
    """One report's account, inclusive day range, optional product and the users whose usage stays hidden."""

    account: Account
    start: date
    end: date
    product: Product | None
    hidden: QuerySet

    def options(self):
        return {"product": self.product, "exclude_user_ids": self.hidden}

    def range(self):
        return {
            "start": self.start, "end": self.end, "days": (self.end - self.start).days + 1,
            "timezone": usage_timezone().key,
        }


def private_users(org, now=None):
    """User ids (a subquery) with a paid personal plan who are not covered members of `org`."""
    covered_here = Membership.objects.filter(holds_seat_q(), organization=org, user=OuterRef("account__owner_user"))
    return (
        Subscription.objects.filter(paid_personal_q(now)).filter(~Exists(covered_here))
        .values("account__owner_user")
    )


def organization_account(org):
    return Account.objects.filter(organization=org, account_type=Account.Type.ORGANIZATION).first()


def today():
    return usage_day(timezone.now())


def _day(query, key):
    raw = (query.get(key) or "").strip()
    if not raw:
        return None
    if not DATE_RE.match(raw):
        raise invalid({key: "Use a date like 2026-11-18."})
    try:
        return date.fromisoformat(raw)
    except ValueError:
        raise invalid({key: "Use a date like 2026-11-18."}) from None


def date_range(query):
    """`?start=&end=` (YYYY-MM-DD, inclusive): `end` defaults to today, `start` to 29 days before `end`."""
    end = _day(query, "end") or today()
    start = _day(query, "start") or end - timedelta(days=DEFAULT_DAYS - 1)
    if start > end:
        raise invalid({"start": "The start date must not be after the end date."})
    if (end - start).days + 1 > MAX_DAYS:
        raise invalid({"end": f"Choose a range of at most {MAX_DAYS} days."})
    return start, end


def product_from(query):
    """`?product=<slug>` or None (all apps); 400 for an unknown slug."""
    slug = (query.get("product") or "").strip()
    if not slug:
        return None
    product = Product.objects.filter(slug=slug).first()
    if product is None:
        raise invalid({"product": "No app with this name."})
    return product


def _int(query, key, default, *, minimum, maximum=None):
    raw = query.get(key)
    if raw in (None, ""):
        return default
    hint = f"Use a whole number from {minimum}" + (f" to {maximum}." if maximum else " up.")
    try:
        value = int(raw)
    except ValueError:
        raise invalid({key: hint}) from None
    if value < minimum or (maximum is not None and value > maximum):
        raise invalid({key: hint})
    return value


def scope(org, account, start, end, product):
    return Scope(account=account, start=start, end=end, product=product, hidden=private_users(org))


def product_shape(product):
    return {"slug": product.slug, "name": product.name} if product else None


def member_rows(org, rows):
    """by_member rows with each person's name, email and current standing here (membership, coverage, label; null
    when they no longer belong to this institution). Two queries."""
    ids = [r["user_id"] for r in rows]
    users = User.objects.in_bulk(ids)
    memberships = {
        m.user_id: m
        for m in with_labels(Membership.objects.filter(organization=org, user_id__in=ids, status__in=SEAT_STATUSES))
    }
    return [_member_row(r, users[r["user_id"]], memberships.get(r["user_id"])) for r in rows]


def _member_row(row, user, membership):
    return {
        "user": {"id": str(user.id), "name": user.name, "email": user.email},
        "membership_id": str(membership.id) if membership else None,
        "coverage": membership.coverage if membership else None,
        "label": membership_label(membership) if membership else None,
        "quantity": row["quantity"],
        "requests": row["requests"],
        "last_used": row["last_used"],
    }


def account_of(org):
    """The institution's organization account, which holds its usage; 404 `no_usage_account` if it has none."""
    account = organization_account(org)
    if account is None:
        raise ServiceError("no_usage_account", "This institution has no usage account yet.", status=404)
    return account


def report(org, query):
    """The Usage page: `?start=&end=&product=&limit=&offset=` (see docs/SUPERADMIN_API.md "Portal API")."""
    start, end = date_range(query)
    product = product_from(query)
    limit = _int(query, "limit", DEFAULT_LIMIT, minimum=1, maximum=MAX_LIMIT)
    offset = _int(query, "offset", 0, minimum=0)
    s = scope(org, account_of(org), start, end, product)
    args = (s.account, s.start, s.end)
    summary = reports.summary(*args, **s.options())
    rows = reports.by_member(*args, **s.options(), limit=limit, offset=offset)
    return {
        "range": s.range(),
        "product": product_shape(product),
        "summary": summary,
        "by_product": reports.by_product(*args, exclude_user_ids=s.hidden),
        "by_day": reports.by_day(*args, **s.options()),
        "by_feature": reports.by_feature(*args, **s.options()),
        "members": {
            "results": member_rows(org, rows),
            "total": summary["members_with_usage"],
            "limit": limit,
            "offset": offset,
        },
    }


def week(org, product):
    """The dashboard's usage panel: the last 7 days (today included) against the 7 before, the days, and the five
    most active members. None when the institution has no organization account."""
    account = organization_account(org)
    if account is None:
        return None
    end = today()
    s = scope(org, account, end - timedelta(days=6), end, product)
    args = (s.account, s.start, s.end)
    return {
        "range": s.range(),
        "summary": reports.summary(*args, **s.options()),
        "by_day": reports.by_day(*args, **s.options()),
        "top_members": member_rows(org, reports.by_member(*args, **s.options(), limit=5)),
    }


class _Echo:
    def write(self, value):
        return value


def _cell(value):
    text = "" if value is None else str(value)
    return "'" + text if text.startswith(FORMULA_PREFIXES) else text


def _csv_lines(org, s):
    writer = csv.writer(_Echo())
    yield writer.writerow(CSV_HEADER)
    offset = 0
    while True:
        rows = reports.by_member(s.account, s.start, s.end, **s.options(), limit=EXPORT_BATCH, offset=offset)
        for row in member_rows(org, rows):
            user = row["user"]
            yield writer.writerow([_cell(v) for v in (
                user["name"], user["email"], row["label"], row["quantity"], row["requests"], row["last_used"],
            )])
        if len(rows) < EXPORT_BATCH:
            return
        offset += EXPORT_BATCH


def export(actor, org, query, ip_address=None):
    """`(filename, lines)` for the by-member CSV of `?start=&end=&product=`, every member (no paging); audited as
    `usage.exported`."""
    start, end = date_range(query)
    product = product_from(query)
    s = scope(org, account_of(org), start, end, product)
    audit(
        actor=actor, action="usage.exported", target_type="Organization", target_id=org.id, organization_id=org.id,
        ip_address=ip_address, source=SOURCE, start=start.isoformat(), end=end.isoformat(),
        product=product.slug if product else None,
    )
    return f"{org.slug}-usage-{start.isoformat()}-{end.isoformat()}.csv", _csv_lines(org, s)
