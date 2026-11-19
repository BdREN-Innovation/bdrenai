"""Payments: bKash checkout, callback and reconciliation, manual payments, verification, refunds and attachments
(docs/BILLING_API.md).

Every path ends in `complete()`, which applies the quote stored on the payment (package version, periods, period)
in the same transaction as the subscription change, takes a receipt number, and is idempotent: only a `pending`
payment, locked, is ever completed. bKash payments are completed only after our own `execute` or status query says
`Completed`; the browser callback alone proves nothing. Every mutation writes an audit entry with
`metadata.organization_id` when an institution is involved.
"""
import logging
import time
import uuid
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.db.models import Prefetch
from django.utils import timezone
from django.utils.dateparse import parse_date

from apps.accounts.models import Account
from apps.audit.services import record_audit
from apps.invitations.errors import ServiceError, invalid
from apps.invitations.services import audit_metadata, clean_name, seats_used
from apps.organizations.models import Organization
from apps.packages.models import Package
from apps.products.models import Product
from apps.subscriptions.models import Subscription
from apps.subscriptions.services import (
    cancel_subscription,
    create_subscription,
    extend_subscription,
    renew_subscription,
    resume_renewal,
    schedule_change,
)

from . import bkash, quotes, receipts, shapes
from .models import PaymentRecord, Refund

log = logging.getLogger(__name__)

Status = PaymentRecord.Status
Kind = PaymentRecord.Kind
Method = PaymentRecord.Method
MANUAL_METHODS = frozenset(Method.values) - {Method.BKASH}
REFUNDABLE = (Status.COMPLETED, Status.PARTIALLY_REFUNDED)
PAID = (Status.COMPLETED, Status.PARTIALLY_REFUNDED, Status.REFUNDED)
CHECKOUT_WINDOW = timedelta(minutes=10)
RECONCILE_AFTER = timedelta(minutes=10)
GIVE_UP_AFTER = timedelta(hours=24)
STATUS_RETRIES = 3
RETRY_DELAY_SECONDS = 1.0
UNREACHABLE = frozenset({"network", "bad_response", "unauthorized"})
MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024
ATTACHMENT_SIGNATURES = (
    (b"%PDF-", "application/pdf"),
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"\xff\xd8\xff", "image/jpeg"),
)
MAX_AMOUNT = Decimal("99999999.99")
MAX_NOTES = 5000
LEGACY_METHODS = {
    "manual_offline": Method.OTHER, "bank_transfer": Method.BANK_TRANSFER, "institutional_invoice": Method.OTHER,
}
CANCELLED_MESSAGE = "Cancelled on the bKash page; nothing was charged."
ABANDONED_MESSAGE = "Abandoned by the institution admin"
NOT_APPLIED_NOTE = "Paid after a newer purchase of the same apps; no subscription was changed. BdREN refunds it."


def pause(seconds):
    """Waits between status retries (tests replace it)."""
    time.sleep(seconds)


def not_found(message="Not found."):
    return ServiceError("not_found", message, status=404)


def payment_queryset():
    """Payments with everything the `Payment` shape reads (no per-row queries); the attachment bytes are deferred."""
    return (
        PaymentRecord.objects.defer("attachment")
        .select_related(
            "account__organization", "account__owner_user", "package_version__package", "recorded_by", "verified_by",
        )
        .prefetch_related(
            Prefetch("refunds", queryset=Refund.objects.select_related("created_by").order_by("created_at")),
            Prefetch("package_version__products", queryset=Product.objects.order_by("sort_order", "name")),
        )
    )


def load_payment(pk, *, account=None):
    qs = payment_queryset()
    if account is not None:
        qs = qs.filter(account=account)
    payment = qs.filter(pk=pk).first()
    if payment is None:
        raise not_found("No payment with this id.")
    return payment


def _lock(pk, *, account=None):
    qs = (
        PaymentRecord.objects.select_for_update(of=("self",))
        .select_related("account", "package_version__package", "recorded_by", "subscription")
    )
    if account is None:
        return qs.get(pk=pk)
    payment = qs.filter(pk=pk, account=account).first()
    if payment is None:
        raise not_found("No payment with this id.")
    return payment


def audit(payment, action, *, actor=None, ip_address=None, **values):
    return record_audit(
        actor=actor, action=action, target_type="PaymentRecord", target_id=str(payment.id),
        metadata=audit_metadata(
            payment.account.organization_id, account_id=str(payment.account_id), amount=f"{payment.amount:.2f}",
            method=payment.method, kind=payment.kind, **values,
        ),
        ip_address=ip_address,
    )


def organization_account(org):
    account = Account.objects.filter(organization=org, account_type=Account.Type.ORGANIZATION).first()
    if account is None:
        raise ServiceError("no_account", "This institution has no billing account.", status=409)
    return account


# ---------------------------------------------------------------- applying a payment

def _end_covering(account, version, start, actor, note):
    """Cancels the account's live subscriptions covering any app of `version`, their period ending at `start`."""
    apps = quotes.apps_of(version)
    for sub in quotes.live_subscriptions(account):
        if apps & quotes.apps_of(sub.package_version):
            cancel_subscription(subscription=sub, actor=actor, notes=note, ends_at=start)


