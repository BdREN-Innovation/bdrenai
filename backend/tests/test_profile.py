import json
from decimal import Decimal

import pytest
from django.test import Client
from django.utils import timezone

from apps.accounts.models import Account
from apps.billing.models import PaymentRecord
from apps.identities import zitadel
from apps.identities.services import provision_user
from apps.packages.models import Package, PackageVersion
from apps.products.models import Product
from apps.subscriptions.models import Subscription
from tests.conftest import ISSUER

pytestmark = pytest.mark.django_db

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
SVG = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'


class FakeZitadel:
    def __init__(self):
        self.calls = []

    def __call__(self, method, path, body=None):
        self.calls.append((method, path, body))
        return {}


@pytest.fixture
def fake(idp, settings, monkeypatch):
    settings.ZITADEL_SERVICE_TOKEN = "service-token"
    f = FakeZitadel()
    monkeypatch.setattr(zitadel, "_call", f)
    return f


def make_user(sub="z-9", email="rahim@du.ac.bd"):
    return provision_user({"iss": ISSUER, "sub": sub, "email": email, "email_verified": True,
                           "given_name": "Rahim", "family_name": "Uddin"})


def signed_in(user):
    c = Client()
    c.force_login(user, backend="django.contrib.auth.backends.ModelBackend")
    return c


def patch(c, data):
    return c.patch("/api/v1/auth/profile/", json.dumps(data), content_type="application/json")


def test_profile_requires_sign_in(idp):
    assert Client().get("/api/v1/auth/profile/").status_code == 403


def test_profile_shows_details(fake):
    body = signed_in(make_user()).get("/api/v1/auth/profile/").json()
    assert body["first_name"] == "Rahim" and body["last_name"] == "Uddin"
    assert body["email"] == "rahim@du.ac.bd" and body["email_verified"] is True
    assert body["avatar_url"] is None and body["is_admin"] is False and body["can_edit_name"] is True


def test_name_update_goes_to_zitadel_then_locally(fake):
    user = make_user()
    r = patch(signed_in(user), {"first_name": " Karim ", "last_name": "Hasan"})
    assert r.status_code == 200 and r.json()["first_name"] == "Karim"
    assert fake.calls == [("PUT", "/v2/users/human/z-9", {
        "profile": {"givenName": "Karim", "familyName": "Hasan", "displayName": "Karim Hasan"},
    })]
    user.refresh_from_db()
    assert (user.given_name, user.family_name, user.name) == ("Karim", "Hasan", "Karim Hasan")


def test_email_cannot_be_changed(fake):
    r = patch(signed_in(make_user()), {"first_name": "Rahim", "last_name": "Uddin", "email": "new@x.bd"})
    assert r.status_code == 400 and "email" in r.json()["fields"]
    assert fake.calls == []


def test_blank_names_rejected(fake):
    r = patch(signed_in(make_user()), {"first_name": "", "last_name": " "})
    assert r.status_code == 400 and set(r.json()["fields"]) == {"first_name", "last_name"}


def test_name_editing_off_without_service_token(idp, settings):
    settings.ZITADEL_SERVICE_TOKEN = ""
    r = patch(signed_in(make_user()), {"first_name": "A", "last_name": "B"})
    assert r.status_code == 503


def test_avatar_upload_view_and_remove(fake):
    from django.core.files.uploadedfile import SimpleUploadedFile

    c = signed_in(make_user())
    r = c.post("/api/v1/auth/profile/avatar/", {"avatar": SimpleUploadedFile("me.png", PNG)})
    assert r.status_code == 200 and r.json()["avatar_url"].startswith("/api/v1/auth/profile/avatar/?v=")
    got = c.get("/api/v1/auth/profile/avatar/")
    assert got.status_code == 200 and got["Content-Type"] == "image/png" and got.content == PNG
    assert c.delete("/api/v1/auth/profile/avatar/").json() == {"avatar_url": None}
    assert c.get("/api/v1/auth/profile/avatar/").status_code == 404


@pytest.mark.parametrize("name,content,message", [
    ("x.svg", SVG, "PNG, JPEG or WebP"),
    ("big.png", b"\x89PNG\r\n\x1a\n" + b"\x00" * (2 * 1024 * 1024), "2 MB"),
])
def test_avatar_rejects_unsafe_or_large_files(fake, name, content, message):
    from django.core.files.uploadedfile import SimpleUploadedFile

    r = signed_in(make_user()).post("/api/v1/auth/profile/avatar/", {"avatar": SimpleUploadedFile(name, content)})
    assert r.status_code == 400 and message in r.json()["fields"]["avatar"]


def test_billing_lists_only_own_plans_and_payments(fake):
    user, other = make_user(), make_user("z-10", "other@x.bd")
    product = Product.objects.create(name="Synapse", slug="synapse")
    package = Package.objects.create(product=product, name="Pro", slug="pro", price=Decimal("1500"),
                                     billing_interval="monthly")
    version = PackageVersion.objects.create(package=package, version=2)
    mine = Account.objects.get(owner_user=user, account_type=Account.Type.PERSONAL)
    theirs = Account.objects.get(owner_user=other, account_type=Account.Type.PERSONAL)
    for acct in (mine, theirs):
        sub = Subscription.objects.create(account=acct, product=product, package_version=version,
                                          starts_at=timezone.now(), billing_interval="monthly")
        PaymentRecord.objects.create(account=acct, subscription=sub, amount=Decimal("1500"), reference=f"INV-{acct.id}")

    body = signed_in(user).get("/api/v1/auth/profile/billing/").json()
    assert [(s["product"], s["package"], s["version"], s["account"]) for s in body["subscriptions"]] == [
        ("Synapse", "Pro", 2, "Personal")
    ]
    assert [p["reference"] for p in body["payments"]] == [f"INV-{mine.id}"]


def test_me_sets_csrf_cookie_for_the_website(fake):
    r = signed_in(make_user()).get("/api/v1/auth/me/")
    assert r.status_code == 200 and "csrftoken" in r.cookies
