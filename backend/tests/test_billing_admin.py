"""Superadmin billing API: manual payments, verification, refunds (manual and through bKash), receipts,
attachments, lists, summary, subscriptions and permissions (docs/BILLING_API.md "Superadmin API")."""
from datetime import timedelta
from decimal import Decimal

import pytest
from django.db import connection
from django.test import Client
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from apps.audit.models import AuditLog
from apps.billing.models import PaymentRecord, Refund
from apps.subscriptions.models import Subscription
from apps.subscriptions.services import stop_renewal
from tests.billing_support import (  # noqa: F401  (fixtures)
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
    manual_body,
    member,
    no_bkash,
    org,
    other_org,
    owner,
    packages,
    portal,
    refunded,
    signed_in,
    subscribe,
    superadmin,
)
from tests.factories import make_org

pytestmark = pytest.mark.django_db

Status = PaymentRecord.Status
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
PDF = b"%PDF-1.7\n" + b"0" * 64


@pytest.fixture
def staff(boss, org, no_bkash):
    return signed_in(boss)


def record(c, package, **over):
    r = superadmin(c, "post", "billing/payments/manual/", manual_body(package, **over))
    assert r.status_code == 201, r.json()
    return r.json()


# ---------------------------------------------------------------- manual payments

def test_manual_payment_completes_and_applies_the_quote(staff, boss, org, account, packages):
    body = record(staff, packages["basic"])
    assert (body["status"], body["method"], body["kind"], body["amount"]) == ("completed", "bank_transfer", "new",
                                                                              "1000.00")
    assert body["institution"] == {"slug": "sau", "name": "Sylhet Agricultural University"}
    assert body["package"]["name"] == "Basic" and body["package_version"] == 1
    assert body["recorded_by"]["email"] == "boss@bdren.ai" and body["verified_by"]["email"] == "boss@bdren.ai"
    assert body["receipt_number"].startswith("BDR-") and body["payment_date"] == "2026-11-18"
    sub = Subscription.objects.get()
    assert sub.account_id == account.pk and sub.status == Subscription.Status.ACTIVE
    payment = PaymentRecord.objects.get()
    assert payment.subscription_id == sub.pk
    audit = AuditLog.objects.get(action="payment.recorded")
    assert audit.metadata["organization_id"] == str(org.id) and audit.actor == boss


def test_manual_payment_with_a_start_date_and_periods(staff, packages):
    body = record(staff, packages["basic"], periods=2, amount="2000.00", period_start="2026-12-01")
    assert body["periods"] == 2 and body["period_start"].startswith("2026-11-30T18:00:00")
    sub = Subscription.objects.get()
    assert (sub.expires_at - sub.starts_at) == timedelta(days=60)


def test_amount_differing_from_the_quote_needs_notes(staff, packages):
    r = superadmin(staff, "post", "billing/payments/manual/", manual_body(packages["basic"], amount="900.00"))
    assert error(r) == (400, "invalid") and "notes" in r.json()["fields"]
    assert not PaymentRecord.objects.exists()
    body = record(staff, packages["basic"], amount="900.00", notes="Discount agreed by BdREN")
    assert body["amount"] == "900.00" and body["status"] == "completed"


def test_manual_payment_validation(staff, packages):
    basic = packages["basic"]
    cases = [
        (manual_body(basic, kind="later"), (400, "invalid")),
        (manual_body(basic, method="bkash"), (400, "invalid")),
        (manual_body(basic, amount="-5"), (400, "invalid")),
        (manual_body(basic, periods=0), (400, "invalid")),
        (manual_body(basic, institution="nowhere"), (404, "not_found")),
        ({**manual_body(basic), "package": "8b8f6c1e-55a6-4d0b-9a49-1f0d2d0e8a11"}, (404, "not_found")),
        (manual_body(packages["free"], amount="1.00", notes="x"), (400, "free_package")),
        (manual_body(basic, kind="renew"), (400, "package_not_offered")),
    ]
    for body, expected in cases:
        assert error(superadmin(staff, "post", "billing/payments/manual/", body)) == expected, body
    assert not PaymentRecord.objects.exists()