def _apply(payment, actor):
    """Applies the payment's stored quote; returns the subscription it created or extended. A renewal whose
    subscription was extended meanwhile starts at its new end instead (same length)."""
    version = payment.package_version
    package = version.package
    current = payment.subscription
    if payment.kind == Kind.RENEW and current is not None and current.status in quotes.LIVE:
        if current.expires_at and current.expires_at > payment.period_start:
            length = payment.period_end - payment.period_start
            payment.period_start = current.expires_at
            payment.period_end = current.expires_at + length
        return extend_subscription(
            subscription=current, package_version=version, expires_at=payment.period_end, actor=actor,
            notes=f"Paid: {package.name}, period to {payment.period_end:%Y-%m-%d}",
        )
    now = timezone.now()
    if payment.method == Method.BKASH and payment.period_start < now:
        # A new or upgraded bKash period starts when the money arrives, not when checkout opened (same length).
        length = payment.period_end - payment.period_start
        payment.period_start, payment.period_end = now, now + length
    verb = "Upgraded" if payment.kind == Kind.UPGRADE else "Replaced"
    _end_covering(payment.account, version, payment.period_start, actor, f"{verb} to {package.name}")
    return create_subscription(
        account=payment.account, package_version=version, starts_at=payment.period_start,
        expires_at=payment.period_end, actor=actor, notes=f"Paid: {package.name} v{version.version}",
    )


def _paid_after(payment):
    """True when a payment created after this one was paid and its live subscription covers any of this payment's
    apps (a renewal's own subscription excepted). Applying this payment then would cancel that newer purchase."""
    apps = quotes.apps_of(payment.package_version)
    newer = (
        PaymentRecord.objects.filter(
            account_id=payment.account_id, status__in=PAID, created_at__gt=payment.created_at,
            subscription__status__in=quotes.LIVE,
        )
        .exclude(pk=payment.pk)
        .select_related("subscription__package_version__package")
        .prefetch_related(Prefetch("subscription__package_version__products", queryset=Product.objects.only("id")))
    )
    own = payment.subscription_id if payment.kind == Kind.RENEW else None
    return any(
        other.subscription_id != own and apps & quotes.apps_of(other.subscription.package_version)
        for other in newer
    )


def complete(payment, *, actor=None, ip_address=None, source, email_to=None):
    """Completes a locked `pending` payment (no-op otherwise). Call inside transaction.atomic(). A bKash payment
    that settles after a newer purchase of the same apps was paid (abandoned, or reconciled late) records the money
    but changes no subscription: BdREN refunds it (`NOT_APPLIED_NOTE`)."""
    if payment.status != Status.PENDING:
        return payment
    applied = not (payment.method == Method.BKASH and _paid_after(payment))
    if applied:
        payment.subscription = _apply(payment, actor)
    else:
        log.warning("bkash payment paid after a newer purchase, not applied payment=%s", payment.id)
        payment.subscription = None
        payment.notes = f"{payment.notes}\n{NOT_APPLIED_NOTE}".strip()
    now = timezone.now()
    payment.status = Status.COMPLETED
    payment.completed_at = now
    payment.receipt_number = receipts.next_receipt_number(now)
    payment.failure_reason = ""
    payment.save()
    audit(payment, "payment.completed", actor=actor, ip_address=ip_address, source=source,
          receipt_number=payment.receipt_number,
          subscription_id=str(payment.subscription_id) if applied else None, not_applied=None if applied else True)
    if email_to is not None:
        receipts.email_receipt(load_payment(payment.pk), email_to)
    return payment


def _close(payment, status, reason, *, actor=None, ip_address=None, source, bkash_status=None, action=None):
    """Marks a locked pending payment failed, cancelled or rejected."""
    payment.status = status
    payment.failure_reason = (reason or "")[:500]
    if bkash_status:
        payment.bkash_status = bkash_status[:32]
    payment.save(update_fields=["status", "failure_reason", "bkash_status", "updated_at"])
    audit(payment, action or f"payment.{status}", actor=actor, ip_address=ip_address, source=source, reason=reason)
    return payment


def _create(account, quote, *, method, recorded_by=None, **fields):
    return PaymentRecord.objects.create(
        account=account,
        subscription=quote.subscription,
        package_version=quote.package_version,
        kind=quote.kind,
        method=method,
        status=Status.PENDING,
        amount=fields.pop("amount", quote.amount),
        currency=quote.currency,
        periods=quote.periods,
        period_start=quote.period_start,
        period_end=quote.period_end,
        recorded_by=recorded_by,
        **fields,
    )


def check_seats(org, version):
    """409 `seats_exceed_package` when the institution uses more seats than the version allows."""
    if version.seat_limit is None:
        return
    used = seats_used(org)
    if used > version.seat_limit:
        raise ServiceError(
            "seats_exceed_package",
            f"The institution uses {used} seats; this package allows {version.seat_limit}.",
            status=409, extra={"seats": {"used": used, "cap": version.seat_limit}},
        )


# ---------------------------------------------------------------- input

