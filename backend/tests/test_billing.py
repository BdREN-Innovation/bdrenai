"""Billing core: quotes, bKash checkout / callback / reconciliation, and the rule that only bKash's own word
completes a payment (docs/BILLING_API.md). bKash is faked at the HTTP boundary only."""
from datetime import timedelta
from decimal import Decimal

import pytest
from django.test import Client
from django.utils import timezone

from apps.audit.models import AuditLog
from apps.billing import quotes
from apps.billing import services as billing
from apps.billing import shapes as billing_shapes
from apps.billing.models import PaymentRecord
from apps.invitations.errors import ServiceError
from apps.invitations.models import Notice
from apps.packages.models import Package
from apps.products.models import Product
from apps.subscriptions.models import Subscription
from tests.billing_support import (  # noqa: F401  (fixtures)
    BKASH_URL,
    CALLBACK,
    PAYMENT_ID,
    TRX_ID,
    account,
    admin,
    age,
    apps_,
    boss,
    created,
    error,
    executed,
    fake_bkash,
    invalid_state,
    manual_body,
    member,
    network_error,
    no_bkash,
    not_found,
    org,
    other_org,
    owner,
    packages,
    portal,
    signed_in,
    status_of,
    subscribe,
    superadmin,
)

pytestmark = pytest.mark.django_db

Status = PaymentRecord.Status


def refused(call):
    with pytest.raises(ServiceError) as caught:
        call()
    return caught.value.status, caught.value.code


# ---------------------------------------------------------------- quotes

def test_quote_new_starts_now_for_whole_periods(account, packages):
    before = timezone.now()
    q = quotes.quote(account, packages["basic"], "new", periods=3)
    assert (q.kind, q.amount, q.currency, q.periods, q.subscription) == ("new", Decimal("3000.00"), "BDT", 3, None)
    assert before <= q.period_start <= timezone.now()
    assert q.period_end - q.period_start == timedelta(days=90)
    body = q.body()
    assert body["package_version"] == 1 and body["amount"] == "3000.00" and body["kind"] == "new"


def test_quote_yearly_period_is_365_days_per_period(account, apps_):
    from tests.billing_support import single
    yearly = single(apps_["synapse"], "yearly", 10000, billing_interval=Package.BillingInterval.YEARLY)
    q = quotes.quote(account, yearly, "new", periods=2)
    assert q.period_end - q.period_start == timedelta(days=730)


def test_quote_renew_starts_at_the_current_period_end(account, packages):
    sub = subscribe(account, packages["basic"], days_left=5)
    q = quotes.quote(account, packages["basic"], "renew")
    assert q.period_start == sub.expires_at and q.subscription.pk == sub.pk
    assert q.period_end == sub.expires_at + timedelta(days=30)


def test_quote_renew_after_expiry_starts_now(account, packages):
    sub = subscribe(account, packages["basic"], days_left=-3)
    q = quotes.quote(account, packages["basic"], "renew")
    assert q.period_start > sub.expires_at and q.period_start >= timezone.now() - timedelta(seconds=5)


def test_quote_upgrade_starts_now_and_names_the_current_subscription(account, packages):
    sub = subscribe(account, packages["basic"])
    q = quotes.quote(account, packages["standard"], "upgrade")
    assert (q.kind, q.amount, q.subscription.pk) == ("upgrade", Decimal("3000.00"), sub.pk)
    assert abs((q.period_start - timezone.now()).total_seconds()) < 5


def test_quote_refusals(account, packages, apps_):
    basic, standard = packages["basic"], packages["standard"]
    assert refused(lambda: quotes.quote(account, packages["free"], "new")) == (400, "free_package")
    assert refused(lambda: quotes.quote(account, basic, "renew")) == (400, "package_not_offered")
    assert refused(lambda: quotes.quote(account, basic, "upgrade")) == (400, "package_not_offered")
    subscribe(account, standard)
    assert refused(lambda: quotes.quote(account, basic, "new")) == (400, "package_not_offered")
    assert refused(lambda: quotes.quote(account, basic, "upgrade")) == (400, "package_not_offered")
    assert refused(lambda: quotes.quote(account, standard, "upgrade")) == (400, "package_not_offered")
    assert refused(lambda: quotes.quote(account, basic, "bogus")) == (400, "invalid")


