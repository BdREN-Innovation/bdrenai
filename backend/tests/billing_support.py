"""Shared fixtures and a fake bKash for the billing tests.

bKash is replaced only at the HTTP boundary (`requests.post` as `apps.billing.bkash` uses it), with answers shaped
like the sandbox's (docs/BILLING_API.md, verified 2026-11-18). Everything else (quotes, subscriptions, receipts,
audit, emails) runs for real against the test database.
"""
import json
from collections import defaultdict
from datetime import timedelta

import pytest
import requests
from django.core.cache import cache
from django.test import Client
from django.utils import timezone

from apps.administration.models import PlatformRoleAssignment
from apps.billing import bkash
from apps.billing import services as billing
from apps.billing.models import PaymentRecord
from apps.organizations.models import Membership
from apps.packages.models import Package
from apps.packages.services import create_package_with_version
from apps.products.models import Product
from apps.subscriptions.services import create_subscription
from tests.factories import add_member, make_org, make_user

PAYMENT_ID = "TR0011wEp5MBG1794997089896"
TRX_ID = "DKI20PX90K"
PAYER = "01770618378"
BKASH_URL = f"https://sandbox.payment.bkash.com/?paymentId={PAYMENT_ID}&hash=abc!!def&mode=0011"
PORTAL = "/api/v1/portal/institutions/"
SUPERADMIN = "/api/v1/superadmin/"
CALLBACK = "/api/v1/payments/bkash/callback/"


# ---------------------------------------------------------------- sandbox-shaped answers

def token_granted():
    return {"statusCode": "0000", "statusMessage": "Successful", "id_token": "eyJraWQiOiJvTVJzNU9ZY0wrUnRXCI",
            "token_type": "Bearer", "expires_in": 3600, "refresh_token": "eyJjdHkiOiJKV1QiLCJlbmMiOiJBMjU2R0NN"}


def created(amount="1000.00", payment_id=PAYMENT_ID):
    return {
        "statusCode": "0000", "statusMessage": "Successful", "paymentID": payment_id,
        "bkashURL": BKASH_URL.replace(PAYMENT_ID, payment_id),
        "callbackURL": "http://api.bdren.localhost:8080/api/v1/payments/bkash/callback/",
        "successCallbackURL": f"http://api.bdren.localhost:8080/api/v1/payments/bkash/callback/?paymentID={payment_id}&status=success",
        "failureCallbackURL": f"http://api.bdren.localhost:8080/api/v1/payments/bkash/callback/?paymentID={payment_id}&status=failure",
        "cancelledCallbackURL": f"http://api.bdren.localhost:8080/api/v1/payments/bkash/callback/?paymentID={payment_id}&status=cancel",
        "amount": str(amount), "intent": "sale", "currency": "BDT",
        "paymentCreateTime": "2026-11-18T12:31:29:897 GMT+0600", "transactionStatus": "Initiated",
        "merchantInvoiceNumber": "0a1b2c3d4e5f60718293",
    }


def executed(amount="1000", payment_id=PAYMENT_ID, trx_id=TRX_ID):
    return {
        "statusCode": "0000", "statusMessage": "Successful", "paymentID": payment_id, "payerReference": "sau",
        "customerMsisdn": PAYER, "trxID": trx_id, "amount": str(amount), "transactionStatus": "Completed",
        "paymentExecuteTime": "2026-11-18T12:32:10:101 GMT+0600", "currency": "BDT", "intent": "sale",
        "merchantInvoiceNumber": "0a1b2c3d4e5f60718293",
    }


def invalid_state():
    return {"statusCode": "2056", "statusMessage": "Invalid Payment State"}


def not_found():
    return {"statusCode": "2033", "statusMessage": "Transaction Not Found"}


def status_of(transaction_status, amount="1000", verification="Complete", trx_id=TRX_ID):
    body = {
        "paymentID": PAYMENT_ID, "mode": "0011", "paymentCreateTime": "2026-11-18T12:31:29:897 GMT+0600",
        "amount": str(amount), "currency": "BDT", "intent": "sale", "merchantInvoice": "0a1b2c3d4e5f60718293",
        "transactionStatus": transaction_status, "verificationStatus": verification, "payerReference": "sau",
        "statusCode": "0000", "statusMessage": "Successful",
    }
    if transaction_status == "Completed":
        body.update(trxID=trx_id, payerAccount=PAYER, paymentExecuteTime="2026-11-18T12:32:10:101 GMT+0600",
                    maxRefundableAmount=str(amount))
    return body


def refunded(amount="500", refund_trx="DKI10PX9AB"):
    return {
        "statusCode": "0000", "statusMessage": "Successful", "originalTrxID": TRX_ID, "refundTrxID": refund_trx,
        "transactionStatus": "Completed", "amount": str(amount), "currency": "BDT", "charge": "0.00",
        "completedTime": "2026-11-18T13:02:44:120 GMT+0600",
    }


class FakeResponse:
    def __init__(self, body, status_code=200):
        self.status_code = status_code
        self._body = body

    def json(self):
        if isinstance(self._body, str):
            return json.loads(self._body)
        return self._body