def find_package(value):
    if not value or not isinstance(value, str):
        raise invalid({"package": "Choose a package."})
    try:
        pk = uuid.UUID(value)
    except ValueError:
        raise not_found("No package with this id.") from None
    package = Package.objects.select_related("product").filter(pk=pk).first()
    if package is None:
        raise not_found("No package with this id.")
    return package


def clean_kind(value):
    if value not in quotes.KINDS:
        raise invalid({"kind": "Use new, renew or upgrade."})
    return value


def clean_periods(value):
    if value is None:
        return 1
    if isinstance(value, str) and value.isdigit():
        value = int(value)
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= quotes.MAX_PERIODS:
        raise invalid({"periods": f"Use a whole number from 1 to {quotes.MAX_PERIODS}."})
    return value


def clean_amount(value, field="amount"):
    amount = None
    if value not in (None, "") and not isinstance(value, bool):
        try:
            amount = Decimal(str(value))
        except InvalidOperation:
            amount = None
    if amount is None or not amount.is_finite() or amount <= 0 or amount > MAX_AMOUNT or amount != round(amount, 2):
        raise invalid({field: "Use an amount above 0 with at most two decimals."})
    return amount.quantize(Decimal("0.01"))


def clean_date(value, field):
    if value in (None, ""):
        return None
    try:
        day = parse_date(value) if isinstance(value, str) else None
    except ValueError:
        day = None
    if day is None:
        raise invalid({field: "Use a date like 2026-11-18."})
    return day


def clean_text(value, field, limit=255):
    if value is None:
        return ""
    if not isinstance(value, str):
        raise invalid({field: "Use text."})
    return value.strip()[:limit]


def flag(data, name):
    value = data.get(name, False)
    if not isinstance(value, bool):
        raise invalid({name: "Use true or false."})
    return value


def start_of_day(day, org):
    return datetime.combine(day, datetime.min.time(), tzinfo=receipts.local_tz(org))


def today(org=None):
    return timezone.now().astimezone(receipts.local_tz(org)).date()


def find_institution(slug):
    if not slug or not isinstance(slug, str):
        raise invalid({"institution": "Choose an institution."})
    org = Organization.objects.filter(slug=slug).first()
    if org is None:
        raise not_found("No institution with this slug.")
    return org


# ---------------------------------------------------------------- bKash checkout

def open_checkout(org, user, package, kind, *, ip_address=None):
    """Validates and stores a pending bKash payment. Call with the organization locked (portal `managing`), so two
    admins cannot start two checkouts at once. `checkout_in_progress` never offers a link back to bKash
    (`redirect_url` is always null): bKash's checkout URL works once, and reopening it shows "Invalid page access
    request" even while the payment is still `Initiated`. The admin waits or abandons the payment instead."""
    account = organization_account(org)
    started = (
        payment_queryset().filter(
            account=account, method=Method.BKASH, status=Status.PENDING,
            created_at__gte=timezone.now() - CHECKOUT_WINDOW,
        ).order_by("-created_at").first()
    )
    if started is not None:
        raise ServiceError(
            "checkout_in_progress",
            "A bKash payment for this institution was started a few minutes ago. Finish it or wait a few minutes.",
            status=409, extra={"payment": shapes.payment(started, portal=True), "redirect_url": None},
        )
    quote = quotes.quote(account, package, kind, public_only=True)
    if not quotes.offered(account, package, kind):
        raise quotes.not_offered("This package is not offered to this institution for that kind of payment.")
    check_seats(org, quote.package_version)
    payment = _create(account, quote, method=Method.BKASH, recorded_by=user, payment_date=today(org))
    audit(payment, "payment.checkout_started", actor=user, ip_address=ip_address, source="portal",
          package_version_id=str(quote.package_version.id))
    return payment


def send_to_bkash(payment, *, actor=None, ip_address=None):
    """Creates the bKash payment for a pending checkout; returns bKash's checkout URL, or None when the payment was
    abandoned meanwhile. bKash errors leave the payment `failed` and raise 502 `bkash_error`."""
    org = payment.account.organization
    try:
        data = bkash.create_payment(
            amount=payment.amount, invoice=payment.id.hex[:20], payer_reference=org.slug if org else "bdren",
        )
    except bkash.BkashError as exc:
        with transaction.atomic():
            locked = _lock(payment.pk)
            if locked.status == Status.PENDING:
                _close(locked, Status.FAILED, f"bKash: {exc.message}", actor=actor, ip_address=ip_address,
                       source="portal")
        raise ServiceError("bkash_error", "bKash could not start the payment. Try again later.", status=502) from None
    with transaction.atomic():
        locked = _lock(payment.pk)
        locked.bkash_payment_id = data["paymentID"]
        locked.bkash_status = (data.get("transactionStatus") or bkash.INITIATED)[:32]
        locked.bkash_checkout_url = data["bkashURL"][:1000]
        locked.save(update_fields=["bkash_payment_id", "bkash_status", "bkash_checkout_url", "updated_at"])
    if locked.status != Status.PENDING:
        # Abandoned while bKash was creating it: the ids are kept so a payer who pays anyway is still recorded.
        return None
    return data["bkashURL"]