def test_pending_manual_payment_is_verified_once(staff, packages):
    body = record(staff, packages["basic"], pending=True)
    assert body["status"] == "pending" and body["receipt_number"] is None and not Subscription.objects.exists()
    r = superadmin(staff, "post", f"billing/payments/{body['id']}/verify/", {})
    assert r.status_code == 200 and r.json()["status"] == "completed" and r.json()["receipt_number"]
    assert Subscription.objects.count() == 1
    assert error(superadmin(staff, "post", f"billing/payments/{body['id']}/verify/", {})) == (409, "not_pending")
    assert error(superadmin(staff, "post", f"billing/payments/{body['id']}/reject/", {"reason": "x"})) == (
        409, "not_pending")


def test_pending_manual_payment_can_be_rejected(staff, packages):
    body = record(staff, packages["basic"], pending=True)
    path = f"billing/payments/{body['id']}/reject/"
    assert error(superadmin(staff, "post", path, {})) == (400, "invalid")
    r = superadmin(staff, "post", path, {"reason": "Slip does not match the bank statement"})
    assert r.json()["status"] == "rejected" and r.json()["failure_reason"].startswith("Slip")
    assert not Subscription.objects.exists()


def test_bkash_payments_cannot_be_verified(fake_bkash, boss, admin, packages):
    fake_bkash.on("checkout/create", created())
    portal(signed_in(admin.user), "post", "checkout/", {"package": str(packages["basic"].id), "kind": "new"})
    payment = PaymentRecord.objects.get()
    assert error(superadmin(signed_in(boss), "post", f"billing/payments/{payment.id}/verify/", {})) == (
        409, "not_pending")


def test_unknown_payment_is_404(staff):
    pk = "8b8f6c1e-55a6-4d0b-9a49-1f0d2d0e8a11"
    for path in ("", "verify/", "reject/", "refund/", "attachment/", "receipt/"):
        method = "get" if path in ("", "attachment/", "receipt/") else "post"
        assert error(superadmin(staff, method, f"billing/payments/{pk}/{path}", {})) == (404, "not_found"), path


# ---------------------------------------------------------------- refunds

def refund(c, pk, amount, **over):
    return superadmin(c, "post", f"billing/payments/{pk}/refund/",
                      {"amount": amount, "reason": "Paid twice", "end_subscription": False, **over})


def test_manual_refunds_partial_then_full(staff, packages):
    body = record(staff, packages["basic"])
    r = refund(staff, body["id"], "400.00")
    assert r.status_code == 200 and (r.json()["status"], r.json()["refunded_amount"]) == (
        "partially_refunded", "400.00")
    assert r.json()["refunds"][0]["method"] == "manual" and r.json()["refunds"][0]["created_by"]["email"]
    assert error(refund(staff, body["id"], "600.01")) == (409, "refund_exceeds_payment")
    r = refund(staff, body["id"], "600.00")
    assert (r.json()["status"], r.json()["refunded_amount"]) == ("refunded", "1000.00")
    assert error(refund(staff, body["id"], "1.00")) == (409, "not_refundable")
    assert Subscription.objects.get().status == Subscription.Status.ACTIVE


def test_refund_needs_a_completed_payment_and_a_reason(staff, packages):
    body = record(staff, packages["basic"], pending=True)
    assert error(refund(staff, body["id"], "100.00")) == (409, "not_refundable")
    done = record(staff, packages["mind"], amount="2000.00")
    assert error(refund(staff, done["id"], "100.00", reason="")) == (400, "invalid")
    assert error(refund(staff, done["id"], "abc")) == (400, "invalid")


def test_refund_can_end_the_subscription(staff, packages):
    body = record(staff, packages["basic"])
    r = refund(staff, body["id"], "1000.00", end_subscription=True)
    assert r.json()["status"] == "refunded"
    sub = Subscription.objects.get()
    assert sub.status == Subscription.Status.CANCELLED and sub.expires_at <= timezone.now()


def bkash_completed(fake_bkash, admin, packages):
    fake_bkash.on("checkout/create", created()).on("checkout/execute", executed())
    portal(signed_in(admin.user), "post", "checkout/", {"package": str(packages["basic"].id), "kind": "new"})
    Client().get(CALLBACK, {"paymentID": PAYMENT_ID, "status": "success"})
    payment = PaymentRecord.objects.get()
    assert payment.status == Status.COMPLETED
    return payment


def test_bkash_refund_goes_through_bkash(fake_bkash, boss, admin, packages):
    payment = bkash_completed(fake_bkash, admin, packages)
    fake_bkash.on("checkout/payment/refund", refunded("500"))
    r = refund(signed_in(boss), payment.id, "500.00")
    assert r.status_code == 200 and r.json()["status"] == "partially_refunded"
    row = r.json()["refunds"][0]
    assert (row["method"], row["status"], row["bkash_refund_trx_id"]) == ("bkash", "completed", "DKI10PX9AB")
    assert fake_bkash.bodies("checkout/payment/refund") == [{
        "paymentID": PAYMENT_ID, "amount": "500.00", "trxID": TRX_ID, "sku": payment.receipt_number,
        "reason": "Paid twice",
    }]


