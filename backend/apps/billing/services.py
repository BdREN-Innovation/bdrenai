"""Modular payment provider abstraction (manual/offline payments built-in, zero mandatory paid gateways)."""
from django.db import transaction
from django.utils import timezone

from apps.audit.services import record_audit
from apps.subscriptions.services import create_subscription, renew_subscription

from .models import PaymentRecord


@transaction.atomic
def record_manual_payment(*, account, amount, reference: str, currency: str = "BDT", provider: str = PaymentRecord.Provider.MANUAL_OFFLINE, subscription=None, notes: str = ""):
    return PaymentRecord.objects.create(
        account=account,
        subscription=subscription,
        amount=amount,
        currency=currency,
        provider=provider,
        reference=reference,
        status=PaymentRecord.Status.PENDING,
        notes=notes,
    )


@transaction.atomic
def verify_manual_payment(*, payment: PaymentRecord, verifier_user, approve: bool = True, activate_package_version=None, notes: str = ""):
    pmt = PaymentRecord.objects.select_for_update().get(id=payment.id)
    pmt.status = PaymentRecord.Status.COMPLETED if approve else PaymentRecord.Status.REJECTED
    pmt.verified_by = verifier_user
    pmt.verified_at = timezone.now()
    if notes:
        pmt.notes = notes
    if approve:
        if pmt.subscription_id:
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
        metadata={"reference": pmt.reference, "amount": str(pmt.amount)},
    )
    return pmt
