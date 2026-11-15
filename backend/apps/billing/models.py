import uuid

from django.conf import settings
from django.db import models


class PaymentRecord(models.Model):
    """Modular payment record supporting manual/offline payments initially without mandatory paid gateways."""

    class Provider(models.TextChoices):
        MANUAL_OFFLINE = "manual_offline"
        BANK_TRANSFER = "bank_transfer"
        INSTITUTIONAL_INVOICE = "institutional_invoice"

    class Status(models.TextChoices):
        PENDING = "pending"
        COMPLETED = "completed"
        REJECTED = "rejected"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    account = models.ForeignKey("accounts.Account", on_delete=models.PROTECT, related_name="payments")
    subscription = models.ForeignKey(
        "subscriptions.Subscription", null=True, blank=True, on_delete=models.SET_NULL, related_name="payments"
    )
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    currency = models.CharField(max_length=8, default="BDT")
    provider = models.CharField(max_length=32, choices=Provider.choices, default=Provider.MANUAL_OFFLINE)
    reference = models.CharField(max_length=255)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING)
    verified_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    verified_at = models.DateTimeField(null=True, blank=True)