def test_quote_unavailable_packages(account, packages, apps_):
    archived = packages["mind"]
    Package.objects.filter(pk=archived.pk).update(status=Package.Status.ARCHIVED)
    archived.refresh_from_db()
    assert refused(lambda: quotes.quote(account, archived, "new")) == (400, "package_unavailable")
    Product.objects.filter(slug="mindspear").update(status=Product.Status.INACTIVE)
    assert refused(lambda: quotes.quote(account, packages["suite"], "new")) == (400, "package_unavailable")
    hidden = packages["basic"]
    Package.objects.filter(pk=hidden.pk).update(is_public=False)
    hidden.refresh_from_db()
    assert refused(lambda: quotes.quote(account, hidden, "new", public_only=True)) == (400, "package_unavailable")
    assert quotes.quote(account, hidden, "new").amount == Decimal("1000.00")


def test_quote_single_app_already_in_the_bundle_is_covered_by_bundle(account, packages):
    subscribe(account, packages["suite"])
    assert refused(lambda: quotes.quote(account, packages["mind"], "new")) == (409, "covered_by_bundle")
    assert refused(lambda: quotes.quote(account, packages["mind"], "upgrade")) == (409, "covered_by_bundle")


# ---------------------------------------------------------------- bKash checkout and callback

def checkout(client, package, kind="new"):
    return portal(client, "post", "checkout/", {"package": str(package.id), "kind": kind})


def callback(client, outcome="success", payment_id=PAYMENT_ID):
    return client.get(CALLBACK, {"paymentID": payment_id, "status": outcome})


def test_checkout_creates_a_pending_bkash_payment(fake_bkash, admin, packages):
    fake_bkash.on("checkout/create", created())
    r = checkout(signed_in(admin.user), packages["basic"])
    assert r.status_code == 201, r.json()
    body = r.json()
    assert body["redirect_url"] == BKASH_URL
    payment = PaymentRecord.objects.get()
    assert (payment.status, payment.method, payment.kind, payment.amount) == (
        Status.PENDING, "bkash", "new", Decimal("1000.00"))
    assert payment.bkash_payment_id == PAYMENT_ID and payment.recorded_by == admin.user
    assert body["payment"]["id"] == str(payment.id) and body["payment"]["bkash"]["payment_id"] == PAYMENT_ID
    assert body["payment"]["recorded_by"] == {"name": "Admin"}
    sent = fake_bkash.bodies("checkout/create")[0]
    assert sent == {
        "mode": "0011", "payerReference": "sau", "callbackURL": "http://api.test/api/v1/payments/bkash/callback/",
        "amount": "1000.00", "currency": "BDT", "intent": "sale", "merchantInvoiceNumber": payment.id.hex[:20],
    }
    create_call = next(c for c in fake_bkash.calls if c["path"] == "checkout/create")
    assert create_call["headers"]["X-App-Key"] == "test-app-key"
    assert create_call["headers"]["Authorization"] == "eyJraWQiOiJvTVJzNU9ZY0wrUnRXCI"
    assert AuditLog.objects.filter(action="payment.checkout_started", target_id=str(payment.id)).exists()


def test_callback_success_completes_exactly_once(fake_bkash, admin, packages, client):
    fake_bkash.on("checkout/create", created()).on("checkout/execute", executed())
    checkout(signed_in(admin.user), packages["basic"])
    payment = PaymentRecord.objects.get()

    r = callback(client)
    assert r.status_code == 302
    assert r["Location"] == f"http://admin.test/admin/portal/sau/billing?payment={payment.id}&result=success"
    payment.refresh_from_db()
    assert payment.status == Status.COMPLETED and payment.receipt_number.startswith("BDR-")
    assert (payment.bkash_trx_id, payment.reference, payment.bkash_payer_account) == (TRX_ID, TRX_ID, "********378")
    sub = payment.subscription
    assert (sub.status, sub.package_version.package_id) == (Subscription.Status.ACTIVE, packages["basic"].pk)
    assert sub.expires_at == payment.period_end
    assert payment.applied is True and payment.target_subscription_id is None
    shown = billing_shapes.payment(billing.load_payment(payment.pk))
    assert (shown["applied"], shown["subscription_id"], shown["target_subscription_id"]) == (True, str(sub.pk), None)

    again = callback(client)
    assert again["Location"].endswith("result=success")
    assert fake_bkash.paths().count("checkout/execute") == 1
    assert Subscription.objects.count() == 1
    assert AuditLog.objects.filter(action="payment.completed", target_id=str(payment.id)).count() == 1
    receipts = Notice.objects.filter(kind=Notice.Kind.RECEIPT)
    assert [n.email for n in receipts] == ["admin@sau.ac.bd"]
    assert payment.receipt_number in receipts[0].body_text


