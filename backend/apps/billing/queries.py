"""Billing reads for the superadmin and portal: payment and subscription lists, the summary tiles."""
from datetime import timedelta

from django.db.models import Count, DecimalField, F, Prefetch, Q, Sum, Value
from django.db.models.functions import Coalesce
from django.utils import timezone

from apps.invitations.shapes import iso
from apps.products.models import Product
from apps.subscriptions.models import Subscription

from . import bkash
from .models import PaymentRecord, Refund
from .services import PAID, payment_queryset

Status = PaymentRecord.Status
Method = PaymentRecord.Method
TABS = ("all", "bkash", "manual", "attention")
METHOD_GROUPS = ("bkash", "manual")
STALE_CHECKOUT = timedelta(minutes=10)
DEFAULT_RANGE = timedelta(days=30)
ZERO = Value(0, output_field=DecimalField(max_digits=12, decimal_places=2))


# ---------------------------------------------------------------- payments

def _method_q(group):
    return Q(method=Method.BKASH) if group == "bkash" else ~Q(method=Method.BKASH)


def attention_q(since=None, until=None, now=None):
    """Pending manual payments awaiting verification, bKash checkouts pending for over 10 minutes, and failed
    payments (created in the period when one is given)."""
    now = now or timezone.now()
    failed = Q(status=Status.FAILED)
    if since is not None:
        failed &= Q(created_at__gte=since)
    if until is not None:
        failed &= Q(created_at__lte=until)
    return (
        Q(status=Status.PENDING) & ~Q(method=Method.BKASH)
        | Q(status=Status.PENDING, method=Method.BKASH, created_at__lt=now - STALE_CHECKOUT)
        | failed
    )


def payment_list(*, q="", status=None, method=None, institution=None, package=None, since=None, until=None,
                 tab="all", account=None):
    qs = payment_queryset()
    if account is not None:
        qs = qs.filter(account=account)
    if tab == "attention":
        qs = qs.filter(attention_q(since, until))
    else:
        if tab in METHOD_GROUPS:
            qs = qs.filter(_method_q(tab))
        if since is not None:
            qs = qs.filter(created_at__gte=since)
        if until is not None:
            qs = qs.filter(created_at__lte=until)
    if method:
        qs = qs.filter(_method_q(method))
    if status:
        qs = qs.filter(status=status)
    if institution:
        qs = qs.filter(account__organization__slug=institution)
    if package:
        qs = qs.filter(package_version__package_id=package)
    if q:
        qs = qs.filter(
            Q(receipt_number__icontains=q) | Q(reference__icontains=q) | Q(bkash_trx_id__icontains=q)
            | Q(payer_name__icontains=q) | Q(account__organization__name__icontains=q)
        )
    return qs.order_by("-created_at", "-pk")


def _totals(since, until):
    paid = Q(status__in=PAID, completed_at__gte=since, completed_at__lte=until)
    net = F("amount") - F("refunded_amount")
    payments = PaymentRecord.objects.aggregate(
        collected=Coalesce(Sum(net, filter=paid), ZERO),
        bkash=Coalesce(Sum(net, filter=paid & Q(method=Method.BKASH)), ZERO),
        manual=Coalesce(Sum(net, filter=paid & ~Q(method=Method.BKASH)), ZERO),
        pending=Count("pk", filter=Q(status=Status.PENDING, created_at__gte=since, created_at__lte=until)),
        failed=Count("pk", filter=Q(status=Status.FAILED, created_at__gte=since, created_at__lte=until)),
    )
    refunds = Refund.objects.filter(
        status=Refund.Status.COMPLETED, created_at__gte=since, created_at__lte=until,
    ).aggregate(total=Coalesce(Sum("amount"), ZERO))["total"]
    money = lambda value: f"{value:.2f}"  # noqa: E731
    return {
        "collected": money(payments["collected"]),
        "bkash": money(payments["bkash"]),
        "manual": money(payments["manual"]),
        "refunds": money(refunds),
        "pending": payments["pending"],
        "failed": payments["failed"],
    }


def summary(since=None, until=None, now=None):
    """Tiles for `[since, until]` (default: the last 30 days) and the previous period of equal length. Collected
    amounts are net of refunds; `refunds` sums refunds made in the period."""
    now = now or timezone.now()
    until = until or now
    since = since or until - DEFAULT_RANGE
    length = until - since
    return {
        **_totals(since, until),
        "from": iso(since),
        "to": iso(until),
        "previous": _totals(since - length, since),
        "bkash_mode": bkash.mode(),
    }


# ---------------------------------------------------------------- subscriptions

def subscription_queryset():
    last_paid = PaymentRecord.objects.defer("attachment").filter(status__in=PAID).order_by("-completed_at")
    return Subscription.objects.select_related(
        "account__organization", "package_version__package", "pending_package_version__package",
    ).prefetch_related(
        Prefetch("package_version__products", queryset=Product.objects.order_by("sort_order", "name")),
        Prefetch("payments", queryset=last_paid, to_attr="last_payments"),
    )


def subscription_list(*, status=None, institution=None, package=None, expiring_within=None, scheduled=False,
                      auto_renew=None, account=None, now=None):
    now = now or timezone.now()
    qs = subscription_queryset()
    if account is not None:
        qs = qs.filter(account=account)
    if status:
        qs = qs.filter(status=status)
    if institution:
        qs = qs.filter(account__organization__slug=institution)
    if package:
        qs = qs.filter(package_version__package_id=package)
    if expiring_within is not None:
        qs = qs.filter(
            status__in=(Subscription.Status.ACTIVE, Subscription.Status.TRIAL, Subscription.Status.PAST_DUE),
            expires_at__gte=now, expires_at__lte=now + timedelta(days=expiring_within),
        )
    if scheduled:
        qs = qs.filter(pending_package_version__isnull=False)
    if auto_renew is not None:
        qs = qs.filter(auto_renew=auto_renew)
    return qs.order_by(F("expires_at").asc(nulls_last=True), "-starts_at", "pk")


def account_billing(account, *, limit=50):
    """`(subscriptions, payments)` of one account: every subscription that is not cancelled, newest first, and
    its latest `limit` payments."""
    subscriptions = list(
        subscription_queryset().filter(account=account).exclude(status=Subscription.Status.CANCELLED)
        .order_by("-starts_at")[:limit]
    )
    payments = list(payment_queryset().filter(account=account).order_by("-created_at", "-pk")[:limit])
    return subscriptions, payments
