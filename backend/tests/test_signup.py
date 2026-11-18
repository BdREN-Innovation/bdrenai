import json

import pytest
from django.test import Client

from apps.accounts.models import Account
from apps.accounts.services import accessible_accounts_for_user
from apps.audit.models import AuditLog
from apps.identities import zitadel
from apps.identities.models import User
from apps.identities.services import provision_user
from apps.organizations.models import Membership, Organization
from apps.organizations.services import create_organization
from tests.conftest import ISSUER

pytestmark = pytest.mark.django_db

PASSWORD = "Str0ng!pass"


class FakeZitadel:
    """Stands in for ZITADEL's HTTP API (the only thing not under our control)."""

    def __init__(self):
        self.calls = []
        self.existing = set()
        self.codes = {}

    def __call__(self, method, path, body=None):
        self.calls.append((method, path, body))
        if path == "/v2/users/human":
            email = body["email"]["email"]
            if email in self.existing:
                raise zitadel.ZitadelError("email_taken", 409)
            self.existing.add(email)
            uid = f"z-{len(self.existing)}"
            self.codes[uid] = "123456"
            return {"userId": uid}
        if path.endswith("/email/verify"):
            uid = path.split("/")[3]
            if body["verificationCode"] != self.codes.get(uid):
                raise zitadel.ZitadelError("invalid_code", 400)
            return {}
        if path.endswith("/email/resend"):
            return {}
        raise AssertionError(f"unexpected call {method} {path}")


@pytest.fixture
def fake(idp, settings, monkeypatch):
    settings.ZITADEL_SERVICE_TOKEN = "service-token"
    f = FakeZitadel()
    monkeypatch.setattr(zitadel, "_call", f)
    return f


@pytest.fixture
def org():
    return create_organization(name="University of Dhaka", slug="du")


def form(**over):
    data = {
        "first_name": "Rahim",
        "last_name": "Uddin",
        "email": "Rahim@DU.ac.bd",
        "password": PASSWORD,
        "confirm_password": PASSWORD,
        "institution": "none",
        "accepted_terms": True,
    }
    data.update(over)
    return data


def post(c, path, data):
    return c.post(path, json.dumps(data), content_type="application/json")


def test_institutions_lists_active_organizations_only(fake, org):
    create_organization(name="Closed College", slug="closed")
    Organization.objects.filter(slug="closed").update(status=Organization.Status.DEACTIVATED)
    body = Client().get("/api/v1/auth/institutions/").json()
    assert body["institutions"] == [{"id": str(org.id), "name": "University of Dhaka"}]
    assert body["signup_enabled"] is True


def test_signup_disabled_without_service_token(idp, settings):
    settings.ZITADEL_SERVICE_TOKEN = ""
    r = post(Client(), "/api/v1/auth/register/", form())
    assert r.status_code == 503


@pytest.mark.parametrize(
    "over,field",
    [
        ({"first_name": " "}, "first_name"),
        ({"email": "not-an-email"}, "email"),
        ({"password": "short", "confirm_password": "short"}, "password"),
        ({"confirm_password": "Different1!"}, "confirm_password"),
        ({"accepted_terms": False}, "accepted_terms"),
        ({"institution": ""}, "institution"),
        ({"institution": "other", "institution_other": ""}, "institution_other"),
        ({"institution": "00000000-0000-0000-0000-000000000000"}, "institution"),
    ],
)
def test_invalid_form_is_rejected_before_zitadel(fake, over, field):
    r = post(Client(), "/api/v1/auth/register/", form(**over))
    assert r.status_code == 400 and field in r.json()["fields"]
    assert fake.calls == []


def test_signup_creates_user_with_pending_institution_membership(fake, org):
    c = Client()
    r = post(c, "/api/v1/auth/register/", form(institution=str(org.id)))
    assert r.status_code == 201 and r.json()["email"] == "rahim@du.ac.bd"

    method, path, body = fake.calls[0]
    assert (method, path) == ("POST", "/v2/users/human")
    assert body["email"] == {"email": "rahim@du.ac.bd", "sendCode": {}}
    assert body["password"] == {"password": PASSWORD, "changeRequired": False}

    user = User.objects.get(issuer=ISSUER, zitadel_subject="z-1")
    assert user.email_verified is False and user.name == "Rahim Uddin"
    membership = Membership.objects.get(user=user, organization=org)
    assert membership.status == Membership.Status.PENDING
    assert AuditLog.objects.get(action="user.signed_up").metadata == {"organization_id": str(org.id)}
    assert c.session["signup_flow"]["zid"] == "z-1"


def test_pending_membership_grants_no_institution_access(fake, org):
    post(Client(), "/api/v1/auth/register/", form(institution=str(org.id)))
    user = User.objects.get(zitadel_subject="z-1")
    types = set(accessible_accounts_for_user(user).values_list("account_type", flat=True))
    assert types == {Account.Type.PERSONAL}


def test_other_institution_is_recorded_for_follow_up(fake):
    post(Client(), "/api/v1/auth/register/", form(institution="other", institution_other="North South University"))
    assert AuditLog.objects.get(action="user.signed_up").metadata == {"institution_other": "North South University"}
    assert Membership.objects.count() == 0


def test_existing_email_is_reported_on_the_email_field(fake):
    post(Client(), "/api/v1/auth/register/", form())
    r = post(Client(), "/api/v1/auth/register/", form())
    assert r.status_code == 409 and "email" in r.json()["fields"]


def test_email_code_verification(fake):
    c = Client()
    post(c, "/api/v1/auth/register/", form())
    bad = post(c, "/api/v1/auth/register/verify/", {"code": "000000"})
    assert bad.status_code == 400 and "code" in bad.json()["fields"]

    assert post(c, "/api/v1/auth/register/resend/", {}).status_code == 200
    ok = post(c, "/api/v1/auth/register/verify/", {"code": "123456"})
    assert ok.status_code == 200 and ok.json()["email"] == "rahim@du.ac.bd"
    assert User.objects.get(zitadel_subject="z-1").email_verified is True
    assert "signup_flow" not in c.session


def test_verify_without_signup_session_is_refused(fake):
    r = post(Client(), "/api/v1/auth/register/verify/", {"code": "123456"})
    assert r.status_code == 400 and r.json()["error"] == "no_signup"


def test_institution_login_approves_pending_membership(fake, org):
    org.zitadel_organization_id = "zorg-1"
    org.save()
    post(Client(), "/api/v1/auth/register/", form(institution=str(org.id)))
    provision_user({"iss": ISSUER, "sub": "z-1", "email": "rahim@du.ac.bd", "urn:zitadel:iam:org:id": "zorg-1"})
    assert Membership.objects.get(organization=org).status == Membership.Status.ACTIVE