def test_bkash_refund_error_records_nothing_completed(fake_bkash, boss, admin, packages):
    payment = bkash_completed(fake_bkash, admin, packages)
    fake_bkash.on("checkout/payment/refund", {"statusCode": "2071", "statusMessage": "Refund not allowed"})
    r = refund(signed_in(boss), payment.id, "500.00", end_subscription=True)
    assert error(r) == (502, "bkash_error")
    payment.refresh_from_db()
    assert payment.status == Status.COMPLETED and payment.refunded_amount == Decimal("0")
    assert not Refund.objects.filter(status=Refund.Status.COMPLETED).exists()
    assert Refund.objects.get().status == Refund.Status.FAILED
    assert Subscription.objects.get().status == Subscription.Status.ACTIVE


# ---------------------------------------------------------------- receipts

def test_receipt_numbers_are_sequential_and_unique(staff, packages):
    first = record(staff, packages["basic"])
    second = record(staff, packages["mind"], amount="2000.00")
    year = first["receipt_number"].split("-")[1]
    assert first["receipt_number"] == f"BDR-{year}-000001"
    assert second["receipt_number"] == f"BDR-{year}-000002"


def test_receipt_is_html_for_completed_payments_only(staff, packages):
    done = record(staff, packages["basic"])
    r = superadmin(staff, "get", f"billing/payments/{done['id']}/receipt/")
    assert r.status_code == 200 and r["Content-Type"].startswith("text/html")
    html = r.content.decode()
    assert done["receipt_number"] in html and "Sylhet Agricultural University" in html and "1,000.00" in html
    pending = record(staff, packages["mind"], amount="2000.00", pending=True)
    assert error(superadmin(staff, "get", f"billing/payments/{pending['id']}/receipt/")) == (
        409, "receipt_unavailable")


# ---------------------------------------------------------------- attachments

def upload(c, pk, content, name="slip.png"):
    from django.core.files.uploadedfile import SimpleUploadedFile
    return c.post(f"/api/v1/superadmin/billing/payments/{pk}/attachment/",
                  {"file": SimpleUploadedFile(name, content, content_type="application/octet-stream")})


def test_attachment_upload_and_download(staff, packages):
    body = record(staff, packages["basic"], pending=True)
    r = upload(staff, body["id"], PNG, 'bank "slip".png')
    assert r.status_code == 200 and r.json()["has_attachment"] is True
    got = superadmin(staff, "get", f"billing/payments/{body['id']}/attachment/")
    assert got.status_code == 200 and got.content == PNG and got["Content-Type"] == "image/png"
    assert got["Content-Disposition"] == 'attachment; filename="bank slip.png"'
    assert upload(staff, body["id"], PDF, "slip.pdf").status_code == 200
    assert superadmin(staff, "get", f"billing/payments/{body['id']}/attachment/")["Content-Type"] == "application/pdf"


def test_attachment_type_and_size_are_checked(staff, packages, monkeypatch):
    from apps.billing import services as billing
    body = record(staff, packages["basic"], pending=True)
    assert error(upload(staff, body["id"], b"MZ\x90\x00 not a slip", "slip.png")) == (400, "invalid")
    monkeypatch.setattr(billing, "MAX_ATTACHMENT_BYTES", 32)
    assert error(upload(staff, body["id"], PNG, "slip.png")) == (400, "invalid")
    assert error(staff.post(f"/api/v1/superadmin/billing/payments/{body['id']}/attachment/", {})) == (400, "invalid")
    assert not PaymentRecord.objects.get().has_attachment
    assert error(superadmin(staff, "get", f"billing/payments/{body['id']}/attachment/")) == (404, "not_found")