def _status_with_retries(payment_id):
    """`(data, error)`: the payment status, retrying `2033 Transaction Not Found` a few times, 1 s apart."""
    error = None
    for attempt in range(STATUS_RETRIES + 1):
        if attempt:
            pause(RETRY_DELAY_SECONDS)
        try:
            return bkash.status(payment_id), None
        except bkash.BkashError as exc:
            error = exc
            if exc.code != bkash.NOT_FOUND:
                break
    return None, error


def _completed_with(payment, data, *, source):
    """Stores bKash's transaction on the locked payment and completes it. An amount other than the one asked
    fails it instead (BdREN refunds it from the panel)."""
    paid = data.get("amount")
    try:
        mismatch = paid is not None and Decimal(str(paid)) != payment.amount
    except InvalidOperation:
        mismatch = True
    payment.bkash_trx_id = (data.get("trxID") or "")[:64] or None
    payment.bkash_payer_account = bkash.mask_account(data.get("payerAccount") or data.get("customerMsisdn"))
    payment.bkash_status = bkash.COMPLETED
    payment.reference = payment.bkash_trx_id or payment.reference
    if mismatch:
        log.warning("bkash amount mismatch payment=%s", payment.id)
        payment.save(update_fields=["bkash_trx_id", "bkash_payer_account", "bkash_status", "reference"])
        return _close(payment, Status.FAILED, "bKash reported a different amount; contact BdREN.", source=source)
    return complete(payment, source=source, email_to=payment.recorded_by)


def _settle(payment, *, source, hold=False):
    """Executes a locked pending bKash payment, then asks for its status, and completes or fails it. It stays
    `pending` (for reconciliation) when bKash could not be reached. With `hold`, a failed execute never fails the
    payment by itself: it stays `pending` unless bKash's status names a final state."""
    exec_error = None
    try:
        data = bkash.execute(payment.bkash_payment_id)
        if data.get("transactionStatus") == bkash.COMPLETED:
            return _completed_with(payment, data, source=source)
    except bkash.BkashError as exc:
        exec_error = exc
    data, status_error = _status_with_retries(payment.bkash_payment_id)
    if data is None:
        if (not hold and exec_error is not None and exec_error.code not in UNREACHABLE
                and status_error.code not in UNREACHABLE):
            return _close(payment, Status.FAILED, f"bKash: {exec_error.message}", source=source)
        log.warning("bkash payment unresolved payment=%s", payment.id)
        return payment
    transaction_status = data.get("transactionStatus") or ""
    if transaction_status == bkash.COMPLETED:
        return _completed_with(payment, data, source=source)
    if hold and transaction_status == bkash.INITIATED:
        return payment
    message = exec_error.message if exec_error is not None else f"payment {transaction_status or 'not completed'}"
    closing = Status.CANCELLED if transaction_status == "Cancelled" else Status.FAILED
    return _close(payment, closing, f"bKash: {message}", source=source, bkash_status=transaction_status)


def _approved(data):
    """bKash's status says the payer approved but nobody executed the payment yet."""
    return data.get("transactionStatus") == bkash.INITIATED and data.get("verificationStatus") == "Complete"


def _awaiting_payer(data):
    return data.get("transactionStatus") == bkash.INITIATED and not _approved(data)


def _settle_from_status(payment, data, *, source, hold=False):
    """Settles a locked pending bKash payment from bKash's status answer: `Completed` completes it, approved but
    not executed is executed (`_settle`), `Cancelled` cancels it and any other final state fails it. A payment still
    awaiting the payer is returned untouched; the caller decides (reconcile waits, abandon cancels)."""
    transaction_status = data.get("transactionStatus") or ""
    if transaction_status == bkash.COMPLETED:
        return _completed_with(payment, data, source=source)
    if transaction_status == bkash.INITIATED:
        return _settle(payment, source=source, hold=hold) if _approved(data) else payment
    if transaction_status == "Cancelled":
        return _close(payment, Status.CANCELLED, CANCELLED_MESSAGE, source=source, bkash_status=transaction_status)
    return _close(payment, Status.FAILED, f"bKash: payment {transaction_status or 'not completed'}",
                  source=source, bkash_status=transaction_status)


def is_abandoned(payment):
    return (payment.method == Method.BKASH and payment.status == Status.CANCELLED
            and payment.failure_reason == ABANDONED_MESSAGE)


def _recover_abandoned(payment, *, source):
    """A locked payment the institution abandoned that bKash later reports paid (or approved) is completed after
    all: the customer paid, so the money is recorded. Anything else leaves it cancelled (bKash's latest state is
    noted so reconciliation stops asking once bKash has moved on)."""
    if not payment.bkash_payment_id:
        return payment
    data, _ = _status_with_retries(payment.bkash_payment_id)
    if data is None:
        return payment
    transaction_status = (data.get("transactionStatus") or "")[:32]
    if transaction_status != bkash.COMPLETED and not _approved(data):
        if transaction_status and transaction_status != payment.bkash_status:
            payment.bkash_status = transaction_status
            payment.save(update_fields=["bkash_status", "updated_at"])
        return payment
    log.warning("bkash abandoned payment paid after all payment=%s", payment.id)
    payment.status = Status.PENDING
    _settle_from_status(payment, data, source=source, hold=True)
    if payment.status == Status.PENDING:
        payment.status = Status.CANCELLED
    return payment