def test_bkash_new_period_starts_when_the_money_arrives(fake_bkash, admin, packages, client):
    """Checkout opened an hour before bKash confirmed: the 30 days count from completion, not from checkout."""
    fake_bkash.on("checkout/create", created()).on("checkout/execute", executed())
    checkout(signed_in(admin.user), packages["basic"])
    payment = PaymentRecord.objects.get()
    hour_ago = timedelta(hours=1)
    PaymentRecord.objects.filter(pk=payment.pk).update(
        period_start=payment.period_start - hour_ago, period_end=payment.period_end - hour_ago)

    before = timezone.now()
    callback(client)
    payment.refresh_from_db()
    assert payment.period_start >= before
    assert payment.period_end - payment.period_start == timedelta(days=30)
    assert payment.subscription.starts_at == payment.period_start
    assert payment.subscription.expires_at == payment.period_end


def test_callback_renewal_extends_from_the_period_end(fake_bkash, admin, account, packages, client):
    sub = subscribe(account, packages["basic"], days_left=5)
    old_end = sub.expires_at
    fake_bkash.on("checkout/create", created()).on("checkout/execute", executed())
    assert checkout(signed_in(admin.user), packages["basic"], "renew").status_code == 201
    pending = PaymentRecord.objects.get()
    assert (pending.subscription_id, pending.target_subscription_id, pending.applied) == (None, sub.pk, None)
    shown = billing_shapes.payment(billing.load_payment(pending.pk), portal=True)
    assert (shown["subscription_id"], shown["target_subscription_id"]) == (None, str(sub.pk))
    callback(client)
    sub.refresh_from_db()
    payment = PaymentRecord.objects.get()
    assert payment.status == Status.COMPLETED and payment.subscription_id == sub.pk
    assert payment.target_subscription_id == sub.pk and payment.applied is True
    assert payment.period_start == old_end
    assert sub.expires_at == old_end + timedelta(days=30) and sub.status == Subscription.Status.ACTIVE
    assert Subscription.objects.count() == 1


def test_callback_upgrade_ends_the_old_subscription_now(fake_bkash, admin, account, packages, client):
    old = subscribe(account, packages["basic"], days_left=20)
    fake_bkash.on("checkout/create", created("3000")).on("checkout/execute", executed("3000"))
    assert checkout(signed_in(admin.user), packages["standard"], "upgrade").status_code == 201
    callback(client)
    old.refresh_from_db()
    payment = PaymentRecord.objects.get()
    assert payment.status == Status.COMPLETED
    new = payment.subscription
    assert new.pk != old.pk and new.package_version.package_id == packages["standard"].pk
    assert old.status == Subscription.Status.CANCELLED
    assert abs((old.expires_at - payment.period_start).total_seconds()) < 1
    assert old.history.filter(notes__startswith="Upgraded to Standard").exists()
    assert payment.target_subscription_id == old.pk and payment.applied is True


@pytest.mark.parametrize(("outcome", "status", "result"), [
    ("cancel", Status.CANCELLED, "cancelled"), ("failure", Status.FAILED, "failed"),
])
def test_callback_cancel_or_failure_closes_without_asking_bkash(fake_bkash, admin, packages, client, outcome, status,
                                                                 result):
    fake_bkash.on("checkout/create", created())
    checkout(signed_in(admin.user), packages["basic"])
    r = callback(client, outcome)
    payment = PaymentRecord.objects.get()
    assert payment.status == status and payment.failure_reason
    assert r["Location"].endswith(f"result={result}")
    assert fake_bkash.paths() == ["checkout/create"]
    assert not Subscription.objects.exists()


def test_execute_2056_fails_the_payment(fake_bkash, admin, packages, client):
    fake_bkash.on("checkout/create", created()).on("checkout/execute", invalid_state())
    fake_bkash.on("checkout/payment/status", status_of("Initiated", verification="Incomplete"))
    checkout(signed_in(admin.user), packages["basic"])
    r = callback(client)
    payment = PaymentRecord.objects.get()
    assert payment.status == Status.FAILED and "Invalid Payment State" in payment.failure_reason
    assert payment.bkash_status == "Initiated" and r["Location"].endswith("result=failed")
    assert not Subscription.objects.exists()


def test_status_2033_is_retried_until_completed(fake_bkash, admin, packages, client):
    fake_bkash.on("checkout/create", created()).on("checkout/execute", network_error())
    fake_bkash.on("checkout/payment/status", not_found(), not_found(), status_of("Completed"))
    checkout(signed_in(admin.user), packages["basic"])
    callback(client)
    payment = PaymentRecord.objects.get()
    assert payment.status == Status.COMPLETED and payment.bkash_trx_id == TRX_ID
    assert fake_bkash.paths().count("checkout/payment/status") == 3


