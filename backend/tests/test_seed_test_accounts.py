import json

import pytest
import requests
from django.core.management import CommandError, call_command
from django.test import override_settings

from apps.administration.models import PlatformRoleAssignment
from apps.identities.models import User
from apps.organizations.models import Membership, Organization

pytestmark = pytest.mark.django_db

LOCAL_OIDC = {"ISSUER": "https://auth.bdren.localhost:8443", "INTERNAL_BASE_URL": "", "HTTP_TIMEOUT": 5}


class FakeZitadel:
    """Stands in for ZITADEL's user API at the HTTP boundary."""

    def __init__(self):
        self.users = {}
        self.passwords = {}
        self.calls = []

    def __call__(self, method, url, json=None, headers=None, timeout=None):
        path = url.split(":8443", 1)[1]
        self.calls.append((method, path, json))
        if method == "POST" and path == "/v2/users":
            email = json["queries"][0]["emailQuery"]["emailAddress"].lower()
            found = [{"userId": uid} for uid, user in self.users.items() if user["email"] == email]
            return self._reply({"result": found})
        if method == "POST" and path == "/v2/users/human":
            uid = str(len(self.users) + 1000)
            self.users[uid] = {"email": json["email"]["email"].lower(), "verified": json["email"].get("isVerified")}
            self.passwords[uid] = json["password"]["password"]
            return self._reply({"userId": uid})
        if method == "POST" and path.endswith("/password"):
            self.passwords[path.split("/")[3]] = json["newPassword"]["password"]
            return self._reply({})
        return self._reply({"message": "unexpected"}, 404)

    @staticmethod
    def _reply(body, status=200):
        response = requests.Response()
        response.status_code = status
        response._content = json.dumps(body).encode()
        return response


@pytest.fixture
def idp(monkeypatch):
    fake = FakeZitadel()
    monkeypatch.setattr(requests, "request", fake)
    return fake


def seed(**options):
    with override_settings(OIDC=LOCAL_OIDC, ZITADEL_SERVICE_TOKEN="token"):
        call_command("seed_test_accounts", **options)


def test_creates_the_three_accounts_with_roles(idp):
    seed()
    assert sorted(user["email"] for user in idp.users.values()) == [
        "inst-admin@bdren.test", "member@bdren.test", "superadmin@bdren.test",
    ]
    assert all(user["verified"] for user in idp.users.values())
    assert set(idp.passwords.values()) == {"Bdren-Test-2026!"}

    boss = User.objects.get(email="superadmin@bdren.test")
    assert boss.issuer == LOCAL_OIDC["ISSUER"] and boss.email_verified
    assert PlatformRoleAssignment.objects.filter(user=boss, role="platform_super_admin").exists()
    sau = Organization.objects.get(slug="sau")
    assert (sau.name, sau.sector, sau.seat_cap) == ("Sylhet Agricultural University", "public", 50)
    roles = dict(Membership.objects.filter(organization=sau).values_list("user__email", "role"))
    assert roles == {"inst-admin@bdren.test": "admin", "member@bdren.test": "member"}
    assert not Membership.objects.filter(user=boss).exists()


def test_running_again_resets_passwords_without_duplicating(idp):
    seed()
    seed(password="Another-Pass-1!")
    assert len(idp.users) == 3 and set(idp.passwords.values()) == {"Another-Pass-1!"}
    assert User.objects.count() == 3
    assert Organization.objects.filter(slug="sau").count() == 1
    assert PlatformRoleAssignment.objects.count() == 1
    assert Membership.objects.count() == 2


def test_refuses_a_non_local_identity_provider(idp):
    with override_settings(OIDC={**LOCAL_OIDC, "ISSUER": "https://auth.bdren.ai"}, ZITADEL_SERVICE_TOKEN="token"):
        with pytest.raises(CommandError, match="non-local"):
            call_command("seed_test_accounts")
    assert idp.calls == [] and not User.objects.exists()


def test_needs_the_zitadel_service_token(idp):
    with override_settings(OIDC=LOCAL_OIDC, ZITADEL_SERVICE_TOKEN=""):
        with pytest.raises(CommandError, match="ZITADEL_SERVICE_TOKEN"):
            call_command("seed_test_accounts")