class FakeBkash:
    """Answers `requests.post` by endpoint path (after `/tokenized/`). Each path has a queue of answers; the last
    one keeps answering. An exception in the queue is raised (a network failure)."""

    def __init__(self):
        self.calls = []
        self.replies = defaultdict(list)
        self.on("checkout/token/grant", token_granted())

    def on(self, path, *answers):
        self.replies[path] = list(answers)
        return self

    def __call__(self, url, json=None, headers=None, timeout=None):
        path = url.split("/tokenized/", 1)[1]
        self.calls.append({"path": path, "body": json, "headers": headers})
        queue = self.replies.get(path)
        if not queue:
            raise AssertionError(f"unexpected bKash call: {path}")
        answer = queue.pop(0) if len(queue) > 1 else queue[0]
        if isinstance(answer, Exception):
            raise answer
        if isinstance(answer, FakeResponse):
            return answer
        return FakeResponse(answer)

    def paths(self, without_token=True):
        return [c["path"] for c in self.calls if not (without_token and c["path"] == "checkout/token/grant")]

    def bodies(self, path):
        return [c["body"] for c in self.calls if c["path"] == path]


def network_error():
    return requests.ConnectionError("connection refused")


# ---------------------------------------------------------------- fixtures

@pytest.fixture
def fake_bkash(monkeypatch, settings):
    cache.clear()
    settings.BKASH_BASE_URL = "https://tokenized.sandbox.bka.sh/v1.2.0-beta/tokenized/"
    settings.BKASH_APP_KEY = "test-app-key"
    settings.BKASH_APP_SECRET = "test-app-secret"
    settings.BKASH_USERNAME = "test-user"
    settings.BKASH_PASSWORD = "test-pass"
    settings.BKASH_CALLBACK_URL = "http://api.test/api/v1/payments/bkash/callback/"
    settings.ADMIN_PUBLIC_URL = "http://admin.test/admin"
    settings.BILLING_RECEIPT_PREFIX = "BDR"
    fake = FakeBkash()
    monkeypatch.setattr(bkash.requests, "post", fake)
    monkeypatch.setattr(billing, "pause", lambda seconds: None)
    return fake


@pytest.fixture
def no_bkash(settings):
    cache.clear()
    settings.BKASH_APP_KEY = settings.BKASH_APP_SECRET = settings.BKASH_USERNAME = settings.BKASH_PASSWORD = ""
    settings.BILLING_RECEIPT_PREFIX = "BDR"


@pytest.fixture
def apps_():
    synapse = Product.objects.create(name="Synapse", slug="synapse", sort_order=1)
    mindspear = Product.objects.create(name="Mindspear", slug="mindspear", sort_order=2)
    return {"synapse": synapse, "mindspear": mindspear}


def single(product, slug, price, **kw):
    pkg, _ = create_package_with_version(
        product=product, name=kw.pop("name", slug.title()), slug=slug, price=price, limits=[], **kw,
    )
    return pkg


@pytest.fixture
def packages(apps_):
    synapse, mindspear = apps_["synapse"], apps_["mindspear"]
    suite, _ = create_package_with_version(
        product=None, kind=Package.Kind.BUNDLE, products=[synapse, mindspear], name="BdREN AI Suite",
        slug="suite", price=4500, limits=[], price_unit=Package.PriceUnit.PER_INSTITUTION,
    )
    return {
        "basic": single(synapse, "basic", 1000),
        "standard": single(synapse, "standard", 3000),
        "free": single(synapse, "free", 0, billing_interval=Package.BillingInterval.FREE),
        "mind": single(mindspear, "mind", 2000),
        "suite": suite,
    }


@pytest.fixture
def org():
    return make_org("sau", name="Sylhet Agricultural University", seat_cap=50)


@pytest.fixture
def account(org):
    return org.account


@pytest.fixture
def owner(org):
    return add_member(org, make_user("owner@sau.ac.bd", name="Owner"), role=Membership.Role.OWNER)


@pytest.fixture
def admin(org, owner):
    return add_member(org, make_user("admin@sau.ac.bd", name="Admin"), role=Membership.Role.ADMIN)


@pytest.fixture
def member(org):
    return add_member(org, make_user("member@sau.ac.bd", name="Member"))


@pytest.fixture
def other_org():
    other = make_org("buet", name="BUET")
    add_member(other, make_user("chief@buet.ac.bd", name="Chief"), role=Membership.Role.ADMIN)
    return other


@pytest.fixture
def boss():
    user = make_user("boss@bdren.ai", name="Platform Boss")
    PlatformRoleAssignment.objects.create(user=user, role=PlatformRoleAssignment.Role.SUPER_ADMIN)
    return user


def signed_in(user):
    c = Client()
    c.force_login(user)
    return c


def portal(client, method, path, body=None, slug="sau"):
    url = f"{PORTAL}{slug}/billing/{path}"
    if method == "get":
        return client.get(url, body or {})
    return getattr(client, method)(url, {} if body is None else body, content_type="application/json")


def superadmin(client, method, path, body=None):
    url = SUPERADMIN + path
    if method == "get":
        return client.get(url, body or {})
    return getattr(client, method)(url, {} if body is None else body, content_type="application/json")


def error(response):
    return response.status_code, response.json()["error"]


def subscribe(account, package, *, days_left=20, **kw):
    """A live subscription to `package` that started 30 - `days_left` days ago."""
    now = timezone.now()
    return create_subscription(
        account=account, package=package, starts_at=now - timedelta(days=30 - days_left),
        expires_at=now + timedelta(days=days_left), **kw,
    )


def age(payment, **delta):
    """Moves the payment's `created_at` into the past."""
    PaymentRecord.objects.filter(pk=payment.pk).update(created_at=timezone.now() - timedelta(**delta))
    payment.refresh_from_db()
    return payment


def manual_body(package, kind="new", **over):
    body = {
        "institution": "sau", "package": str(package.id), "kind": kind, "periods": 1, "amount": "1000.00",
        "method": "bank_transfer", "reference": "SIBL-889120", "payer_name": "SAU Accounts",
        "payment_date": "2026-11-18", "notes": "", "pending": False,
    }
    return {**body, **over}