def test_status_success_alone_never_completes(fake_bkash, admin, packages, client):
    """bKash unreachable after the browser says success: the payment stays pending for reconciliation."""
    fake_bkash.on("checkout/create", created()).on("checkout/execute", network_error())
    fake_bkash.on("checkout/payment/status", network_error())
    checkout(signed_in(admin.user), packages["basic"])
    r = callback(client)
    payment = PaymentRecord.objects.get()
    assert payment.status == Status.PENDING and payment.receipt_number is None
    assert r["Location"].endswith("result=pending")
    assert not Subscription.objects.exists()


def test_status_says_another_amount_fails_the_payment(fake_bkash, admin, packages, client):
    fake_bkash.on("checkout/create", created()).on("checkout/execute", executed("10"))
    checkout(signed_in(admin.user), packages["basic"])
    callback(client)
    payment = PaymentRecord.objects.get()
    assert payment.status == Status.FAILED and payment.bkash_trx_id == TRX_ID
    assert not Subscription.objects.exists()


def test_callback_for_an_unknown_payment_goes_to_the_console(fake_bkash, client):
    r = callback(client, payment_id="TR00unknown")
    assert (r.status_code, r["Location"]) == (302, "http://admin.test/admin/")
    assert client.get(CALLBACK)["Location"] == "http://admin.test/admin/"


def test_checkout_in_progress_returns_the_pending_payment(fake_bkash, admin, packages):
    """bKash's checkout URL works once (reopening it shows "Invalid page access request"), so the 409 never hands
    it back: `redirect_url` is always null, even while bKash still lists the payment as Initiated."""
    fake_bkash.on("checkout/create", created())
    c = signed_in(admin.user)
    checkout(c, packages["basic"])
    r = checkout(c, packages["basic"])
    assert error(r) == (409, "checkout_in_progress")
    payment = PaymentRecord.objects.get()
    assert r.json()["payment"]["id"] == str(payment.id) and r.json()["message"]
    assert "redirect_url" in r.json() and r.json()["redirect_url"] is None
    assert payment.bkash_status == "Initiated" and payment.bkash_checkout_url == created()["bkashURL"]
    age(payment, minutes=11)
    fake_bkash.on("checkout/create", created(payment_id="TR0011second"))
    assert checkout(c, packages["basic"]).status_code == 201


@pytest.mark.parametrize("url", [
    "http://sandbox.payment.bkash.com/?paymentId=x",
    "https://evil.example/?paymentId=x",
    "https://bkash.com.evil.example/?paymentId=x",
    "https://user:pw@sandbox.payment.bkash.com/?paymentId=x",
])
def test_checkout_refuses_a_checkout_page_off_bkash(fake_bkash, admin, packages, url):
    fake_bkash.on("checkout/create", {**created(), "bkashURL": url})
    r = checkout(signed_in(admin.user), packages["basic"])
    assert error(r) == (502, "bkash_error")
    payment = PaymentRecord.objects.get()
    assert payment.status == Status.FAILED and "unexpected checkout address" in payment.failure_reason
    assert payment.bkash_checkout_url == ""


def test_bkash_checkout_hosts():
    from apps.billing.bkash import is_checkout_url
    assert is_checkout_url("https://sandbox.payment.bkash.com/?paymentId=TR1")
    assert is_checkout_url("https://tokenized.pay.bka.sh/?paymentId=TR1")
    assert not is_checkout_url("https://bkash.com.example.org/")
    assert not is_checkout_url("javascript:alert(1)")
    assert not is_checkout_url("")


def test_bkash_not_configured_is_503(no_bkash, admin, packages):
    r = checkout(signed_in(admin.user), packages["basic"])
    assert error(r) == (503, "bkash_unavailable")
    assert not PaymentRecord.objects.exists()


def test_bkash_refusing_create_fails_the_payment(fake_bkash, admin, packages):
    fake_bkash.on("checkout/create", {"statusCode": "2001", "statusMessage": "Invalid App Key"})
    r = checkout(signed_in(admin.user), packages["basic"])
    assert error(r) == (502, "bkash_error")
    payment = PaymentRecord.objects.get()
    assert payment.status == Status.FAILED and "Invalid App Key" in payment.failure_reason


def test_rejected_token_is_granted_again_once(fake_bkash, admin, packages):
    from tests.billing_support import FakeResponse
    fake_bkash.on("checkout/create", FakeResponse({"message": "Unauthorized"}, 401), created())
    assert checkout(signed_in(admin.user), packages["basic"]).status_code == 201
    assert [c["path"] for c in fake_bkash.calls].count("checkout/token/grant") == 2


