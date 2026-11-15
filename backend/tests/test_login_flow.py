from urllib.parse import parse_qs, urlparse

import pytest
from django.test import Client

from apps.accounts.models import Account
from apps.identities.models import User
from apps.identities.views import safe_next
from tests.conftest import ISSUER

pytestmark = pytest.mark.django_db


def start(client, next_="/"):
    r = client.get("/api/v1/auth/login/", {"next": next_})
    assert r.status_code == 302 and r["Location"].startswith(ISSUER + "/authorize")
    return parse_qs(urlparse(r["Location"]).query)


def finish(client, idp, state, nonce="N", code="abc"):
    idp.token_response_claims = {"nonce": nonce}
    return client.get("/api/v1/auth/callback/", {"code": code, "state": state})


def test_first_login_provisions_user_and_personal_account(idp):
    c = Client()
    q = start(c, "http://app/dash")
    nonce = c.session["oidc_flow"]["nonce"]
    r = finish(c, idp, q["state"][0], nonce)
    assert r.status_code == 302 and r["Location"] == "http://app/dash"
    u = User.objects.get(issuer=ISSUER, zitadel_subject="u-100")
    assert not u.has_usable_password()
    assert Account.objects.filter(owner_user=u, account_type="personal").count() == 1
    me = c.get("/api/v1/auth/me/").json()
    assert me["email"] == "a@example.com" and me["accounts"][0]["type"] == "personal"


def test_second_login_does_not_duplicate_and_updates_profile(idp):
    for name in ("Alice", "Alice B"):
        c = Client(); q = start(c)
        idp.token_response_claims = {"nonce": c.session["oidc_flow"]["nonce"], "name": name}
        c.get("/api/v1/auth/callback/", {"code": "x", "state": q["state"][0]})
    assert User.objects.count() == 1 and Account.objects.count() == 1
    assert User.objects.get().name == "Alice B"


def test_same_email_different_subject_is_not_linked(idp):
    for sub in ("u-1", "u-2"):
        c = Client(); q = start(c)
        idp.token_response_claims = {"nonce": c.session["oidc_flow"]["nonce"], "sub": sub}
        c.get("/api/v1/auth/callback/", {"code": "x", "state": q["state"][0]})
    assert User.objects.count() == 2  # identical email, distinct users


def test_state_mismatch_rejected_and_flow_single_use(idp):
    c = Client(); start(c)
    assert finish(c, idp, "forged").status_code == 400
    assert finish(c, idp, "forged").status_code == 400  # flow already consumed
    assert User.objects.count() == 0


def test_nonce_mismatch_rejected(idp):
    c = Client(); q = start(c)
    r = finish(c, idp, q["state"][0], nonce="attacker")
    assert r.status_code == 401 and User.objects.count() == 0


def test_callback_without_login_start(idp):
    assert Client().get("/api/v1/auth/callback/", {"code": "x", "state": "y"}).status_code == 400


def test_suspended_user_blocked(idp):
    c = Client(); q = start(c)
    idp.token_response_claims = {"nonce": c.session["oidc_flow"]["nonce"]}
    c.get("/api/v1/auth/callback/", {"code": "x", "state": q["state"][0]})
    User.objects.update(status="suspended")
    c2 = Client(); q = start(c2)
    idp.token_response_claims = {"nonce": c2.session["oidc_flow"]["nonce"]}
    assert c2.get("/api/v1/auth/callback/", {"code": "x", "state": q["state"][0]}).status_code == 403
    assert c.get("/api/v1/auth/me/").status_code in (401, 403)  # existing session no longer valid


def test_me_requires_auth():
    assert Client().get("/api/v1/auth/me/").status_code in (401, 403)


def test_logout_requires_csrf_and_ends_session(idp):
    c = Client(enforce_csrf_checks=True); q = start(c)
    idp.token_response_claims = {"nonce": c.session["oidc_flow"]["nonce"]}
    c.get("/api/v1/auth/callback/", {"code": "x", "state": q["state"][0]})
    assert c.post("/api/v1/auth/logout/").status_code == 403  # no CSRF token
    c2 = Client(); q = start(c2)
    idp.token_response_claims = {"nonce": c2.session["oidc_flow"]["nonce"]}
    c2.get("/api/v1/auth/callback/", {"code": "x", "state": q["state"][0]})
    r = c2.post("/api/v1/auth/logout/")
    assert r.status_code == 200 and "id_token_hint=" in r.json()["redirect"]
    assert c2.get("/api/v1/auth/me/").status_code in (401, 403)


def test_session_cookie_flags(idp, settings):
    c = Client(); start(c)
    cookie = c.cookies["bdren_session"]
    assert cookie["httponly"]


@pytest.mark.parametrize("val,expected", [
    ("/x?y=1", "/x?y=1"), ("//evil.com", "/"), ("https://evil.com/", "/"), ("/\\evil.com", "/"),
    ("http://app/ok", "http://app/ok"), (None, "/"), ("javascript:alert(1)", "/"),
])
def test_safe_next(idp, val, expected):
    assert safe_next(val) == expected