def callback_result(payment):
    if payment.status in PAID:
        return "success"
    if payment.status == Status.CANCELLED:
        return "cancelled"
    if payment.status == Status.PENDING:
        return "pending"
    return "failed"


def handle_callback(payment_id, outcome):
    """bKash's browser callback. Returns the payment after acting on it, or None when the id is unknown."""
    if not isinstance(payment_id, str) or not payment_id or len(payment_id) > 64:
        return None
    pk = PaymentRecord.objects.filter(bkash_payment_id=payment_id).values_list("pk", flat=True).first()
    if pk is None:
        return None
    with transaction.atomic():
        payment = _lock(pk)
        if outcome == "success" and is_abandoned(payment):
            return _recover_abandoned(payment, source="bkash_callback")
        if payment.status != Status.PENDING:
            return payment
        if outcome == "cancel":
            return _close(payment, Status.CANCELLED, CANCELLED_MESSAGE, source="bkash_callback")
        if outcome == "failure":
            return _close(payment, Status.FAILED, "bKash reported that the payment failed.", source="bkash_callback")
        if outcome != "success":
            return payment
        return _settle(payment, source="bkash_callback")


def _locked_unless_busy(pk, status):
    return (
        PaymentRecord.objects.select_for_update(skip_locked=True, of=("self",))
        .select_related("account", "package_version__package", "recorded_by", "subscription")
        .filter(pk=pk, status=status).first()
    )


def reconcile(now=None, batch=100):
    """One pass over pending bKash payments older than 10 minutes (docs/BILLING_API.md, bKash flow 3), then over
    payments abandoned in the last 24 hours that bKash still listed as Initiated (a payer who approved after the
    admin abandoned is completed after all; `rechecked` counts them). Safe to run concurrently: each payment is
    locked with SKIP LOCKED. Returns counts by outcome."""
    now = now or timezone.now()
    counts = {"checked": 0, "completed": 0, "failed": 0, "cancelled": 0, "waiting": 0}
    ids = list(
        PaymentRecord.objects.filter(
            method=Method.BKASH, status=Status.PENDING, created_at__lte=now - RECONCILE_AFTER,
        ).order_by("created_at").values_list("pk", flat=True)[:batch]
    )
    for pk in ids:
        with transaction.atomic():
            payment = _locked_unless_busy(pk, Status.PENDING)
            if payment is None:
                continue
            counts["checked"] += 1
            _reconcile_one(payment, now)
            outcome = "waiting" if payment.status == Status.PENDING else payment.status
            counts[outcome] = counts.get(outcome, 0) + 1
    _recheck_abandoned(now, batch, counts)
    if counts["checked"] or counts.get("rechecked"):
        log.info("bkash reconcile %s", " ".join(f"{k}={v}" for k, v in counts.items()))
    return counts


def _recheck_abandoned(now, batch, counts):
    ids = list(
        PaymentRecord.objects.filter(
            method=Method.BKASH, status=Status.CANCELLED, failure_reason=ABANDONED_MESSAGE,
            bkash_status=bkash.INITIATED, bkash_payment_id__isnull=False,
            created_at__lte=now - RECONCILE_AFTER, created_at__gt=now - GIVE_UP_AFTER,
        ).order_by("created_at").values_list("pk", flat=True)[:batch]
    )
    for pk in ids:
        with transaction.atomic():
            payment = _locked_unless_busy(pk, Status.CANCELLED)
            if payment is None or not is_abandoned(payment):
                continue
            counts["rechecked"] = counts.get("rechecked", 0) + 1
            _recover_abandoned(payment, source="reconcile")
            if payment.status != Status.CANCELLED:
                counts[payment.status] = counts.get(payment.status, 0) + 1


def _reconcile_one(payment, now):
    expired = payment.created_at <= now - GIVE_UP_AFTER
    if not payment.bkash_payment_id:
        return _close(payment, Status.FAILED, "The bKash checkout did not start.", source="reconcile")
    data, error = _status_with_retries(payment.bkash_payment_id)
    if data is None:
        if not expired:
            return payment
        return _close(payment, Status.FAILED, f"bKash: {error.message if error else 'no answer'}", source="reconcile")
    if not _awaiting_payer(data):
        return _settle_from_status(payment, data, source="reconcile")
    transaction_status = data.get("transactionStatus")
    if expired:
        return _close(payment, Status.FAILED, "Not paid within 24 hours.", source="reconcile",
                      bkash_status=transaction_status)
    payment.bkash_status = transaction_status
    payment.save(update_fields=["bkash_status", "updated_at"])
    return payment


# ---------------------------------------------------------------- abandoning a pending bKash payment

ABANDON_RESULTS = {Status.COMPLETED: "completed", Status.CANCELLED: "cancelled", Status.FAILED: "failed"}


