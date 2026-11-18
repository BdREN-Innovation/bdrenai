"""Atomic quota check, reservation, commit, and release engine with mixed-quota policy support."""
from datetime import timedelta

from django.db import IntegrityError, transaction
from django.db.models import F
from django.utils import timezone

from apps.accounts.models import Account
from apps.entitlements.services import (
    current_period_bounds,
    effective_entitlement_for_account,
    plan_accounts,
)
from apps.products.models import Feature, Product

from .models import UsageCounter, UsageDaily, UsageEvent, UsageReservation, usage_day

DEFAULT_RESERVATION_TTL_SECONDS = 300


class QuotaExceededError(Exception):
    def __init__(self, message, details=None):
        super().__init__(message)
        self.details = details or {}


class ReservationStateError(Exception):
    pass


def _lock_counter(account: Account, product: Product, feature: Feature, period: str, now=None) -> UsageCounter:
    """Gets or creates the UsageCounter for the current period and locks the row with SELECT ... FOR UPDATE."""
    now = now or timezone.now()
    p_start, p_end = current_period_bounds(period, now)
    counter = (
        UsageCounter.objects.select_for_update()
        .filter(account=account, product=product, feature=feature, period_start=p_start, period_end=p_end)
        .first()
    )
    if counter is None:
        try:
            with transaction.atomic():
                UsageCounter.objects.create(
                    account=account,
                    product=product,
                    feature=feature,
                    period_start=p_start,
                    period_end=p_end,
                    used=0,
                    reserved=0,
                )
        except IntegrityError:
            pass
        counter = UsageCounter.objects.select_for_update().get(
            account=account, product=product, feature=feature, period_start=p_start, period_end=p_end
        )

    # Reclaim any expired reservations tied to this locked counter before computing remaining quota
    expired_qs = UsageReservation.objects.select_for_update().filter(
        counter=counter,
        status=UsageReservation.Status.RESERVED,
        expires_at__lte=now,
    )
    reclaimed = 0
    for r in expired_qs:
        r.status = UsageReservation.Status.EXPIRED
        r.save(update_fields=["status"])
        reclaimed += r.quantity
    if reclaimed > 0:
        counter.reserved = max(0, counter.reserved - reclaimed)
        counter.save(update_fields=["reserved", "updated_at"])
    return counter


@transaction.atomic
def check_entitlement_status(
    *,
    user,
    product: Product,
    feature: Feature,
    quantity: int = 1,
    organization_account: Account = None,
    policy_override: str = None,
):
    """Evaluates whether `quantity` units of `feature` are allowed under the configured mixed-quota policy."""
    now = timezone.now()
    policy = policy_override or feature.quota_policy
    candidates, covering = plan_accounts(
        user=user, organization_account=organization_account, quota_policy=policy, product=product
    )
    free_fallback = covering is None
    if not candidates:
        return {
            "allowed": False,
            "product": product.slug,
            "feature": feature.key,
            "limit": 0,
            "used": 0,
            "reserved": 0,
            "remaining": 0,
            "reset_at": None,
        }

    if policy == Feature.QuotaPolicy.BOTH:
        # Both personal and organization accounts must have sufficient remaining quota
        snapshots = []
        for acct in candidates:
            ent = effective_entitlement_for_account(acct, product, feature, now, free_fallback=free_fallback)
            if ent is None:
                return {
                    "allowed": False,
                    "product": product.slug,
                    "feature": feature.key,
                    "limit": 0,
                    "used": 0,
                    "reserved": 0,
                    "remaining": 0,
                    "reset_at": None,
                }
            counter = _lock_counter(acct, product, feature, ent.period, now)
            rem = max(0, ent.limit - counter.used - counter.reserved)
            snapshots.append((acct, ent, counter, rem))
        allowed = all(rem >= quantity for _, _, _, rem in snapshots)
        # Report bottlenecks across the pair
        _, ent0, ctr0, rem0 = min(snapshots, key=lambda s: s[3])
        return {
            "allowed": allowed,
            "product": product.slug,
            "feature": feature.key,
            "account_id": str(snapshots[0][0].id),
            "limit": ent0.limit,
            "used": ctr0.used,
            "reserved": ctr0.reserved,
            "remaining": rem0,
            "reset_at": ctr0.period_end.strftime("%Y-%m-%dT%H:%M:%SZ"),
        }

    # Priority policies: PERSONAL_ONLY, ORGANIZATION_ONLY, PERSONAL_THEN_ORG, ORG_THEN_PERSONAL
    last_report = None
    for acct in candidates:
        ent = effective_entitlement_for_account(acct, product, feature, now, free_fallback=free_fallback)
        if ent is None:
            continue
        counter = _lock_counter(acct, product, feature, ent.period, now)
        rem = max(0, ent.limit - counter.used - counter.reserved)
        report = {
            "allowed": rem >= quantity,
            "product": product.slug,
            "feature": feature.key,
            "account_id": str(acct.id),
            "account_type": acct.account_type,
            "limit": ent.limit,
            "used": counter.used,
            "reserved": counter.reserved,
            "remaining": rem,
            "reset_at": counter.period_end.strftime("%Y-%m-%dT%H:%M:%SZ"),
        }
        if rem >= quantity:
            return report
        last_report = report

    return last_report or {
        "allowed": False,
        "product": product.slug,
        "feature": feature.key,
        "limit": 0,
        "used": 0,
        "reserved": 0,
        "remaining": 0,
        "reset_at": None,
    }


