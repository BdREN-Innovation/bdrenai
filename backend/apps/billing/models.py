import uuid

from django.conf import settings
from django.db import models


class PaymentRecord(models.Model):
    """One payment for a package period: through bKash's tokenized checkout, or recorded by a superadmin
    (bank transfer, cheque, cash, bKash outside the integration). Rows from before billing (`kind = legacy`) have no
    `package_version` and keep their old meaning (docs/BILLING_API.md)."""

    class Kind(models.TextChoices):
        NEW = "new"
        RENEW = "renew"
        UPGRADE = "upgrade"
        LEGACY = "legacy"

    class Method(models.TextChoices):
        BKASH = "bkash"
        BANK_TRANSFER = "bank_transfer"
        CHEQUE = "cheque"
        CASH = "cash"
        BKASH_MANUAL = "bkash_manual"
        OTHER = "other"

    class Status(models.TextChoices):
        PENDING = "pending"
        COMPLETED = "completed"
        FAILED = "failed"
        CANCELLED = "cancelled"
        REJECTED = "rejected"
        REFUNDED = "refunded"
        PARTIALLY_REFUNDED = "partially_refunded"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    account = models.ForeignKey("accounts.Account", on_delete=models.PROTECT, related_name="payments")
    subscription = models.ForeignKey(
        "subscriptions.Subscription", null=True, blank=True, on_delete=models.SET_NULL, related_name="payments"
    )
    package_version = models.ForeignKey(
        "packages.PackageVersion", null=True, blank=True, on_delete=models.PROTECT, related_name="payments"
    )
    kind = models.CharField(max_length=16, choices=Kind.choices, default=Kind.NEW)
    method = models.CharField(max_length=16, choices=Method.choices, default=Method.OTHER)
    status = models.CharField(max_length=24, choices=Status.choices, default=Status.PENDING)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    currency = models.CharField(max_length=8, default="BDT")
    periods = models.PositiveIntegerField(default=1)
    period_start = models.DateTimeField(null=True, blank=True)
    period_end = models.DateTimeField(null=True, blank=True)
    reference = models.CharField(max_length=255, blank=True)
    payer_name = models.CharField(max_length=255, blank=True)
    payment_date = models.DateField(null=True, blank=True)
    notes = models.TextField(blank=True)
    attachment = models.BinaryField(null=True, blank=True)
    attachment_type = models.CharField(max_length=64, blank=True)
    attachment_name = models.CharField(max_length=255, blank=True)
    recorded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    verified_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    verified_at = models.DateTimeField(null=True, blank=True)
    bkash_payment_id = models.CharField(max_length=64, unique=True, null=True, blank=True)
    bkash_trx_id = models.CharField(max_length=64, null=True, blank=True)
    bkash_payer_account = models.CharField(max_length=32, blank=True)
    bkash_status = models.CharField(max_length=32, blank=True)
    # bKash's checkout page for this payment (validated https bKash host), kept for support. Never handed out again:
    # bKash's checkout URL works once (reopening it shows "Invalid page access request").
    bkash_checkout_url = models.CharField(max_length=1000, blank=True)
    failure_reason = models.CharField(max_length=500, blank=True)
    receipt_number = models.CharField(max_length=32, unique=True, null=True, blank=True)
    refunded_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=["status", "created_at"], name="payment_status_created"),
            models.Index(fields=["account", "created_at"], name="payment_account_created"),
            models.Index(fields=["completed_at"], name="payment_completed"),
        ]

    @property
    def is_manual(self):
        return self.method != self.Method.BKASH

    @property
    def has_attachment(self):
        return bool(self.attachment_name)


class Refund(models.Model):
    """Money returned for a payment: through bKash's refund API (`bkash`) or outside the system (`manual`)."""

    class Method(models.TextChoices):
        BKASH = "bkash"
        MANUAL = "manual"

    class Status(models.TextChoices):
        COMPLETED = "completed"
        FAILED = "failed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    payment = models.ForeignKey(PaymentRecord, on_delete=models.PROTECT, related_name="refunds")
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    reason = models.TextField()
    method = models.CharField(max_length=16, choices=Method.choices)
    bkash_refund_trx_id = models.CharField(max_length=64, blank=True)
    status = models.CharField(max_length=16, choices=Status.choices)
    failure_reason = models.CharField(max_length=500, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]


class ReceiptSequence(models.Model):
    """Last receipt number issued per year; the row is locked while the next number is taken."""

    year = models.PositiveIntegerField(primary_key=True)
    last = models.PositiveIntegerField(default=0)