# ---------------------------------------------------------------- reconciliation

def pending_bkash(fake_bkash, admin, packages, **ago):
    fake_bkash.on("checkout/create", created())
    checkout(signed_in(admin.user), packages["basic"])
    return age(PaymentRecord.objects.get(), **ago)


def test_reconcile_completes_a_completed_payment(fake_bkash, admin, packages):
    payment = pending_bkash(fake_bkash, admin, packages, minutes=11)
    fake_bkash.on("checkout/payment/status", status_of("Completed"))
    counts = billing.reconcile()
    payment.refresh_from_db()
    assert counts["completed"] == 1 and payment.status == Status.COMPLETED and payment.subscription_id
    assert billing.reconcile()["checked"] == 0


def test_reconcile_executes_when_verification_is_complete(fake_bkash, admin, packages):
    payment = pending_bkash(fake_bkash, admin, packages, minutes=30)
    fake_bkash.on("checkout/payment/status", status_of("Initiated", verification="Complete"))
    fake_bkash.on("checkout/execute", executed())
    billing.reconcile()
    payment.refresh_from_db()
    assert payment.status == Status.COMPLETED
    assert "checkout/execute" in fake_bkash.paths()


def test_reconcile_waits_then_gives_up_after_24_hours(fake_bkash, admin, packages):
    payment = pending_bkash(fake_bkash, admin, packages, hours=2)
    fake_bkash.on("checkout/payment/status", status_of("Initiated", verification="Incomplete"))
    assert billing.reconcile()["waiting"] == 1
    payment.refresh_from_db()
    assert payment.status == Status.PENDING
    age(payment, hours=25)
    assert billing.reconcile()["failed"] == 1
    payment.refresh_from_db()
    assert payment.status == Status.FAILED and "24 hours" in payment.failure_reason


def test_reconcile_leaves_recent_checkouts_alone(fake_bkash, admin, packages):
    pending_bkash(fake_bkash, admin, packages, minutes=3)
    assert billing.reconcile()["checked"] == 0
    assert fake_bkash.paths() == ["checkout/create"]


def test_reconcile_command_runs_one_pass(fake_bkash, admin, packages):
    from io import StringIO

    from django.core.management import call_command
    payment = pending_bkash(fake_bkash, admin, packages, minutes=11)
    fake_bkash.on("checkout/payment/status", status_of("Cancelled", verification="Incomplete"))
    out = StringIO()
    call_command("reconcile_bkash", stdout=out)
    payment.refresh_from_db()
    assert payment.status == Status.CANCELLED and "cancelled=1" in out.getvalue()


# ---------------------------------------------------------------- abandoning a pending bKash payment

def abandon(client, payment, slug="sau"):
    return portal(client, "post", f"payments/{payment.id}/abandon/", slug=slug)


def started(fake_bkash, admin, packages, package="basic"):
    fake_bkash.on("checkout/create", created())
    c = signed_in(admin.user)
    assert checkout(c, packages[package]).status_code == 201
    return c, PaymentRecord.objects.get()


def test_abandon_cancels_a_payment_awaiting_the_payer_and_a_new_checkout_starts_at_once(fake_bkash, admin, packages):
    c, payment = started(fake_bkash, admin, packages)
    fake_bkash.on("checkout/payment/status", status_of("Initiated", verification="Incomplete"))
    r = abandon(c, payment)
    assert r.status_code == 200, r.json()
    assert r.json()["result"] == "cancelled" and r.json()["payment"]["id"] == str(payment.id)
    assert r.json()["payment"]["status"] == "cancelled"
    assert r.json()["payment"]["failure_reason"] == "Abandoned by the institution admin"
    payment.refresh_from_db()
    assert (payment.status, payment.bkash_status) == (Status.CANCELLED, "Initiated")
    assert "checkout/execute" not in fake_bkash.paths()
    entry = AuditLog.objects.get(action="payment.abandoned", target_id=str(payment.id))
    assert entry.actor == admin.user and entry.metadata["source"] == "portal"
    assert not AuditLog.objects.filter(action="payment.cancelled", target_id=str(payment.id)).exists()

    fake_bkash.on("checkout/create", created(payment_id="TR0011second"))
    again = checkout(c, packages["basic"])
    assert again.status_code == 201, again.json()
    assert PaymentRecord.objects.filter(status=Status.PENDING).count() == 1


