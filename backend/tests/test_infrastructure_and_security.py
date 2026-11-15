import json
import subprocess
import time
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import pytest
from django.core.management import call_command
from django.test import Client

from apps.administration.models import PlatformRoleAssignment
from apps.identities.models import User

ROOT = Path(__file__).resolve().parents[2]
SECRETS_FILE = ROOT / ".zitadel-secrets.json"

pytestmark = pytest.mark.django_db


def test_public_catalog_and_manual_payment_verification_flow(idp):
    call_command("seed_bdren_catalog")
    anon = Client()
    cat = anon.get("/api/v1/catalog/products/")
    assert cat.status_code == 200
    products = cat.json()["products"]
    assert len(products) >= 2
    minds = next(p for p in products if p["slug"] == "mindspear")
    pro_pkg = next(pk for pk in minds["packages"] if pk["slug"] == "professional")

    # Log in as user and subscribe to paid package via manual/offline payment reference
    c = Client()
    r = c.get("/api/v1/auth/login/")
    st = parse_qs(urlparse(r["Location"]).query)["state"][0]
    idp.token_response_claims = {"nonce": c.session["oidc_flow"]["nonce"], "sub": "u-pay-1"}
    c.get("/api/v1/auth/callback/", {"code": "c", "state": st})
    u = User.objects.get(zitadel_subject="u-pay-1")

    # Missing payment reference for paid non-trial package -> 400
    bad_sub = c.post(
        "/api/v1/catalog/subscribe/",
        data=json.dumps({"package_id": pro_pkg["id"], "use_trial": False}),
        content_type="application/json",
    )
    assert bad_sub.status_code == 400

    # Valid offline payment reference -> 202 pending verification
    pend_sub = c.post(
        "/api/v1/catalog/subscribe/",
        data=json.dumps({"package_id": pro_pkg["id"], "use_trial": False, "payment_reference": "BDREN-PO-7788"}),
        content_type="application/json",
    )
    assert pend_sub.status_code == 202
    pmt_id = pend_sub.json()["payment_id"]
    pkg_ver_id = pend_sub.json()["package_version_id"]

    # Billing administrator verifies the payment -> activates subscription & entitlements!
    PlatformRoleAssignment.objects.create(user=u, role=PlatformRoleAssignment.Role.BILLING_ADMIN)
    ver_res = c.post(
        "/api/v1/admin/subscriptions/",
        data=json.dumps({
            "action": "verify_payment",
            "payment_id": pmt_id,
            "approve": True,
            "package_version_id": pkg_ver_id,
        }),
        content_type="application/json",
    )
    assert ver_res.status_code == 200 and ver_res.json()["status"] == "completed"
    assert ver_res.json()["subscription_id"] is not None

    ents = c.get("/api/v1/entitlements/current/").json()["entitlements"]
    ai_ent = next(e for e in ents if e["product"] == "mindspear" and e["feature"] == "ai_requests")
    assert ai_ent["limit"] == 5000


def test_production_compose_security_and_healthchecks():
    out = subprocess.check_output(
        ["docker", "compose", "-f", "docker-compose.yml", "-f", "docker-compose.prod.yml", "config", "--format", "json"],
        cwd=str(ROOT),
        text=True,
    )
    cfg = json.loads(out)
    services = cfg["services"]
    for svc in ("nginx", "backend", "frontend", "zitadel-api", "zitadel-login", "postgres", "redis"):
        assert svc in services, f"Missing service {svc}"
        assert "healthcheck" in services[svc], f"Missing healthcheck on {svc}"
        assert services[svc].get("restart") == "unless-stopped", f"Missing restart policy on {svc}"

    # Verify Postgres and Redis publish ZERO ports in production config
    assert not services["postgres"].get("ports"), "postgres must not publish ports in prod"
    assert not services["redis"].get("ports"), "redis must not publish ports in prod"
    assert not services["backend"].get("ports"), "backend must not publish ports directly in prod"


@pytest.mark.skipif(not SECRETS_FILE.exists(), reason="Live ZITADEL secrets not initialized")
def test_live_zitadel_institutional_org_and_idp_provisioning():
    pat = subprocess.check_output(
        ["docker", "run", "--rm", "-v", "bdren-sso_zitadel-bootstrap:/b:ro", "alpine", "cat", "/b/admin-bootstrap.pat"],
        text=True,
    ).strip()
    org_name = f"Univ-Fed-{int(time.time())}"
    out = subprocess.check_output(
        [
            str(ROOT / ".venv/bin/python"),
            str(ROOT / "scripts/configure_institutional_idp.py"),
            "--issuer", "http://auth.bdren.localhost:8080",
            "--connect", "http://127.0.0.1:8080",
            "--pat-file", "-",
            "--org-name", org_name,
            "--protocol", "oidc",
            "--idp-name", f"{org_name}-OIDC",
            "--oidc-issuer", "https://idp.du.ac.bd",
            "--oidc-client-id", "du-client-id",
            "--oidc-client-secret", "du-client-secret",
        ],
        input=pat,
        text=True,
    )
    data = json.loads(out.strip())
    assert data["zitadel_organization_id"].isdigit()
    assert data["zitadel_idp_id"].isdigit()
    assert data["protocol"] == "oidc"
