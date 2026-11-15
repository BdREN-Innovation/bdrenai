import uuid

from django.db import models


class UsageCounter(models.Model):
    """Durable, row-locked usage counter in PostgreSQL for an Account + Product + Feature + billing period."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    account = models.ForeignKey("accounts.Account", on_delete=models.CASCADE, related_name="usage_counters")
    product = models.ForeignKey("products.Product", on_delete=models.CASCADE, related_name="usage_counters")
    feature = models.ForeignKey("products.Feature", on_delete=models.CASCADE, related_name="usage_counters")
    period_start = models.DateTimeField()
    period_end = models.DateTimeField()
    used = models.BigIntegerField(default=0)
    reserved = models.BigIntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["account", "product", "feature", "period_start", "period_end"],
                name="uniq_usage_counter_period",
            ),
            models.CheckConstraint(
                condition=models.Q(used__gte=0, reserved__gte=0),
                name="chk_usage_counter_nonneg",
            ),
        ]


class UsageReservation(models.Model):
    """Two-phase quota reservation (reserve -> commit or release/expire) with idempotency protection."""

    class Status(models.TextChoices):
        RESERVED = "reserved"
        COMMITTED = "committed"
        RELEASED = "released"
        EXPIRED = "expired"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    account = models.ForeignKey("accounts.Account", on_delete=models.CASCADE, related_name="usage_reservations")
    product = models.ForeignKey("products.Product", on_delete=models.CASCADE, related_name="usage_reservations")
    feature = models.ForeignKey("products.Feature", on_delete=models.CASCADE, related_name="usage_reservations")
    counter = models.ForeignKey(UsageCounter, on_delete=models.CASCADE, related_name="reservations")
    quantity = models.BigIntegerField()
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.RESERVED)
    idempotency_key = models.CharField(max_length=128)
    metadata = models.JSONField(default=dict, blank=True)
    expires_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["account", "product", "idempotency_key"],
                name="uniq_reservation_idempotency",
            ),
            models.CheckConstraint(condition=models.Q(quantity__gt=0), name="chk_reservation_qty_pos"),
        ]


class UsageEvent(models.Model):
    """Immutable durable ledger of committed quota consumption."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    account = models.ForeignKey("accounts.Account", on_delete=models.CASCADE, related_name="usage_events")
    product = models.ForeignKey("products.Product", on_delete=models.CASCADE, related_name="usage_events")
    feature = models.ForeignKey("products.Feature", on_delete=models.CASCADE, related_name="usage_events")
    reservation = models.OneToOneField(
        UsageReservation, null=True, blank=True, on_delete=models.SET_NULL, related_name="event"
    )
    quantity = models.BigIntegerField()
    idempotency_key = models.CharField(max_length=128)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["account", "product", "idempotency_key"],
                name="uniq_usage_event_idempotency",
            ),
            models.CheckConstraint(condition=models.Q(quantity__gt=0), name="chk_usage_event_qty_pos"),
        ]