def test_abandon_completes_a_payment_bkash_says_is_paid(fake_bkash, admin, packages):
    c, payment = started(fake_bkash, admin, packages)
    fake_bkash.on("checkout/payment/status", status_of("Completed"))
    r = abandon(c, payment)
    assert r.status_code == 200, r.json()
    assert r.json()["result"] == "completed" and r.json()["payment"]["status"] == "completed"
    payment.refresh_from_db()
    assert payment.status == Status.COMPLETED and payment.receipt_number.startswith("BDR-")
    assert (payment.bkash_trx_id, payment.bkash_payer_account) == (TRX_ID, "********378")
    assert payment.subscription.package_version.package_id == packages["basic"].pk
    assert AuditLog.objects.filter(action="payment.completed", target_id=str(payment.id)).count() == 1
    assert not AuditLog.objects.filter(action="payment.abandoned").exists()
    assert "checkout/execute" not in fake_bkash.paths()


def test_abandon_executes_a_payment_the_payer_approved(fake_bkash, admin, packages):
    c, payment = started(fake_bkash, admin, packages)
    fake_bkash.on("checkout/payment/status", status_of("Initiated", verification="Complete"))
    fake_bkash.on("checkout/execute", executed())
    r = abandon(c, payment)
    assert r.status_code == 200 and r.json()["result"] == "completed"
    payment.refresh_from_db()
    assert payment.status == Status.COMPLETED and payment.bkash_trx_id == TRX_ID and payment.subscription_id
    assert fake_bkash.paths().count("checkout/execute") == 1


def test_abandon_leaves_an_approved_payment_pending_when_execute_fails(fake_bkash, admin, packages):
    c, payment = started(fake_bkash, admin, packages)
    fake_bkash.on("checkout/payment/status", status_of("Initiated", verification="Complete"))
    fake_bkash.on("checkout/execute", network_error())
    r = abandon(c, payment)
    assert error(r) == (409, "payment_confirming") and r.json()["message"]
    payment.refresh_from_db()
    assert payment.status == Status.PENDING and payment.failure_reason == "" and payment.receipt_number is None
    assert not AuditLog.objects.filter(action__in=["payment.abandoned", "payment.failed"]).exists()

    age(payment, minutes=11)
    fake_bkash.on("checkout/execute", executed())
    assert billing.reconcile()["completed"] == 1
    payment.refresh_from_db()
    assert payment.status == Status.COMPLETED


def test_abandon_changes_nothing_when_bkash_is_unreachable(fake_bkash, admin, packages):
    c, payment = started(fake_bkash, admin, packages)
    fake_bkash.on("checkout/payment/status", network_error())
    r = abandon(c, payment)
    assert error(r) == (502, "bkash_error")
    payment.refresh_from_db()
    assert (payment.status, payment.failure_reason, payment.bkash_status) == (Status.PENDING, "", "Initiated")
    assert not AuditLog.objects.filter(action="payment.abandoned").exists()


@pytest.mark.parametrize(("bkash_state", "status", "result"), [
    ("Cancelled", Status.CANCELLED, "cancelled"), ("Failed", Status.FAILED, "failed"),
    ("Expired", Status.FAILED, "failed"),
])
def test_abandon_follows_a_final_bkash_state(fake_bkash, admin, packages, bkash_state, status, result):
    c, payment = started(fake_bkash, admin, packages)
    fake_bkash.on("checkout/payment/status", status_of(bkash_state, verification="Incomplete"))
    r = abandon(c, payment)
    assert r.status_code == 200 and r.json()["result"] == result
    payment.refresh_from_db()
    assert (payment.status, payment.bkash_status) == (status, bkash_state)
    assert payment.failure_reason != "Abandoned by the institution admin"


def test_abandon_twice_is_not_pending(fake_bkash, admin, packages):
    c, payment = started(fake_bkash, admin, packages)
    fake_bkash.on("checkout/payment/status", status_of("Initiated", verification="Incomplete"))
    assert abandon(c, payment).status_code == 200
    assert error(abandon(c, payment)) == (409, "not_pending")
    assert AuditLog.objects.filter(action="payment.abandoned").count() == 1


def test_abandon_is_only_for_pending_bkash_payments(fake_bkash, boss, admin, packages):
    c, payment = started(fake_bkash, admin, packages)
    fake_bkash.on("checkout/execute", executed())
    callback(Client())
    payment.refresh_from_db()
    assert payment.status == Status.COMPLETED
    assert error(abandon(c, payment)) == (409, "not_pending")

    r = superadmin(signed_in(boss), "post", "billing/payments/manual/",
                   manual_body(packages["mind"], amount="2000.00", pending=True))
    assert r.status_code == 201, r.json()
    manual = PaymentRecord.objects.get(pk=r.json()["id"])
    assert manual.status == Status.PENDING
    assert error(abandon(c, manual)) == (409, "not_pending")
    assert error(superadmin(signed_in(boss), "post", f"billing/payments/{manual.id}/abandon/")) == (409, "not_pending")
    manual.refresh_from_db()
    assert manual.status == Status.PENDING


