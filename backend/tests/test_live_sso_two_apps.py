"""Live integration test against ZITADEL v4:
1. Full SSO across demo-app-a and demo-app-b reusing a single ZITADEL v2 session.
2. Full OIDC login + first-login provisioning through Django's BFF against live ZITADEL.

Requires the local Docker Compose stack + .zitadel-secrets.json.
Skipped automatically if .zitadel-secrets.json is not present.
"""
import json
import subprocess
import time
import urllib.parse
from pathlib import Path

import pytest
import requests
from django.test import Client

from apps.accounts.models import Account
from apps.identities.models import User

ROOT = Path(__file__).resolve().parents[2]
SECRETS_FILE = ROOT / ".zitadel-secrets.json"


def _read_volume_pat(filename):
    return subprocess.check_output(
        ["docker", "run", "--rm", "-v", "bdren-sso_zitadel-bootstrap:/b:ro", "alpine", "cat", f"/b/{filename}"],
        text=True,
    ).strip()


@pytest.mark.django_db
@pytest.mark.skipif(not SECRETS_FILE.exists(), reason="Live ZITADEL secrets not initialized")
def test_live_sso_across_two_demo_apps_and_django_bff(settings):
    secrets_cfg = json.loads(SECRETS_FILE.read_text())
    issuer = "http://auth.bdren.localhost:8080"
    internal = "http://127.0.0.1:8080"
    host_hdr = {"Host": "auth.bdren.localhost:8080"}

    admin_pat = _read_volume_pat("admin-bootstrap.pat")
    login_pat = _read_volume_pat("login-client.pat")
    admin_hdr = {**host_hdr, "Authorization": f"Bearer {admin_pat}", "Content-Type": "application/json"}
    login_hdr = {**host_hdr, "Authorization": f"Bearer {login_pat}", "Content-Type": "application/json"}

    # 1. Create a real human user in ZITADEL v2 API
    uname = f"sso-user-{int(time.time())}@bdren.ai"
    r = requests.post(
        f"{internal}/v2/users/human",
        headers=admin_hdr,
        json={
            "username": uname,
            "profile": {"givenName": "SSO", "familyName": "Tester", "displayName": "SSO Tester"},
            "email": {"email": uname, "isVerified": True},
            "password": {"password": "StrongPass!234", "changeRequired": False},
        },
        timeout=10,
    )
    assert r.status_code in (200, 201), r.text
    user_id = r.json()["userId"]

    # 2. Authenticate once via ZITADEL Session v2 API (using IAM_LOGIN_CLIENT token, just like Login v2 UI)
    s_res = requests.post(
        f"{internal}/v2/sessions",
        headers=login_hdr,
        json={
            "checks": {"user": {"userId": user_id}, "password": {"password": "StrongPass!234"}},
        },
        timeout=10,
    )
    assert s_res.status_code in (200, 201), s_res.text
    zitadel_session_id = s_res.json()["sessionId"]
    zitadel_session_token = s_res.json()["sessionToken"]

    # 3. Start demo-app-a (port 9001) and demo-app-b (port 9002)
    procs = []
    try:
        for name, port in [("demo-app-a", 9001), ("demo-app-b", 9002)]:
            c = secrets_cfg[name]
            p = subprocess.Popen([
                str(ROOT / ".venv/bin/python"),
                str(ROOT / "demo_apps/app.py"),
                "--name", name,
                "--port", str(port),
                "--issuer", issuer,
                "--internal-base", internal,
                "--client-id", c["client_id"],
                "--client-secret", c["client_secret"],
                "--redirect-uri", f"http://localhost:{port}/auth/callback",
            ])
            procs.append(p)

        for port in (9001, 9002):
            for _ in range(30):
                try:
                    if requests.get(f"http://127.0.0.1:{port}/health", timeout=1).status_code == 200:
                        break
                except requests.RequestException:
                    time.sleep(0.1)

        def bind_session_to_authorize(authorize_url):
            r_auth = requests.get(authorize_url.replace(issuer, internal), headers=host_hdr, allow_redirects=False, timeout=10)
            assert r_auth.status_code in (302, 303), r_auth.text
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(r_auth.headers["Location"]).query)
            auth_req_id = qs["authRequest"][0]
            r_bind = requests.post(
                f"{internal}/v2/oidc/auth_requests/{auth_req_id}",
                headers=login_hdr,
                json={"session": {"sessionId": zitadel_session_id, "sessionToken": zitadel_session_token}},
                timeout=10,
            )
            assert r_bind.status_code == 200, r_bind.text
            return r_bind.json()["callbackUrl"]

        def complete_app_login(port):
            client = requests.Session()
            r1 = client.get(f"http://127.0.0.1:{port}/", allow_redirects=False)
            assert r1.status_code == 302 and r1.headers["Location"] == "/auth/login"
            r2 = client.get(f"http://127.0.0.1:{port}/auth/login", allow_redirects=False)
            assert r2.status_code == 302
            callback_url = bind_session_to_authorize(r2.headers["Location"])
            r5 = client.get(callback_url.replace("localhost", "127.0.0.1"), allow_redirects=False, timeout=10)
            assert r5.status_code == 302 and r5.headers["Location"] == "/"
            r6 = client.get(f"http://127.0.0.1:{port}/", timeout=10)
            assert r6.status_code == 200
            return client, r6.json()

        client_a, info_a = complete_app_login(9001)
        client_b, info_b = complete_app_login(9002)

        assert info_a["authenticated"] is True and info_b["authenticated"] is True
        assert info_a["sub"] == user_id and info_b["sub"] == user_id
        assert info_a["iss"] == issuer and info_b["iss"] == issuer
        assert "demo-app-a_sid" in client_a.cookies and "demo-app-b_sid" not in client_a.cookies
        assert "demo-app-b_sid" in client_b.cookies and "demo-app-a_sid" not in client_b.cookies

        # 4. Also complete the live OIDC login against Django's BFF using the same SSO session
        api_c = secrets_cfg["bdren-platform-api"]
        settings.OIDC = {
            **settings.OIDC,
            "ISSUER": issuer,
            "INTERNAL_BASE_URL": internal,
            "CLIENT_ID": api_c["client_id"],
            "CLIENT_SECRET": api_c["client_secret"],
            "REDIRECT_URI": "http://localhost:8000/api/v1/auth/callback/",
        }
        dj = Client(HTTP_HOST="localhost")
        dj_login = dj.get("/api/v1/auth/login/?next=/dashboard")
        assert dj_login.status_code == 302
        dj_cb_url = bind_session_to_authorize(dj_login["Location"])
        parsed_cb = urllib.parse.urlparse(dj_cb_url)
        dj_cb = dj.get(f"{parsed_cb.path}?{parsed_cb.query}")
        assert dj_cb.status_code == 302 and dj_cb["Location"] == "/dashboard"

        provisioned = User.objects.get(issuer=issuer, zitadel_subject=user_id)
        assert provisioned.email == uname and provisioned.email_verified is True
        assert Account.objects.filter(owner_user=provisioned, account_type="personal").count() == 1
    finally:
        for p in procs:
            p.terminate()
            p.wait(timeout=5)