@transaction.atomic
def reserve_quota(
    *,
    user,
    product: Product,
    feature: Feature,
    quantity: int,
    idempotency_key: str,
    organization_account: Account = None,
    ttl_seconds: int = DEFAULT_RESERVATION_TTL_SECONDS,
    metadata: dict = None,
):
    """Atomically reserves quota in PostgreSQL (`SELECT ... FOR UPDATE`). Idempotent on `idempotency_key`."""
    if quantity <= 0:
        raise ValueError("quantity must be positive")
    now = timezone.now()
    policy = feature.quota_policy
    candidates, covering = plan_accounts(
        user=user, organization_account=organization_account, quota_policy=policy, product=product
    )
    free_fallback = covering is None
    if not candidates:
        raise QuotaExceededError("No eligible account with entitlement found")

    # Idempotency check across candidate accounts
    existing = UsageReservation.objects.filter(
        account__in=candidates, product=product, idempotency_key=idempotency_key
    ).select_related("counter").first()
    if existing is not None and existing.user_id != user.id:
        raise ReservationStateError("Idempotency key already used by another member's reservation")
    if existing is not None:
        return existing

    # Choose the first candidate account that has sufficient remaining quota
    chosen = None
    for acct in candidates:
        ent = effective_entitlement_for_account(acct, product, feature, now, free_fallback=free_fallback)
        if ent is None:
            continue
        counter = _lock_counter(acct, product, feature, ent.period, now)
        rem = ent.limit - counter.used - counter.reserved
        if rem >= quantity:
            chosen = (acct, ent, counter)
            break

    if chosen is None:
        raise QuotaExceededError("Quota limit exceeded")

    acct, ent, counter = chosen
    counter.reserved += quantity
    counter.save(update_fields=["reserved", "updated_at"])

    reservation = UsageReservation.objects.create(
        account=acct,
        product=product,
        feature=feature,
        counter=counter,
        user=user,
        quantity=quantity,
        status=UsageReservation.Status.RESERVED,
        idempotency_key=idempotency_key,
        metadata=metadata or {},
        expires_at=now + timedelta(seconds=ttl_seconds),
    )
    return reservation


@transaction.atomic
def commit_reservation(*, reservation_id, idempotency_key: str = None, metadata: dict = None):
    """Commits a reservation, converting `reserved` into durable `used` and recording a `UsageEvent`.
    Idempotent if called repeatedly for an already-committed reservation.
    """
    res = UsageReservation.objects.select_for_update().select_related("counter").get(id=reservation_id)
    if res.status == UsageReservation.Status.COMMITTED:
        return res, res.event

    now = timezone.now()
    counter = UsageCounter.objects.select_for_update().get(id=res.counter_id)
    if res.status == UsageReservation.Status.RESERVED and res.expires_at <= now:
        res.status = UsageReservation.Status.EXPIRED
        res.save(update_fields=["status"])
        counter.reserved = max(0, counter.reserved - res.quantity)
        counter.save(update_fields=["reserved", "updated_at"])
        raise ReservationStateError("Reservation has expired")

    if res.status != UsageReservation.Status.RESERVED:
        raise ReservationStateError(f"Cannot commit reservation in status {res.status}")

    counter.reserved = max(0, counter.reserved - res.quantity)
    counter.used += res.quantity
    counter.save(update_fields=["reserved", "used", "updated_at"])

    res.status = UsageReservation.Status.COMMITTED
    res.save(update_fields=["status"])

    event_key = idempotency_key or f"commit:{res.idempotency_key}"
    event, created = UsageEvent.objects.get_or_create(
        account=res.account,
        product=res.product,
        idempotency_key=event_key,
        defaults={
            "feature": res.feature,
            "reservation": res,
            "user_id": res.user_id,
            "quantity": res.quantity,
            "metadata": metadata if metadata is not None else res.metadata,
        },
    )
    if not created:
        raise ReservationStateError("Commit idempotency key already used by another reservation")
    _add_to_daily(event)
    return res, event


def _add_to_daily(event: UsageEvent):
    """Adds one committed event to its UsageDaily bucket; must run inside the commit transaction."""
    bucket = {
        "account_id": event.account_id,
        "product_id": event.product_id,
        "feature_id": event.feature_id,
        "user_id": event.user_id,
        "day": usage_day(event.created_at),
    }
    increment = {"quantity": F("quantity") + event.quantity, "requests": F("requests") + 1}
    if UsageDaily.objects.filter(**bucket).update(**increment):
        return
    try:
        with transaction.atomic():
            UsageDaily.objects.create(**bucket, quantity=event.quantity, requests=1)
        return
    except IntegrityError:
        pass
    UsageDaily.objects.filter(**bucket).update(**increment)


@transaction.atomic
def release_reservation(*, reservation_id):
    """Releases an uncommitted reservation and returns its reserved quantity to the pool. Idempotent."""
    res = UsageReservation.objects.select_for_update().select_related("counter").get(id=reservation_id)
    if res.status in (UsageReservation.Status.RELEASED, UsageReservation.Status.EXPIRED):
        return res
    if res.status == UsageReservation.Status.COMMITTED:
        raise ReservationStateError("Cannot release an already committed reservation")

    counter = UsageCounter.objects.select_for_update().get(id=res.counter_id)
    counter.reserved = max(0, counter.reserved - res.quantity)
    counter.save(update_fields=["reserved", "updated_at"])

    res.status = UsageReservation.Status.RELEASED
    res.save(update_fields=["status"])
    return res
