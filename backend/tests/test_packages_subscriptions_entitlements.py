import json
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from urllib.parse import parse_qs, urlparse

import pytest
from django.db import connections
from django.test import Client
from django.utils import timezone

from apps.administration.models import PlatformRoleAssignment
from apps.entitlements.models import Entitlement
from apps.identities.models import User
from apps.identities.services import provision_user
from apps.organizations.models import Membership
from apps.organizations.services import add_or_update_membership, create_organization
from apps.packages.models import PackageVersion
from apps.packages.services import (
    create_package_with_version,
    publish_new_package_version,
)
from apps.products.models import Feature, Product
from apps.subscriptions.models import SubscriptionHistory
from apps.subscriptions.services import create_subscription, renew_subscription
from apps.usage.models import UsageCounter, UsageEvent, UsageReservation
from apps.usage.services import (
    QuotaExceededError,
    commit_reservation,
    release_reservation,
    reserve_quota,
)
from tests.conftest import ISSUER

pytestmark = pytest.mark.django_db


def _setup_product_and_feature(policy=Feature.QuotaPolicy.PERSONAL_THEN_ORG):
    prod = Product.objects.create(name="Mindspear", slug="mindspear")
    raw_key = prod.rotate_api_key()
    feat = Feature.objects.create(
        product=prod, key="ai_requests", name="AI Requests", unit="requests", quota_policy=policy
    )
    return prod, feat, raw_key


def test_package_versioning_and_all_four_migration_policies():
    prod, feat, _ = _setup_product_and_feature()
    pkg, v1 = create_package_with_version(
        product=prod,
        name="Pro",
        slug="pro",
        price=1000,
        limits=[{"feature": feat, "limit_value": 5000, "limit_period": "monthly"}],
    )

    u1 = provision_user({"iss": ISSUER, "sub": "u-sub-1", "email": "u1@bdren.ai"})
    u2 = provision_user({"iss": ISSUER, "sub": "u-sub-2", "email": "u2@bdren.ai"})
    acct1 = u1.accounts.get(account_type="personal")
    acct2 = u2.accounts.get(account_type="personal")

    sub1 = create_subscription(account=acct1, package_version=v1)
    sub2 = create_subscription(account=acct2, package_version=v1)
    assert Entitlement.objects.get(account=acct1, feature=feat).limit == 5000

    # 1. Policy NEW_ONLY -> existing subscribers stay on v1 (5000)
    v2, stats = publish_new_package_version(
        package=pkg,
        limits=[{"feature": feat, "limit_value": 8000, "limit_period": "monthly"}],
        migration_policy=PackageVersion.MigrationPolicy.NEW_ONLY,
    )
    sub1.refresh_from_db()
    assert v2.version == 2 and stats["migrated"] == 0
    assert sub1.package_version_id == v1.id
    assert Entitlement.objects.get(account=acct1, feature=feat).limit == 5000

    # 2. Policy SELECTED_ONLY -> only sub1 migrates to v3 (10000); sub2 stays on v1 (5000)
    v3, stats = publish_new_package_version(
        package=pkg,
        limits=[{"feature": feat, "limit_value": 10000, "limit_period": "monthly"}],
        migration_policy=PackageVersion.MigrationPolicy.SELECTED_ONLY,
        selected_subscription_ids=[sub1.id],
    )
    sub1.refresh_from_db()
    sub2.refresh_from_db()
    assert stats["migrated"] == 1
    assert sub1.package_version_id == v3.id and Entitlement.objects.get(account=acct1, feature=feat).limit == 10000
    assert sub2.package_version_id == v1.id and Entitlement.objects.get(account=acct2, feature=feat).limit == 5000

    # 3. Policy ON_RENEWAL -> sets pending_package_version=v4 (12000), takes effect upon renew_subscription()
    v4, stats = publish_new_package_version(
        package=pkg,
        limits=[{"feature": feat, "limit_value": 12000, "limit_period": "monthly"}],
        migration_policy=PackageVersion.MigrationPolicy.ON_RENEWAL,
    )
    sub2.refresh_from_db()
    assert stats["scheduled"] == 2 and sub2.pending_package_version_id == v4.id
    assert Entitlement.objects.get(account=acct2, feature=feat).limit == 5000  # still v1 before renewal
    renew_subscription(subscription=sub2)
    sub2.refresh_from_db()
    assert sub2.package_version_id == v4.id and sub2.pending_package_version is None
    assert Entitlement.objects.get(account=acct2, feature=feat).limit == 12000

    # 4. Policy IMMEDIATE -> all active subscribers migrate immediately to v5 (20000)
    v5, stats = publish_new_package_version(
        package=pkg,
        limits=[{"feature": feat, "limit_value": 20000, "limit_period": "monthly"}],
        migration_policy=PackageVersion.MigrationPolicy.IMMEDIATE,
    )
    sub1.refresh_from_db()
    sub2.refresh_from_db()
    assert stats["migrated"] == 2
    assert sub1.package_version_id == v5.id and sub2.package_version_id == v5.id
    assert Entitlement.objects.get(account=acct1, feature=feat).limit == 20000
    assert SubscriptionHistory.objects.filter(subscription=sub1).count() >= 3