def test_attachment_and_receipt_in_the_portal_are_own_institution_only(staff, admin, member, other_org, packages):
    body = record(staff, packages["basic"])
    upload(staff, body["id"], PNG)
    mine = signed_in(admin.user)
    assert portal(mine, "get", f"payments/{body['id']}/attachment/").content == PNG
    receipt = portal(mine, "get", f"payments/{body['id']}/receipt/")
    assert receipt.status_code == 200 and body["receipt_number"] in receipt.content.decode()
    assert error(portal(signed_in(member.user), "get", f"payments/{body['id']}/attachment/")) == (
        403, "not_institution_admin")
    chief = other_org.memberships.get().user
    assert error(portal(signed_in(chief), "get", f"payments/{body['id']}/attachment/", slug="buet")) == (
        404, "not_found")
    assert error(portal(signed_in(chief), "get", f"payments/{body['id']}/receipt/", slug="buet")) == (
        404, "not_found")
    assert error(portal(signed_in(chief), "get", f"payments/{body['id']}/receipt/")) == (404, "not_found")


# ---------------------------------------------------------------- lists and summary

def test_payment_list_filters_and_tabs(staff, fake_bkash, admin, packages):
    fake_bkash.on("checkout/create", created())
    portal(signed_in(admin.user), "post", "checkout/", {"package": str(packages["basic"].id), "kind": "new"})
    stale = age(PaymentRecord.objects.get(), minutes=15)
    manual = record(staff, packages["mind"], amount="2000.00", reference="CHQ-7781", payer_name="Bursar")
    waiting = record(staff, packages["suite"], amount="4500.00", pending=True, kind="upgrade",
                     method="cheque", reference="CHQ-1")

    def ids(**query):
        r = superadmin(staff, "get", "billing/payments/", query)
        assert r.status_code == 200, r.json()
        return {row["id"] for row in r.json()["results"]}

    assert ids() == {str(stale.id), manual["id"], waiting["id"]}
    assert ids(tab="bkash") == ids(method="bkash") == {str(stale.id)}
    assert ids(tab="manual") == {manual["id"], waiting["id"]}
    assert ids(tab="attention") == {str(stale.id), waiting["id"]}
    assert ids(status="completed") == {manual["id"]}
    assert ids(q="7781") == ids(q="bursar") == {manual["id"]}
    assert ids(q=manual["receipt_number"]) == {manual["id"]}
    assert ids(package=str(packages["suite"].id)) == {waiting["id"]}
    assert ids(institution="sau") == ids()
    assert ids(institution="buet") == set()
    assert ids(**{"from": "2001-01-01", "to": "2001-01-02"}) == set()
    assert error(superadmin(staff, "get", "billing/payments/", {"tab": "later"})) == (400, "invalid")
    assert error(superadmin(staff, "get", "billing/payments/", {"status": "x"})) == (400, "invalid")
    page = superadmin(staff, "get", "billing/payments/", {"page_size": 2, "page": 2}).json()
    assert (page["count"], page["page"], len(page["results"])) == (3, 2, 1)
    detail = superadmin(staff, "get", f"billing/payments/{stale.id}/").json()
    assert detail["bkash"] == {"payment_id": PAYMENT_ID, "trx_id": None, "payer_account": None, "status": "Initiated"}


def test_payment_list_query_count_is_constant(staff, packages):
    def queries():
        with CaptureQueriesContext(connection) as ctx:
            assert superadmin(staff, "get", "billing/payments/").status_code == 200
        return len(ctx.captured_queries)

    first = record(staff, packages["basic"])
    refund(staff, first["id"], "100.00")
    few = queries()
    for n in range(4):
        org = make_org(f"inst{n}", name=f"Institution {n}")
        body = record(staff, packages["suite"], institution=org.slug, amount="4500.00")
        refund(staff, body["id"], "10.00")
        refund(staff, body["id"], "10.00")
    assert queries() == few


def test_summary_counts_net_amounts(staff, packages):
    first = record(staff, packages["basic"])
    record(staff, packages["mind"], amount="2000.00")
    record(staff, packages["suite"], amount="4500.00", pending=True, kind="upgrade")
    refund(staff, first["id"], "250.00")
    body = superadmin(staff, "get", "billing/summary/").json()
    assert (body["collected"], body["manual"], body["bkash"], body["refunds"]) == (
        "2750.00", "2750.00", "0.00", "250.00")
    assert (body["pending"], body["failed"], body["bkash_mode"]) == (1, 0, "off")
    assert body["previous"]["collected"] == "0.00"


def test_summary_shows_the_bkash_mode(boss, fake_bkash):
    assert superadmin(signed_in(boss), "get", "billing/summary/").json()["bkash_mode"] == "sandbox"