def test_abandon_permissions(fake_bkash, admin, member, other_org, packages):
    c, payment = started(fake_bkash, admin, packages)
    fake_bkash.on("checkout/payment/status", status_of("Initiated", verification="Incomplete"))
    assert error(abandon(Client(), payment)) == (401, "not_authenticated")
    assert error(abandon(signed_in(member.user), payment)) == (403, "not_institution_admin")
    outsider = signed_in(other_org.memberships.get().user)
    assert error(abandon(outsider, payment)) == (404, "not_found")
    assert error(abandon(outsider, payment, slug="buet")) == (404, "not_found")
    payment.refresh_from_db()
    assert payment.status == Status.PENDING
    assert "checkout/payment/status" not in fake_bkash.paths()


def test_superadmin_abandons_any_institutions_payment(fake_bkash, boss, admin, packages):
    _, payment = started(fake_bkash, admin, packages)
    fake_bkash.on("checkout/payment/status", status_of("Initiated", verification="Incomplete"))
    r = superadmin(signed_in(boss), "post", f"billing/payments/{payment.id}/abandon/")
    assert r.status_code == 200, r.json()
    assert r.json()["result"] == "cancelled" and r.json()["payment"]["status"] == "cancelled"
    assert r.json()["payment"]["recorded_by"]["email"] == "admin@sau.ac.bd"
    entry = AuditLog.objects.get(action="payment.abandoned", target_id=str(payment.id))
    assert entry.actor == boss and entry.metadata["source"] == "superadmin"
    assert error(superadmin(signed_in(admin.user), "post", f"billing/payments/{payment.id}/abandon/")) == (
        403, "not_superadmin")


def test_a_payment_paid_after_it_was_abandoned_is_completed_once(fake_bkash, admin, packages):
    """Rule: abandoning only cancels locally. If bKash later says the payer paid (the callback arrives, or
    reconcile finds it), the customer's money is recorded: the payment is completed, exactly once."""
    c, payment = started(fake_bkash, admin, packages)
    fake_bkash.on("checkout/payment/status", status_of("Initiated", verification="Incomplete"))
    abandon(c, payment)

    fake_bkash.on("checkout/payment/status", status_of("Initiated", verification="Complete"))
    fake_bkash.on("checkout/execute", executed())
    r = callback(Client())
    payment.refresh_from_db()
    assert payment.status == Status.COMPLETED and payment.receipt_number and payment.failure_reason == ""
    assert payment.bkash_trx_id == TRX_ID and payment.subscription_id
    assert r["Location"].endswith("result=success")

    fake_bkash.on("checkout/payment/status", status_of("Completed"))
    callback(Client())
    billing.reconcile()
    assert fake_bkash.paths().count("checkout/execute") == 1
    assert AuditLog.objects.filter(action="payment.completed", target_id=str(payment.id)).count() == 1
    assert Subscription.objects.count() == 1


def test_an_abandoned_payment_stays_cancelled_unless_bkash_says_paid(fake_bkash, admin, packages):
    c, payment = started(fake_bkash, admin, packages)
    fake_bkash.on("checkout/payment/status", status_of("Initiated", verification="Incomplete"))
    abandon(c, payment)
    assert callback(Client())["Location"].endswith("result=cancelled")
    assert callback(Client(), "cancel")["Location"].endswith("result=cancelled")
    payment.refresh_from_db()
    assert (payment.status, payment.failure_reason) == (Status.CANCELLED, "Abandoned by the institution admin")
    assert "checkout/execute" not in fake_bkash.paths()

    fake_bkash.on("checkout/payment/status", status_of("Failed", verification="Incomplete"))
    age(payment, minutes=11)
    assert billing.reconcile()["rechecked"] == 1
    payment.refresh_from_db()
    assert (payment.status, payment.bkash_status) == (Status.CANCELLED, "Failed")
    assert billing.reconcile().get("rechecked") is None