def test_mixed_quota_personal_then_org_and_idempotent_reservations_and_expiry():
    prod, feat, api_key = _setup_product_and_feature(policy=Feature.QuotaPolicy.PERSONAL_THEN_ORG)
    _, v_pers = create_package_with_version(
        product=prod, name="Personal", slug="pers", limits=[{"feature": feat, "limit_value": 100}]
    )
    _, v_org = create_package_with_version(
        product=prod, name="Org", slug="org", limits=[{"feature": feat, "limit_value": 500}]
    )

    u = provision_user({"iss": ISSUER, "sub": "u-mix", "email": "mix@bdren.ai"})
    pers_acct = u.accounts.get(account_type="personal")
    org = create_organization(name="Org Quota", slug="org-quota")
    add_or_update_membership(user=u, organization=org, role=Membership.Role.MEMBER)

    create_subscription(account=pers_acct, package_version=v_pers)
    create_subscription(account=org.account, package_version=v_org)

    # Reserve 80 units with idempotency key "idem-1" -> consumes from personal account (100 limit)
    r1 = reserve_quota(
        user=u, product=prod, feature=feat, quantity=80, idempotency_key="idem-1", organization_account=org.account
    )
    r1_dup = reserve_quota(
        user=u, product=prod, feature=feat, quantity=80, idempotency_key="idem-1", organization_account=org.account
    )
    assert r1.id == r1_dup.id and r1.account_id == pers_acct.id
    assert UsageCounter.objects.get(account=pers_acct, feature=feat).reserved == 80

    # Commit r1 (idempotent on repeated commit)
    res_c1, ev1 = commit_reservation(reservation_id=r1.id)
    res_c2, ev2 = commit_reservation(reservation_id=r1.id)
    assert ev1.id == ev2.id and UsageEvent.objects.filter(account=pers_acct).count() == 1
    ctr_pers = UsageCounter.objects.get(account=pers_acct, feature=feat)
    assert ctr_pers.used == 80 and ctr_pers.reserved == 0

    # Next request for 50 units exceeds remaining personal quota (20 left), so it overflows to org.account (500 limit)!
    r_org = reserve_quota(
        user=u, product=prod, feature=feat, quantity=50, idempotency_key="idem-org-1", organization_account=org.account
    )
    assert r_org.account_id == org.account.id
    assert UsageCounter.objects.get(account=org.account, feature=feat).reserved == 50

    # Release r_org -> reserved returns to 0
    release_reservation(reservation_id=r_org.id)
    assert UsageCounter.objects.get(account=org.account, feature=feat).reserved == 0

    # Expired reservation reclamation test: reserve 20 on personal, backdate expires_at, then reserve 20 again
    r_exp = reserve_quota(user=u, product=prod, feature=feat, quantity=20, idempotency_key="idem-exp")
    UsageReservation.objects.filter(id=r_exp.id).update(expires_at=timezone.now() - timedelta(minutes=5))
    r_reclaimed = reserve_quota(user=u, product=prod, feature=feat, quantity=20, idempotency_key="idem-after-exp")
    r_exp.refresh_from_db()
    assert r_exp.status == UsageReservation.Status.EXPIRED
    assert r_reclaimed.status == UsageReservation.Status.RESERVED
    assert UsageCounter.objects.get(account=pers_acct, feature=feat).reserved == 20


