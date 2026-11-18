"""Which plan a person uses (apps.entitlements): covered -> institution account, else a personal subscription, else
the product's BDREN free package; and the institution / coverage / plan_source that apps read to gate content."""
import json

import pytest
from django.test import Client

from apps.accounts.models import Account
from apps.organizations.models import Membership
from apps.packages.models import Package
from apps.packages.services import create_package_with_version
from apps.products.models import Feature, Product
from apps.subscriptions.services import create_subscription
from apps.usage.services import reserve_quota
from tests.factories import add_member, make_org, make_user

pytestmark = pytest.mark.django_db

CHECK = "/api/v1/entitlements/check/"
PLAN = "/api/v1/entitlements/plan/"


@pytest.fixture
def product():
    product = Product.objects.create(name="Synapse", slug="synapse")
    product.raw_key = product.rotate_api_key()
    return product


@pytest.fixture
def feature(product):
    feature = Feature.objects.create(product=product, key="tokens", name="Tokens")
    create_package_with_version(
        product=product, name="BDREN Free", slug="free", billing_interval=Package.BillingInterval.FREE,
        limits=[{"feature": feature, "limit_value": 100}],
    )
    return feature


@pytest.fixture
def org(product, feature):
    org = make_org("du", name="University of Dhaka", sign_in_domains=["du.ac.bd"])
    _, version = create_package_with_version(
        product=product, name="Institution", slug="institution", limits=[{"feature": feature, "limit_value": 1000}],
    )
    create_subscription(account=org.account, package_version=version)
    return org


def person(email, org=None, **kw):
    user = make_user(email)
    Account.objects.create(owner_user=user, account_type=Account.Type.PERSONAL)
    if org is not None:
        add_member(org, user, **kw)
    return user


def personal_plan(user, product, feature, limit=500):
    _, version = create_package_with_version(
        product=product, name="Pro", slug=f"pro-{user.id.hex[:8]}", price=500,
        limits=[{"feature": feature, "limit_value": limit}],
    )
    return create_subscription(account=user.accounts.get(account_type="personal"), package_version=version)


def check(product, user, **extra):
    body = {"product": "synapse", "feature": "tokens", "user_id": str(user.id), **extra}
    return Client().post(
        CHECK, json.dumps(body), content_type="application/json", HTTP_X_PRODUCT_API_KEY=product.raw_key
    )


def test_a_covered_member_uses_the_institution_package_without_the_app_naming_it(product, org):
    user = person("covered@du.ac.bd", org)
    body = check(product, user).json()
    assert (body["allowed"], body["account_type"], body["limit"]) == (True, "organization", 1000)
    assert body["plan"] == {
        "institution": {"slug": "du", "name": "University of Dhaka"}, "coverage": "institution",
        "membership_status": "active", "plan_source": "institution",
    }


def test_an_uncovered_member_falls_back_to_the_free_package(product, org):
    user = person("free@du.ac.bd", org, coverage=Membership.Coverage.NONE)
    body = check(product, user).json()
    assert (body["allowed"], body["account_type"], body["limit"]) == (True, "personal", 100)
    assert body["plan"]["plan_source"] == "free" and body["plan"]["coverage"] == "none"
    assert body["plan"]["institution"] == {"slug": "du", "name": "University of Dhaka"}

    r = check(product, user, organization_account_id=str(org.account.id))
    assert r.status_code == 403  # an institution account that does not cover them can't be asked for

    reservation = reserve_quota(
        user=user, product=product, feature=Feature.objects.get(key="tokens"), quantity=5, idempotency_key="k",
        organization_account=org.account,
    )
    assert reservation.account.account_type == Account.Type.PERSONAL  # the service drops the uncovered account


def test_a_personal_plan_wins_over_the_free_package(product, feature, org):
    user = person("paying@du.ac.bd", org, coverage=Membership.Coverage.NONE)
    personal_plan(user, product, feature)
    body = check(product, user).json()
    assert (body["account_type"], body["limit"], body["plan"]["plan_source"]) == ("personal", 500, "personal")


