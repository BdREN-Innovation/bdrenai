"""Receipt numbers, the printable receipt, the receipt email and the end-of-period reminder."""
import logging
from datetime import timedelta
from zoneinfo import ZoneInfo

from django.conf import settings
from django.db import transaction
from django.db.models import Prefetch
from django.template.loader import render_to_string
from django.utils import timezone

from apps.invitations.emails import Outbox
from apps.invitations.models import Notice
from apps.invitations.services import ADMIN_ROLES
from apps.organizations.models import DEFAULT_TIMEZONE, Membership
from apps.products.models import Product
from apps.subscriptions.models import Subscription

from .models import PaymentRecord, ReceiptSequence

log = logging.getLogger(__name__)

REMINDER_WINDOW = timedelta(days=7)
REMINDER_STATUSES = (Subscription.Status.ACTIVE, Subscription.Status.TRIAL, Subscription.Status.PAST_DUE)
METHOD_LABELS = {
    PaymentRecord.Method.BKASH: "bKash",
    PaymentRecord.Method.BANK_TRANSFER: "Bank transfer",
    PaymentRecord.Method.CHEQUE: "Cheque",
    PaymentRecord.Method.CASH: "Cash",
    PaymentRecord.Method.BKASH_MANUAL: "bKash (recorded by BdREN)",
    PaymentRecord.Method.OTHER: "Other",
}


def local_tz(organization=None):
    return ZoneInfo(organization.timezone if organization else DEFAULT_TIMEZONE)


def next_receipt_number(now=None):
    """`<PREFIX>-<YYYY>-<6-digit sequence>`; the year's counter row is locked until the caller's transaction ends,
    so numbers are unique and gap-free per year. Call inside transaction.atomic()."""
    year = (now or timezone.now()).astimezone(local_tz()).year
    sequence, _ = ReceiptSequence.objects.select_for_update().get_or_create(year=year)
    sequence.last += 1
    sequence.save(update_fields=["last"])
    return f"{settings.BILLING_RECEIPT_PREFIX}-{year}-{sequence.last:06d}"


def _day(value, tz):
    local = value.astimezone(tz)
    return f"{local.day} {local:%b %Y}"


def taka(amount):
    return f"BDT {amount:,.2f}"


def context(payment):
    """Template values for a completed payment. Select related `account__organization`,
    `package_version__package` and `account__owner_user` first."""
    org = payment.account.organization
    tz = local_tz(org)
    version = payment.package_version
    owner = payment.account.owner_user
    payer = org.name if org else (owner.name or owner.email if owner else "")
    period = None
    if payment.period_start and payment.period_end:
        period = f"{_day(payment.period_start, tz)} - {_day(payment.period_end - timedelta(seconds=1), tz)}"
    return {
        "number": payment.receipt_number,
        "completed": _day(payment.completed_at or payment.created_at, tz),
        "payer": payer,
        "package": f"{version.package.name} (v{version.version})" if version else "BDREN AI subscription",
        "apps": ", ".join(p.name for p in version.products.all()) if version else "",
        "period": period,
        "method": METHOD_LABELS.get(payment.method, payment.method),
        "reference": payment.bkash_trx_id or payment.reference,
        "amount": taka(payment.amount),
        "refunded": taka(payment.refunded_amount) if payment.refunded_amount else "",
    }


def receipt_html(payment):
    return render_to_string("billing/receipt.html", context(payment))


def receipt_notice(payment, email):
    """Unsaved receipt email for `email` (no links in it)."""
    values = context(payment)
    return Notice(
        kind=Notice.Kind.RECEIPT,
        email=email,
        organization=payment.account.organization,
        subject=f"BDREN AI receipt {payment.receipt_number}",
        body_text=render_to_string("billing/receipt_email.txt", values),
        body_html=render_to_string("billing/receipt_email.html", values),
    )


def email_receipt(payment, user):
    """Queues the receipt email for `user` on the transaction's commit. Call inside the completing transaction."""
    if user is None or not user.email:
        return
    Outbox().notify([receipt_notice(payment, user.email)])


# ---------------------------------------------------------------- end-of-period reminder

def reminder_notice(subscription, email):
    org = subscription.account.organization
    version = subscription.package_version
    apps = [p.name for p in version.products.all()]
    values = {
        "package": version.package.name,
        "ended": _day(subscription.expires_at, local_tz(org)),
        "apps": ", ".join(apps) if apps else "the BDREN AI apps",
    }
    return Notice(
        kind=Notice.Kind.EXPIRY_REMINDER,
        email=email,
        organization=org,
        subject=f"Your {version.package.name} period has ended",
        body_text=render_to_string("billing/expiry_reminder.txt", values),
        body_html=render_to_string("billing/expiry_reminder.html", values),
    )


def send_expiry_reminders(now=None, batch=200):
    """One step: institution subscriptions whose period ended in the last 7 days and were not reminded yet get one
    email to each active owner/admin of the institution. Safe to run concurrently (rows are claimed with
    SKIP LOCKED). Returns (subscriptions reminded, emails queued)."""
    now = now or timezone.now()
    admins = Membership.objects.filter(status=Membership.Status.ACTIVE, role__in=ADMIN_ROLES).select_related("user")
    with transaction.atomic():
        due = list(
            Subscription.objects.select_for_update(skip_locked=True, of=("self",))
            .filter(
                status__in=REMINDER_STATUSES, expiry_reminder_sent_at__isnull=True,
                expires_at__lte=now, expires_at__gt=now - REMINDER_WINDOW,
                account__organization__isnull=False,
            )
            .select_related("account__organization", "package_version__package")
            .prefetch_related(
                Prefetch("package_version__products", queryset=Product.objects.order_by("sort_order", "name")),
                Prefetch("account__organization__memberships", queryset=admins, to_attr="admins"),
            )
            .order_by("expires_at")[:batch]
        )
        outbox = Outbox(limit=batch * 10)
        notices = [
            reminder_notice(sub, m.user.email)
            for sub in due for m in sub.account.organization.admins if m.user.email
        ]
        if notices:
            outbox.notify(notices)
        Subscription.objects.filter(pk__in=[s.pk for s in due]).update(expiry_reminder_sent_at=now)
    if due:
        log.info("expiry reminders subscriptions=%s emails=%s", len(due), len(notices))
    return len(due), len(notices)