def test_quote_preview(staff, account, packages):
    sub = subscribe(account, packages["basic"], days_left=5)
    r = superadmin(staff, "get", "billing/quote/",
                   {"institution": "sau", "package": str(packages["basic"].id), "kind": "renew", "periods": "2"})
    body = r.json()
    assert r.status_code == 200 and (body["amount"], body["periods"], body["kind"]) == ("2000.00", 2, "renew")
    assert body["subscription_id"] == str(sub.id) and body["package"]["name"] == "Basic"
    r = superadmin(staff, "get", "billing/quote/", {"institution": "sau", "package": str(packages["basic"].id),
                                                     "kind": "new"})
    assert error(r) == (400, "package_not_offered")


# ---------------------------------------------------------------- subscriptions

def test_subscription_list_and_actions(staff, account, packages):
    soon = subscribe(account, packages["basic"], days_left=10)
    other = make_org("cu", name="CU")
    later = subscribe(other.account, packages["suite"], days_left=200)
    stop_renewal(subscription=later)

    def ids(**query):
        r = superadmin(staff, "get", "billing/subscriptions/", query)
        assert r.status_code == 200, r.json()
        return [row["id"] for row in r.json()["results"]]

    assert ids() == [str(soon.id), str(later.id)]
    assert ids(expiring_within=30) == [str(soon.id)]
    assert ids(auto_renew="false") == [str(later.id)]
    assert ids(institution="cu") == [str(later.id)]
    assert ids(package=str(packages["suite"].id)) == [str(later.id)]
    assert ids(status="cancelled") == []
    row = superadmin(staff, "get", "billing/subscriptions/", {"institution": "cu"}).json()["results"][0]
    assert row["package"]["kind"] == "bundle" and [a["slug"] for a in row["apps"]] == ["synapse", "mindspear"]
    assert row["institution"] == {"slug": "cu", "name": "CU"} and row["last_payment"] is None

    base = f"billing/subscriptions/{soon.id}/"
    assert error(superadmin(staff, "post", base + "cancel-scheduled-change/")) == (409, "no_scheduled_change")
    soon.pending_package_version = packages["free"].versions.get()
    soon.save()
    assert ids(scheduled="1") == [str(soon.id)]
    r = superadmin(staff, "post", base + "cancel-scheduled-change/")
    assert r.status_code == 200 and r.json()["scheduled_package"] is None
    assert superadmin(staff, "post", base + "stop-renewal/").json()["auto_renew"] is False
    assert superadmin(staff, "post", base + "resume-renewal/").json()["auto_renew"] is True
    assert error(superadmin(staff, "post", "billing/subscriptions/8b8f6c1e-55a6-4d0b-9a49-1f0d2d0e8a11/stop-renewal/")) \
        == (404, "not_found")


def test_institution_billing(staff, packages):
    body = record(staff, packages["basic"])
    r = superadmin(staff, "get", "institutions/sau/billing/")
    assert r.status_code == 200
    data = r.json()
    assert [p["id"] for p in data["payments"]] == [body["id"]]
    assert data["subscriptions"][0]["last_payment"]["id"] == body["id"]
    assert error(superadmin(staff, "get", "institutions/nowhere/billing/")) == (404, "not_found")


# ---------------------------------------------------------------- permissions

SUPERADMIN_ENDPOINTS = [
    ("get", "billing/summary/"), ("get", "billing/payments/"), ("get", "billing/payments/{pk}/"),
    ("post", "billing/payments/manual/"), ("post", "billing/payments/{pk}/verify/"),
    ("post", "billing/payments/{pk}/reject/"), ("post", "billing/payments/{pk}/refund/"),
    ("post", "billing/payments/{pk}/attachment/"), ("get", "billing/payments/{pk}/attachment/"),
    ("get", "billing/payments/{pk}/receipt/"), ("get", "billing/quote/"), ("get", "billing/subscriptions/"),
    ("post", "billing/subscriptions/{pk}/cancel-scheduled-change/"),
    ("post", "billing/subscriptions/{pk}/stop-renewal/"), ("post", "billing/subscriptions/{pk}/resume-renewal/"),
    ("get", "institutions/sau/billing/"),
]


def test_superadmin_billing_needs_a_superadmin(org, admin, packages, no_bkash):
    pk = "8b8f6c1e-55a6-4d0b-9a49-1f0d2d0e8a11"
    anonymous, normal = Client(), signed_in(admin.user)
    for method, path in SUPERADMIN_ENDPOINTS:
        path = path.format(pk=pk)
        assert error(superadmin(anonymous, method, path)) == (401, "not_authenticated"), path
        assert error(superadmin(normal, method, path)) == (403, "not_superadmin"), path