def abandon(pk, *, actor, source, account=None, ip_address=None):
    """`POST …/payments/<id>/abandon/`: gives up a pending bKash payment, but never loses money. Under the payment's
    lock bKash is asked for the real state first: paid (or approved, then executed here) completes the payment
    exactly as the callback would; a final bKash state closes it; only a payment still awaiting the payer is
    cancelled as abandoned. Returns `(payment, result)`; 409 `not_pending`, 409 `payment_confirming` (approved but
    execute failed: left pending for reconciliation) and 502 `bkash_error` (bKash unreachable; nothing changed)."""
    problem = None
    with transaction.atomic():
        payment = _lock(pk, account=account)
        if payment.status != Status.PENDING or payment.method != Method.BKASH:
            raise ServiceError("not_pending", "Only a pending bKash payment can be abandoned.", status=409)
        data = None
        if payment.bkash_payment_id:
            data, _ = _status_with_retries(payment.bkash_payment_id)
            if data is None:
                problem = ServiceError(
                    "bkash_error", "bKash did not answer, so the payment was left as it is. Try again later.",
                    status=502,
                )
        if problem is None:
            if data is None or _awaiting_payer(data):
                _close(payment, Status.CANCELLED, ABANDONED_MESSAGE, actor=actor, ip_address=ip_address,
                       source=source, bkash_status=(data or {}).get("transactionStatus"), action="payment.abandoned")
            else:
                _settle_from_status(payment, data, source=source, hold=True)
            if payment.status == Status.PENDING:
                problem = ServiceError(
                    "payment_confirming",
                    "The payer approved this payment and bKash is still confirming it. It will settle shortly.",
                    status=409,
                )
    if problem is not None:
        raise problem
    return payment, ABANDON_RESULTS.get(payment.status, payment.status)


# ---------------------------------------------------------------- manual payments

def record_manual(data, *, actor, ip_address=None):
    """`POST billing/payments/manual/`: a payment received outside bKash, completed now or stored `pending`."""
    org = find_institution(data.get("institution"))
    package = find_package(data.get("package"))
    kind = clean_kind(data.get("kind"))
    periods = clean_periods(data.get("periods"))
    start_day = clean_date(data.get("period_start"), "period_start")
    method = data.get("method")
    if method not in MANUAL_METHODS:
        raise invalid({"method": "Use one of: " + ", ".join(sorted(MANUAL_METHODS)) + "."})
    amount = clean_amount(data.get("amount"))
    notes = clean_text(data.get("notes"), "notes", MAX_NOTES)
    reference = clean_text(data.get("reference"), "reference")
    payer_name = clean_text(data.get("payer_name"), "payer_name")
    payment_date = clean_date(data.get("payment_date"), "payment_date") or today(org)
    pending = flag(data, "pending")
    account = organization_account(org)
    with transaction.atomic():
        quote = manual_quote(account, org, package, kind, periods, start_day)
        if amount != quote.amount and not notes:
            raise invalid({"notes": "The amount differs from the package price; say why in the notes."})
        payment = _create(
            account, quote, method=method, recorded_by=actor, amount=amount, reference=reference,
            payer_name=payer_name, payment_date=payment_date, notes=notes,
        )
        audit(payment, "payment.recorded", actor=actor, ip_address=ip_address, source="superadmin",
              pending=pending or None, quoted_amount=f"{quote.amount:.2f}", reference=reference)
        if not pending:
            payment.verified_by, payment.verified_at = actor, timezone.now()
            complete(payment, actor=actor, ip_address=ip_address, source="superadmin")
    return payment


def manual_quote(account, org, package, kind, periods, start_day=None):
    """The quote a superadmin records against; `start_day` (a local date) moves the start to that day's
    beginning, unless it is the quoted start's own day."""
    quote = quotes.quote(account, package, kind, periods=periods)
    if start_day is None or start_day == quote.period_start.astimezone(receipts.local_tz(org)).date():
        return quote
    return quotes.quote(account, package, kind, periods=periods, period_start=start_of_day(start_day, org))


def _pending_manual(pk):
    payment = _lock(pk)
    if payment.status != Status.PENDING or not payment.is_manual:
        raise ServiceError("not_pending", "Only a pending manual payment can be verified or rejected.", status=409)
    return payment


def verify(pk, *, actor, notes=None, ip_address=None):
    notes = clean_text(notes, "notes", MAX_NOTES)
    with transaction.atomic():
        payment = _pending_manual(pk)
        if payment.package_version_id is None:
            return verify_manual_payment(payment=payment, verifier_user=actor, notes=notes)
        if notes:
            payment.notes = f"{payment.notes}\n{notes}".strip()
        payment.verified_by, payment.verified_at = actor, timezone.now()
        audit(payment, "payment.verified", actor=actor, ip_address=ip_address, source="superadmin", notes=notes)
        return complete(payment, actor=actor, ip_address=ip_address, source="superadmin")


def reject(pk, *, actor, reason, ip_address=None):
    reason = clean_text(reason, "reason", 500)
    if not reason:
        raise invalid({"reason": "Give a reason; it is kept in the audit log."})
    with transaction.atomic():
        payment = _pending_manual(pk)
        payment.verified_by, payment.verified_at = actor, timezone.now()
        payment.save(update_fields=["verified_by", "verified_at"])
        return _close(payment, Status.REJECTED, reason, actor=actor, ip_address=ip_address, source="superadmin")


# ---------------------------------------------------------------- refunds

def _period_is_current(payment, sub, now):
    return (
        sub is not None and sub.status in quotes.LIVE
        and payment.period_start is not None and payment.period_start <= now
        and sub.expires_at is not None and sub.expires_at == payment.period_end
    )