def abandon_then_buy(fake_bkash, admin, packages, package="standard", amount="3000"):
    """Abandons a Basic checkout (A), then starts and pays a checkout for `package` (B). Returns (A, B)."""
    c, first = started(fake_bkash, admin, packages)
    fake_bkash.on("checkout/payment/status", status_of("Initiated", verification="Incomplete"))
    assert abandon(c, first).status_code == 200
    fake_bkash.on("checkout/create", created(amount=amount, payment_id="TR0011second"))
    assert checkout(c, packages[package]).status_code == 201
    second = PaymentRecord.objects.get(bkash_payment_id="TR0011second")
    fake_bkash.on("checkout/execute", executed(amount=amount, payment_id="TR0011second", trx_id="TRXSECOND1"))
    callback(Client(), payment_id="TR0011second")
    second.refresh_from_db()
    assert second.status == Status.COMPLETED and second.subscription.status == Subscription.Status.ACTIVE
    return first, second


@pytest.mark.parametrize("via", ["callback", "reconcile"])
def test_an_abandoned_payment_paid_after_a_newer_purchase_records_money_but_keeps_that_purchase(
        fake_bkash, admin, packages, via):
    first, second = abandon_then_buy(fake_bkash, admin, packages)
    fake_bkash.on("checkout/payment/status", status_of("Completed"))
    if via == "callback":
        assert callback(Client())["Location"].endswith("result=success")
    else:
        age(first, minutes=11)
        assert billing.reconcile()["rechecked"] == 1
    first.refresh_from_db()
    second.refresh_from_db()
    assert first.status == Status.COMPLETED and first.bkash_trx_id == TRX_ID and first.receipt_number
    assert first.subscription_id is None and first.notes == billing.NOT_APPLIED_NOTE
    assert first.applied is False and second.applied is True
    shown = billing_shapes.payment(billing.load_payment(first.pk), portal=True)
    assert (shown["applied"], shown["subscription_id"]) == (False, None)
    assert second.subscription.status == Subscription.Status.ACTIVE
    assert second.subscription.package_version.package_id == packages["standard"].pk
    assert Subscription.objects.count() == 1
    entry = AuditLog.objects.get(action="payment.completed", target_id=str(first.id))
    assert entry.metadata["not_applied"] is True and "subscription_id" not in entry.metadata


def test_an_abandoned_payment_for_other_apps_is_applied_when_paid_late(fake_bkash, admin, packages):
    first, second = abandon_then_buy(fake_bkash, admin, packages, package="mind", amount="2000")
    fake_bkash.on("checkout/payment/status", status_of("Completed"))
    callback(Client())
    first.refresh_from_db()
    second.refresh_from_db()
    assert first.status == Status.COMPLETED and first.subscription.package_version.package_id == packages["basic"].pk
    assert first.notes == "" and second.subscription.status == Subscription.Status.ACTIVE
    assert first.applied is True


def test_abandon_while_bkash_creates_the_payment_hands_out_no_checkout_url(fake_bkash, monkeypatch, admin, packages):
    real_create = billing.bkash.create_payment

    def abandoned_meanwhile(**kwargs):
        billing.abandon(PaymentRecord.objects.get().pk, actor=admin.user, source="portal")
        return real_create(**kwargs)

    monkeypatch.setattr(billing.bkash, "create_payment", abandoned_meanwhile)
    fake_bkash.on("checkout/create", created())
    r = checkout(signed_in(admin.user), packages["basic"])
    assert r.status_code == 201, r.json()
    assert r.json()["redirect_url"] is None and r.json()["payment"]["status"] == "cancelled"
    payment = PaymentRecord.objects.get()
    assert (payment.bkash_payment_id, payment.bkash_status) == (PAYMENT_ID, "Initiated")
    assert payment.failure_reason == "Abandoned by the institution admin"

    fake_bkash.on("checkout/payment/status", status_of("Completed"))
    callback(Client())
    payment.refresh_from_db()
    assert payment.status == Status.COMPLETED and payment.bkash_trx_id == TRX_ID


def test_reconcile_records_money_for_an_abandoned_payment(fake_bkash, admin, packages):
    c, payment = started(fake_bkash, admin, packages)
    fake_bkash.on("checkout/payment/status", status_of("Initiated", verification="Incomplete"))
    abandon(c, payment)
    age(payment, minutes=11)
    fake_bkash.on("checkout/payment/status", status_of("Completed"))
    counts = billing.reconcile()
    assert (counts["checked"], counts["rechecked"], counts["completed"]) == (0, 1, 1)
    payment.refresh_from_db()
    assert payment.status == Status.COMPLETED and payment.receipt_number and payment.bkash_trx_id == TRX_ID
    age(payment, hours=25)
    assert billing.reconcile().get("rechecked") is None