def test_someone_outside_every_institution(product, feature):
    user = person("solo@gmail.com")
    body = check(product, user).json()
    assert body["limit"] == 100
    assert body["plan"] == {"institution": None, "coverage": None, "membership_status": None, "plan_source": "free"}


def test_a_suspended_member_is_not_on_the_institution_package(product, org):
    user = person("s@du.ac.bd", org, status=Membership.Status.SUSPENDED)
    body = check(product, user).json()
    assert (body["account_type"], body["limit"]) == ("personal", 100)
    assert body["plan"]["plan_source"] == "free" and body["plan"]["membership_status"] == "suspended"


def test_an_organization_only_feature_needs_coverage(product, org):
    Feature.objects.filter(key="tokens").update(quota_policy=Feature.QuotaPolicy.ORGANIZATION_ONLY)
    covered = person("c@du.ac.bd", org)
    uncovered = person("u@du.ac.bd", org, coverage=Membership.Coverage.NONE)
    assert check(product, covered).json()["allowed"] is True
    assert check(product, uncovered).json()["allowed"] is False


def test_no_free_package_means_no_quota(product):
    Feature.objects.create(product=product, key="tokens", name="Tokens")
    body = check(product, person("solo@gmail.com")).json()
    assert body["allowed"] is False and body["plan"]["plan_source"] == "free"


def test_the_plan_endpoint(product, org):
    user = person("covered@du.ac.bd", org)
    s2s = Client(HTTP_X_PRODUCT_API_KEY=product.raw_key)
    assert s2s.get(PLAN, {"user_id": str(user.id)}).json()["plan_source"] == "institution"
    body = s2s.post(PLAN, json.dumps({"user_id": str(user.id), "product": "synapse"}), content_type="application/json")
    assert body.json()["institution"] == {"slug": "du", "name": "University of Dhaka"}
    assert Client().get(PLAN).status_code == 403
    assert Client(HTTP_X_PRODUCT_API_KEY="wrong").get(PLAN, {"user_id": str(user.id)}).status_code == 403

    browser = Client()
    browser.force_login(user)
    assert browser.get(PLAN).json()["coverage"] == "institution"
    current = browser.get("/api/v1/entitlements/current/").json()
    assert current["plan"]["plan_source"] == "institution" and len(current["entitlements"]) == 1

    Membership.objects.filter(user=user).update(coverage=Membership.Coverage.NONE)
    assert browser.get(PLAN).json()["plan_source"] == "free"
    assert browser.get("/api/v1/entitlements/current/").json()["entitlements"] == []


def test_a_covered_member_gets_the_free_package_for_an_app_the_institution_has_no_package_for(product, org):
    mindspear = Product.objects.create(name="Mindspear", slug="mindspear")
    mindspear.raw_key = mindspear.rotate_api_key()
    quizzes = Feature.objects.create(product=mindspear, key="quizzes", name="Quizzes")
    create_package_with_version(
        product=mindspear, name="BDREN Free", slug="mindspear-free", billing_interval=Package.BillingInterval.FREE,
        limits=[{"feature": quizzes, "limit_value": 7}],
    )
    user = person("covered@du.ac.bd", org)
    body = {"product": "mindspear", "feature": "quizzes", "user_id": str(user.id)}
    r = Client().post(
        CHECK, json.dumps(body), content_type="application/json", HTTP_X_PRODUCT_API_KEY=mindspear.raw_key
    ).json()
    assert (r["allowed"], r["account_type"], r["limit"]) == (True, "personal", 7)
    assert r["plan"]["plan_source"] == "free" and r["plan"]["coverage"] == "institution"

    reservation = reserve_quota(
        user=user, product=mindspear, feature=quizzes, quantity=1, idempotency_key="m-1",
        organization_account=org.account,
    )
    assert reservation.account.account_type == Account.Type.PERSONAL
    assert check(product, user).json()["plan"]["plan_source"] == "institution"