def refund(pk, data, *, actor, ip_address=None):
    """`POST billing/payments/<id>/refund/`. bKash payments go through bKash's refund API; manual payments record
    money returned outside the system. Totals are checked under the payment's row lock. A refused bKash refund is
    kept as a `failed` Refund and nothing changes on the payment."""
    amount = clean_amount(data.get("amount"))
    reason = clean_text(data.get("reason"), "reason", 255)
    if not reason:
        raise invalid({"reason": "Give a reason for the refund."})
    end_subscription = flag(data, "end_subscription")
    failure = None
    with transaction.atomic():
        payment = _lock(pk)
        if payment.status not in REFUNDABLE:
            raise ServiceError("not_refundable", "Only a completed payment can be refunded.", status=409)
        remaining = payment.amount - payment.refunded_amount
        if amount > remaining:
            raise ServiceError(
                "refund_exceeds_payment", f"At most {remaining:.2f} of this payment can still be refunded.",
                status=409, extra={"remaining": f"{remaining:.2f}"},
            )
        now = timezone.now()
        sub = Subscription.objects.select_for_update().filter(pk=payment.subscription_id).first()
        if end_subscription and not _period_is_current(payment, sub, now):
            raise ServiceError(
                "period_not_current", "This payment's period is not the subscription's current one.", status=409,
            )
        method = Refund.Method.BKASH if payment.method == Method.BKASH else Refund.Method.MANUAL
        row = Refund(payment=payment, amount=amount, reason=reason, created_by=actor, method=method,
                     status=Refund.Status.COMPLETED)
        if method == Refund.Method.BKASH:
            failure = _bkash_refund(payment, row)
        row.save()
        if failure is None:
            payment.refunded_amount += amount
            payment.status = Status.REFUNDED if payment.refunded_amount >= payment.amount else Status.PARTIALLY_REFUNDED
            payment.save(update_fields=["refunded_amount", "status", "updated_at"])
            if end_subscription:
                cancel_subscription(subscription=sub, actor=actor, notes=f"Payment refunded: {reason}", ends_at=now,
                                    ip_address=ip_address)
        audit(payment, "payment.refunded" if failure is None else "payment.refund_failed", actor=actor,
              ip_address=ip_address, source="superadmin", refund_id=str(row.id), refund_amount=f"{amount:.2f}",
              reason=reason, end_subscription=end_subscription or None, error=failure)
    if failure is not None:
        raise ServiceError("bkash_error", f"bKash did not refund the payment: {failure}", status=502)
    return payment


def _bkash_refund(payment, row):
    """Calls bKash; fills `row` and returns None, or marks it failed and returns the reason."""
    try:
        data = bkash.refund(
            payment_id=payment.bkash_payment_id, trx_id=payment.bkash_trx_id, amount=row.amount,
            sku=payment.receipt_number or str(payment.id), reason=row.reason,
        )
    except bkash.BkashError as exc:
        row.status, row.failure_reason = Refund.Status.FAILED, exc.message[:500]
        return exc.message
    if data.get("transactionStatus") not in (None, bkash.COMPLETED) or not data.get("refundTrxID"):
        row.status, row.failure_reason = Refund.Status.FAILED, "bKash did not confirm the refund."
        return row.failure_reason
    row.bkash_refund_trx_id = str(data["refundTrxID"])[:64]
    return None


# ---------------------------------------------------------------- scheduled downgrades (portal)

def schedule_downgrade(org, user, package, *, ip_address=None):
    """`POST billing/downgrade/`: the live subscription covering the package's apps moves to `package` at its next
    renewal. Call with the organization locked (portal `managing`)."""
    account = organization_account(org)
    version = quotes.buyable_version(package, public_only=True)
    apps = quotes.apps_of(version)
    live = quotes.live_subscriptions(account)
    current = next((s for s in live if apps & quotes.apps_of(s.package_version)), None)
    if current is None:
        raise ServiceError(
            "nothing_to_downgrade", "No active subscription covers this package's apps.", status=409,
        )
    if current.package_version.package_id == package.pk:
        raise quotes.not_offered("This is the current package.")
    if quotes.apps_of(current.package_version) != apps:
        raise quotes.not_offered("A downgrade must cover the same apps as the current package.")
    if quotes.daily_rate(version) >= quotes.daily_rate(current.package_version):
        raise quotes.not_offered("A downgrade must cost less per period than the current package.")
    if not current.auto_renew:
        raise ServiceError(
            "renewal_stopped", "This subscription is set not to renew, so no change can be scheduled.", status=409,
        )
    check_seats(org, version)
    schedule_change(
        subscription=current, package_version=version, actor=user, ip_address=ip_address,
        notes=f"Downgrade to {package.name} scheduled for the next renewal (portal)",
    )
    return current.pk