def test_entitlement_and_usage_http_apis_and_product_api_key_isolation(idp):
    prod, feat, minds_key = _setup_product_and_feature()
    other_prod = Product.objects.create(name="Synapse", slug="synapse")
    synapse_key = other_prod.rotate_api_key()
    _, v1 = create_package_with_version(
        product=prod, name="Pro", slug="pro", limits=[{"feature": feat, "limit_value": 10000}]
    )

    c = Client()
    r_login = c.get("/api/v1/auth/login/")
    st = parse_qs(urlparse(r_login["Location"]).query)["state"][0]
    idp.token_response_claims = {"nonce": c.session["oidc_flow"]["nonce"], "sub": "u-api-1"}
    c.get("/api/v1/auth/callback/", {"code": "c", "state": st})
    u = User.objects.get(zitadel_subject="u-api-1")
    create_subscription(account=u.accounts.get(account_type="personal"), package_version=v1)

    # Server-to-server check with valid Mindspear API key
    s2s = Client()
    chk = s2s.post(
        "/api/v1/entitlements/check/",
        data=json.dumps({"product": "mindspear", "feature": "ai_requests", "quantity": 10, "issuer": ISSUER, "zitadel_subject": "u-api-1"}),
        content_type="application/json",
        HTTP_X_PRODUCT_API_KEY=minds_key,
    )
    assert chk.status_code == 200 and chk.json()["allowed"] is True and chk.json()["limit"] == 10000

    # Cross-product key isolation: Synapse key cannot query Mindspear entitlements
    bad_key = s2s.post(
        "/api/v1/entitlements/check/",
        data=json.dumps({"product": "mindspear", "feature": "ai_requests", "quantity": 10, "issuer": ISSUER, "zitadel_subject": "u-api-1"}),
        content_type="application/json",
        HTTP_X_PRODUCT_API_KEY=synapse_key,
    )
    assert bad_key.status_code == 403

    # Reserve -> check -> commit via HTTP API
    res_resp = s2s.post(
        "/api/v1/usage/reservations/",
        data=json.dumps({
            "product": "mindspear",
            "feature": "ai_requests",
            "quantity": 450,
            "idempotency_key": "http-res-1",
            "issuer": ISSUER,
            "zitadel_subject": "u-api-1",
        }),
        content_type="application/json",
        HTTP_X_PRODUCT_API_KEY=minds_key,
    )
    assert res_resp.status_code == 201
    res_id = res_resp.json()["reservation_id"]

    commit_resp = s2s.post(
        f"/api/v1/usage/reservations/{res_id}/commit/",
        data=json.dumps({}),
        content_type="application/json",
        HTTP_X_PRODUCT_API_KEY=minds_key,
    )
    assert commit_resp.status_code == 200 and commit_resp.json()["status"] == "committed"

    # Authenticated browser session checks /api/v1/entitlements/current/ and /api/v1/usage/summary/
    assert len(c.get("/api/v1/entitlements/current/").json()["entitlements"]) == 1
    summary = c.get("/api/v1/usage/summary/").json()["usage"]
    assert summary[0]["used"] == 450 and summary[0]["reserved"] == 0


@pytest.mark.django_db(transaction=True)
def test_concurrent_reservations_never_exceed_quota_limit():
    prod, feat, _ = _setup_product_and_feature()
    _, v1 = create_package_with_version(
        product=prod, name="Strict100", slug="strict100", limits=[{"feature": feat, "limit_value": 100}]
    )
    u = provision_user({"iss": f"{ISSUER}-conc", "sub": "u-conc", "email": "conc@bdren.ai"})
    acct = u.accounts.get(account_type="personal")
    create_subscription(account=acct, package_version=v1)

    def worker(idx):
        try:
            reserve_quota(user=u, product=prod, feature=feat, quantity=30, idempotency_key=f"conc-{idx}")
            return "ok"
        except QuotaExceededError:
            return "exceeded"
        finally:
            connections.close_all()

    with ThreadPoolExecutor(max_workers=8) as ex:
        results = list(ex.map(worker, range(8)))

    # 8 threads * 30 = 240 requested against limit 100 -> exactly 3 succeed (90 reserved), 5 rejected!
    assert results.count("ok") == 3
    assert results.count("exceeded") == 5
    ctr = UsageCounter.objects.get(account=acct, feature=feat)
    assert ctr.reserved == 90


def test_admin_rbac_permissions(idp):
    c = Client()
    r = c.get("/api/v1/auth/login/")
    st = parse_qs(urlparse(r["Location"]).query)["state"][0]
    idp.token_response_claims = {"nonce": c.session["oidc_flow"]["nonce"], "sub": "u-rbac"}
    c.get("/api/v1/auth/callback/", {"code": "c", "state": st})
    u = User.objects.get(zitadel_subject="u-rbac")

    # Regular user without platform role -> 403 on all admin endpoints
    assert c.get("/api/v1/admin/summary/").status_code == 403
    assert c.get("/api/v1/admin/users/").status_code == 403

    # Assign PRODUCT_MANAGER role -> can access summary and catalog, but forbidden on user management (403)
    PlatformRoleAssignment.objects.create(user=u, role=PlatformRoleAssignment.Role.PRODUCT_MANAGER)
    assert c.get("/api/v1/admin/summary/").status_code == 200
    assert c.get("/api/v1/admin/users/").status_code == 403
    p_res = c.post(
        "/api/v1/admin/catalog/",
        data=json.dumps({"action": "create_product", "name": "Mailwizard", "slug": "mailwizard"}),
        content_type="application/json",
    )
    assert p_res.status_code == 201 and "api_key" in p_res.json()

    # Assign SUPER_ADMIN -> full access
    PlatformRoleAssignment.objects.create(user=u, role=PlatformRoleAssignment.Role.SUPER_ADMIN)
    assert c.get("/api/v1/admin/users/").status_code == 200