def cancel_downgrade(org, user, *, subscription_id=None, ip_address=None):
    """`DELETE billing/downgrade/`: clears the scheduled change (of `subscription_id`, or of every live
    subscription that has one). Returns the id of the (first) subscription changed."""
    account = organization_account(org)
    scheduled = Subscription.objects.filter(
        account=account, status__in=quotes.LIVE, pending_package_version__isnull=False,
    ).order_by("starts_at")
    if subscription_id is not None:
        scheduled = scheduled.filter(pk=subscription_id)
    subs = list(scheduled)
    if not subs:
        raise ServiceError("no_scheduled_change", "No change is scheduled.", status=409)
    for sub in subs:
        schedule_change(subscription=sub, package_version=None, actor=user, ip_address=ip_address,
                        notes="Scheduled downgrade cancelled (portal)")
    return subs[0].pk


# ---------------------------------------------------------------- attachments and receipts

def attachment_type(content):
    return next((kind for magic, kind in ATTACHMENT_SIGNATURES if content.startswith(magic)), None)


def attach(pk, upload, *, actor, ip_address=None):
    """Stores a bank slip (PDF/PNG/JPEG by file signature, at most 5 MB), replacing any earlier one."""
    if upload is None:
        raise invalid({"file": "Choose a file (PDF, PNG or JPEG)."})
    if upload.size > MAX_ATTACHMENT_BYTES:
        raise invalid({"file": "The file is larger than 5 MB."})
    content = upload.read(MAX_ATTACHMENT_BYTES + 1)
    kind = attachment_type(content)
    if len(content) > MAX_ATTACHMENT_BYTES or kind is None:
        raise invalid({"file": "Use a PDF, PNG or JPEG file up to 5 MB."})
    name = clean_name(upload.name or "", limit=200).replace('"', "").replace("\\", "").replace("/", "") or "attachment"
    with transaction.atomic():
        payment = _lock(pk)
        payment.attachment, payment.attachment_type, payment.attachment_name = content, kind, name
        payment.save(update_fields=["attachment", "attachment_type", "attachment_name", "updated_at"])
        audit(payment, "payment.attachment_added", actor=actor, ip_address=ip_address, source="superadmin",
              file_name=name, file_type=kind, size=len(content))
    return payment


def attachment(pk, *, account=None):
    """`(bytes, content type, file name)`."""
    qs = PaymentRecord.objects.filter(pk=pk)
    if account is not None:
        qs = qs.filter(account=account)
    row = qs.values("attachment", "attachment_type", "attachment_name").first()
    if row is None or not row["attachment_name"]:
        raise not_found("This payment has no attachment.")
    return bytes(row["attachment"]), row["attachment_type"], row["attachment_name"]


def receipt(pk, *, account=None):
    payment = load_payment(pk, account=account)
    if payment.status not in PAID or not payment.receipt_number:
        raise ServiceError("receipt_unavailable", "A receipt exists only for a completed payment.", status=409)
    return receipts.receipt_html(payment)


# ---------------------------------------------------------------- legacy (catalog subscribe, admin API)

@transaction.atomic
def record_manual_payment(*, account, amount, reference: str, currency: str = "BDT", provider: str = "manual_offline",
                          subscription=None, notes: str = ""):
    """Legacy: a payment reference sent with a catalog subscription request, verified by `verify_manual_payment`."""
    return PaymentRecord.objects.create(
        account=account,
        subscription=subscription,
        amount=amount,
        currency=currency,
        kind=Kind.LEGACY,
        method=LEGACY_METHODS.get(provider, Method.OTHER),
        reference=reference,
        status=Status.PENDING,
        payment_date=timezone.now().date(),
        notes=notes,
    )


@transaction.atomic
def verify_manual_payment(*, payment: PaymentRecord, verifier_user, approve: bool = True, activate_package_version=None,
                          notes: str = ""):
    """Legacy admin API verification. Payments made through billing (`package_version` set) apply their own quote."""
    pmt = PaymentRecord.objects.select_for_update(of=("self",)).select_related("account").get(id=payment.id)
    if pmt.package_version_id is not None:
        if pmt.status != Status.PENDING:
            return pmt
        if not approve:
            return reject(pmt.pk, actor=verifier_user, reason=notes or "Rejected")
        return verify(pmt.pk, actor=verifier_user, notes=notes)
    pmt.status = Status.COMPLETED if approve else Status.REJECTED
    pmt.verified_by = verifier_user
    pmt.verified_at = timezone.now()
    if notes:
        pmt.notes = notes
    if approve:
        pmt.completed_at = pmt.verified_at
        pmt.receipt_number = receipts.next_receipt_number(pmt.verified_at)
        if pmt.subscription_id:
            resume_renewal(
                subscription=pmt.subscription, actor=verifier_user,
                notes=f"Paid again ({pmt.reference}); renews again", metadata={"payment_id": str(pmt.id)},
            )
            renew_subscription(subscription=pmt.subscription, actor=verifier_user, notes=f"Verified payment {pmt.reference}")
        elif activate_package_version is not None:
            sub = create_subscription(
                account=pmt.account,
                package_version=activate_package_version,
                actor=verifier_user,
                notes=f"Activated via verified payment {pmt.reference}",
            )
            pmt.subscription = sub
    pmt.save()
    record_audit(
        actor=verifier_user,
        action="payment.verified" if approve else "payment.rejected",
        target_type="PaymentRecord",
        target_id=str(pmt.id),
        metadata=audit_metadata(pmt.account.organization_id, reference=pmt.reference, amount=str(pmt.amount)),
    )
    return pmt
