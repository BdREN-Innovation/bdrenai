"""Configuration → Packages and Apps & features (docs/SUPERADMIN_API.md, Phase 2a)."""
from datetime import UTC, datetime
from decimal import Decimal

import pytest
from django.core.management import call_command
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import Client
from django.test.utils import CaptureQueriesContext

from apps.accounts.models import Account
from apps.administration.models import PlatformRoleAssignment
from apps.audit.models import AuditLog
from apps.entitlements.models import Entitlement
from apps.entitlements.services import current_period_bounds
from apps.packages import services as package_services
from apps.packages.models import Package, PackageLimit, PackageVersion
from apps.packages.services import create_package_with_version, publish_new_package_version
from apps.products.models import Feature, Product
from apps.subscriptions.models import Subscription
from apps.subscriptions.services import cancel_subscription, create_subscription
from tests.factories import add_member, make_org, make_user

pytestmark = pytest.mark.django_db

API = "/api/v1/superadmin/config/"
ALL_APPS = ["synapse", "mindspear", "mail-wizard", "quigen"]


@pytest.fixture
def boss():
    user = make_user("boss@bdren.ai", name="Platform Boss")
    PlatformRoleAssignment.objects.create(user=user, role=PlatformRoleAssignment.Role.SUPER_ADMIN)
    return user


@pytest.fixture
def client(boss):
    c = Client()
    c.force_login(boss)
    return c


@pytest.fixture
def catalog():
    call_command("seed_bdren_catalog")
    return {p.slug: p for p in Product.objects.all()}


def feature(slug, key):
    return Feature.objects.get(product__slug=slug, key=key)


def get(c, path, **params):
    return c.get(API + path, params)


def post(c, path, body=None):
    return c.post(API + path, body or {}, content_type="application/json")


def patch(c, path, body):
    return c.patch(API + path, body, content_type="application/json")


def error(r):
    return r.status_code, r.json()["error"]


def last_audit(action):
    return AuditLog.objects.filter(action=action).order_by("-created_at").first()


def single_draft(**over):
    draft = {
        "kind": "single", "app": "synapse", "name": "Synapse Standard", "slug": "standard",
        "description": "For most offices.", "audience": "Offices up to 100 people", "is_public": True,
        "highlight": True, "sort_order": 2, "price": "1500.00", "currency": "BDT", "billing_interval": "monthly",
        "price_unit": "per_seat", "trial_days": 14, "seat_limit": 100,
        "limits": [
            {"feature_id": str(feature("synapse", "api_requests").id), "limit_value": 5000,
             "limit_period": "weekly", "on_limit": "warn"},
        ],
    }
    return {**draft, **over}


def bundle_draft(**over):
    draft = {
        "kind": "bundle", "apps": ALL_APPS, "name": "BdREN AI Suite", "slug": "suite",
        "price": "4500.00", "billing_interval": "monthly", "price_unit": "per_institution", "trial_days": 0,
        "seat_limit": None,
        "limits": [
            {"feature_id": str(feature("synapse", "api_requests").id), "limit_value": 9000, "limit_period": "monthly"},
            {"feature_id": str(feature("mindspear", "ai_requests").id), "limit_value": 7000, "limit_period": "daily"},
        ],
    }
    return {**draft, **over}


def create(c, draft):
    r = post(c, "packages/", draft)
    assert r.status_code == 201, r.json()
    return r.json()


def subscribe(org_slug, package_id):
    org = make_org(org_slug, name=f"Institution {org_slug}")
    return create_subscription(account=org.account, package=Package.objects.get(pk=package_id))


# ---------------------------------------------------------------- permissions

def test_every_config_endpoint_needs_a_signed_in_superadmin(catalog):
    pkg = Package.objects.filter(product__slug="synapse").first()
    feat = feature("synapse", "api_requests")
    endpoints = [
        ("get", "apps/"), ("patch", "apps/synapse/"), ("post", "apps/synapse/features/"),
        ("patch", f"features/{feat.id}/"), ("get", "packages/"), ("post", "packages/"),
        ("get", f"packages/{pkg.id}/"), ("patch", f"packages/{pkg.id}/"), ("post", f"packages/{pkg.id}/preview/"),
        ("post", f"packages/{pkg.id}/versions/"), ("post", f"packages/{pkg.id}/archive/"),
        ("post", f"packages/{pkg.id}/restore/"),
    ]
    org = make_org("du")
    admin = add_member(org, role="admin").user
    support = make_user("support@bdren.ai")
    PlatformRoleAssignment.objects.create(user=support, role=PlatformRoleAssignment.Role.SUPPORT_ADMIN)
    audit_before = AuditLog.objects.count()

    for method, path in endpoints:
        anonymous = getattr(Client(), method)(API + path, {"reason": "x"}, content_type="application/json")
        assert error(anonymous) == (401, "not_authenticated"), (method, path)
        for user in (admin, support):
            c = Client()
            c.force_login(user)
            r = getattr(c, method)(API + path, {"reason": "x"}, content_type="application/json")
            assert error(r) == (403, "not_superadmin"), (method, path)

    assert AuditLog.objects.count() == audit_before
    assert Package.objects.get(pk=pkg.pk).status == Package.Status.ACTIVE


# ---------------------------------------------------------------- seed and data migration

def test_seed_ensures_the_four_website_apps_and_is_idempotent():
    call_command("seed_bdren_catalog")
    Product.objects.filter(slug="quigen").update(name="QuiGen Edited")
    call_command("seed_bdren_catalog")
    apps = list(Product.objects.order_by("sort_order").values_list("slug", "name"))
    assert apps == [("synapse", "Synapse"), ("mindspear", "Mindspear"), ("mail-wizard", "AI Mail Wizard"),
                    ("quigen", "QuiGen Edited")]
    assert Product.objects.get(slug="synapse").description.startswith("BdREN's AI workspace")
    assert Package.objects.count() == 5 and PackageVersion.objects.count() == 5
    assert not Feature.objects.filter(product__slug__in=["mail-wizard", "quigen"]).exists()


def test_seed_refreshes_an_outdated_description_but_keeps_edits():
    Product.objects.create(slug="synapse", name="Synapse",
                           description="Scientific workflow automation and data integration hub for campus labs.")
    Product.objects.create(slug="mindspear", name="Mindspear", description="Our own words.")
    call_command("seed_bdren_catalog")
    assert Product.objects.get(slug="synapse").description.startswith("BdREN's AI workspace")
    assert Product.objects.get(slug="mindspear").description == "Our own words."


@pytest.mark.django_db(transaction=True)
def test_data_migration_fills_snapshots_of_existing_versions():
    executor = MigrationExecutor(connection)
    before = [("products", "0001_initial"), ("packages", "0001_initial")]
    executor.migrate(before)
    old = executor.loader.project_state(before).apps
    product = old.get_model("products", "Product").objects.create(name="Mindspear", slug="mindspear")
    package = old.get_model("packages", "Package").objects.create(
        product_id=product.id, name="Pro", slug="pro", price=Decimal("1500.00"), currency="BDT",
        billing_interval="yearly", trial_days=14,
    )
    old_version = old.get_model("packages", "PackageVersion")
    v1 = old_version.objects.create(package_id=package.id, version=1)
    v2 = old_version.objects.create(package_id=package.id, version=2)

    executor = MigrationExecutor(connection)
    executor.loader.build_graph()
    executor.migrate(executor.loader.graph.leaf_nodes())

    for version in PackageVersion.objects.filter(pk__in=[v1.id, v2.id]):
        assert (version.price, version.currency, version.billing_interval, version.trial_days) == (
            Decimal("1500.00"), "BDT", "yearly", 14)
        assert version.price_unit == "per_seat" and version.seat_limit is None
        assert [p.slug for p in version.products.all()] == ["mindspear"]
    migrated = Package.objects.get(pk=package.id)
    assert migrated.kind == "single" and migrated.is_public and not migrated.highlight


# ---------------------------------------------------------------- create

def test_create_single_package(client, boss, catalog):
    body = create(client, single_draft())
    assert body["kind"] == "single" and body["slug"] == "standard"
    assert body["apps"] == [{"slug": "synapse", "name": "Synapse"}]
    assert (body["price"], body["currency"], body["billing_interval"], body["price_unit"]) == (
        "1500.00", "BDT", "monthly", "per_seat")
    assert (body["trial_days"], body["seat_limit"], body["current_version"], body["subscribers"]) == (14, 100, 1, 0)
    assert (body["audience"], body["is_public"], body["highlight"], body["sort_order"]) == (
        "Offices up to 100 people", True, True, 2)
    assert body["description"] == "For most offices."
    assert body["limits"] == [{
        "feature": {"id": str(feature("synapse", "api_requests").id), "key": "api_requests", "name": "API Calls",
                    "unit": "calls", "app": {"slug": "synapse", "name": "Synapse"}},
        "limit_value": 5000, "limit_period": "weekly", "on_limit": "warn",
    }]
    [v1] = body["versions"]
    assert v1["version"] == 1 and v1["created_by"] == {"id": str(boss.id), "name": "Platform Boss",
                                                       "email": "boss@bdren.ai"}
    assert v1["subscribers"] == 0 and v1["limits"] == body["limits"]

    pkg = Package.objects.get(pk=body["id"])
    assert pkg.price == Decimal("1500.00") and pkg.product.slug == "synapse"
    entry = last_audit("package.created")
    assert entry.actor == boss and entry.metadata["package_id"] == body["id"] and entry.ip_address


def test_create_bundle_package(client, catalog):
    body = create(client, bundle_draft())
    assert body["kind"] == "bundle"
    assert [a["slug"] for a in body["apps"]] == ALL_APPS
    assert [lim["feature"]["app"]["slug"] for lim in body["limits"]] == ["synapse", "mindspear"]
    assert body["seat_limit"] is None and body["price_unit"] == "per_institution"
    assert Package.objects.get(pk=body["id"]).product is None


def test_slugs_are_unique_per_app_and_among_bundles(client, catalog):
    create(client, single_draft())
    assert error(post(client, "packages/", single_draft())) == (409, "slug_taken")
    create(client, single_draft(app="mindspear", limits=[]))
    create(client, bundle_draft(slug="standard"))
    assert error(post(client, "packages/", bundle_draft(slug="standard"))) == (409, "slug_taken")


@pytest.mark.parametrize("over, fields", [
    ({"kind": "triple"}, ["kind"]),
    ({"app": "nope"}, ["app"]),
    ({"app": None}, ["app"]),
    ({"apps": ["synapse", "mindspear"]}, ["apps"]),
    ({"name": ""}, ["name"]),
    ({"slug": "Not A Slug"}, ["slug"]),
    ({"price": "-1"}, ["price"]),
    ({"price": "12.345"}, ["price"]),
    ({"price": "0"}, ["price"]),
    ({"billing_interval": "free"}, ["price"]),
    ({"billing_interval": "weekly"}, ["billing_interval"]),
    ({"price_unit": "per_head"}, ["price_unit"]),
    ({"currency": "taka"}, ["currency"]),
    ({"trial_days": -1}, ["trial_days"]),
    ({"seat_limit": 0}, ["seat_limit"]),
    ({"is_public": "yes"}, ["is_public"]),
    ({"sort_order": "1"}, ["sort_order"]),
    ({"limits": "none"}, ["limits"]),
    ({"limits": [{"feature_id": "x", "limit_value": -5, "limit_period": "hourly", "on_limit": "stop"}]},
     ["limits.0.feature_id", "limits.0.limit_value", "limits.0.limit_period", "limits.0.on_limit"]),
])
def test_single_draft_validation(client, catalog, over, fields):
    r = post(client, "packages/", single_draft(**over))
    assert error(r) == (400, "invalid")
    assert sorted(r.json()["fields"]) == sorted(fields)
    assert not Package.objects.filter(slug="standard").exists()


def test_free_package_costs_nothing(client, catalog):
    body = create(client, single_draft(billing_interval="free", price="0", trial_days=0))
    assert body["price"] == "0.00" and body["billing_interval"] == "free"


def test_duplicate_feature_in_limits(client, catalog):
    limit = {"feature_id": str(feature("synapse", "api_requests").id), "limit_value": 1}
    r = post(client, "packages/", single_draft(limits=[limit, limit]))
    assert error(r) == (400, "invalid") and list(r.json()["fields"]) == ["limits.1.feature_id"]


def test_limit_feature_must_belong_to_an_included_app(client, catalog):
    other = {"feature_id": str(feature("mindspear", "ai_requests").id), "limit_value": 1}
    r = post(client, "packages/", single_draft(limits=[other]))
    assert error(r) == (400, "feature_not_in_package") and list(r.json()["fields"]) == ["limits.0.feature_id"]
    r = post(client, "packages/", bundle_draft(apps=["synapse", "quigen"]))
    assert error(r) == (400, "feature_not_in_package") and list(r.json()["fields"]) == ["limits.1.feature_id"]


def test_bundle_needs_two_active_apps(client, catalog):
    for apps in (["synapse"], ["synapse", "synapse"], [], "synapse", ["synapse", "unknown"]):
        r = post(client, "packages/", bundle_draft(apps=apps, limits=[]))
        assert error(r) == (400, "invalid") and "apps" in r.json()["fields"], apps
    Product.objects.filter(slug="quigen").update(status=Product.Status.INACTIVE)
    r = post(client, "packages/", bundle_draft(apps=["synapse", "quigen"], limits=[]))
    assert r.json()["fields"] == {"apps": "Only active apps can be included: quigen."}
    r = post(client, "packages/", bundle_draft(app="synapse"))
    assert error(r) == (400, "invalid") and "app" in r.json()["fields"]


# ---------------------------------------------------------------- list

def test_list_order_and_filters(client, catalog):
    suite = create(client, bundle_draft())
    pair = create(client, bundle_draft(slug="pair", name="Mind and Mail", apps=["mindspear", "mail-wizard"],
                                       limits=[]))
    standard = create(client, single_draft())

    rows = get(client, "packages/", page_size=100).json()
    names = [r["name"] for r in rows["results"]]
    assert rows["count"] == 8
    assert names[:2] == ["BdREN AI Suite", "Mind and Mail"]
    assert names[2:5] == ["Synapse Community", "Synapse Lab Pro", "Synapse Standard"]
    assert [r["kind"] for r in rows["results"]][5:] == ["single"] * 3

    def ids(**params):
        return [r["id"] for r in get(client, "packages/", **params).json()["results"]]

    assert ids(kind="bundle") == [suite["id"], pair["id"]]
    synapse = ids(app="synapse")
    assert synapse[0] == suite["id"] and standard["id"] in synapse and pair["id"] not in synapse
    assert ids(app="mail-wizard") == [suite["id"], pair["id"]]
    assert ids(q="suite") == [suite["id"]]
    assert error(get(client, "packages/", kind="combo")) == (400, "invalid")

    post(client, f"packages/{pair['id']}/archive/", {"reason": "Not selling it"})
    assert pair["id"] not in ids()
    assert ids(status="archived") == [pair["id"]]


def test_list_row_shape(client, catalog):
    create(client, single_draft())
    row = next(r for r in get(client, "packages/", q="standard").json()["results"])
    assert set(row) == {"id", "kind", "name", "slug", "status", "audience", "is_public", "highlight", "sort_order",
                        "apps", "price", "currency", "billing_interval", "price_unit", "trial_days", "seat_limit",
                        "current_version", "subscribers", "updated_at"}


def test_list_query_count_does_not_grow_with_rows(client, catalog):
    for i in range(3):
        create(client, bundle_draft(slug=f"suite-{i}"))
    subscribe("du", Package.objects.get(slug="lab-pro").pk)
    with CaptureQueriesContext(connection) as small:
        assert get(client, "packages/", page_size=2).status_code == 200
    with CaptureQueriesContext(connection) as large:
        assert get(client, "packages/", page_size=100).json()["count"] == 8
    assert len(large) == len(small) <= 8


def test_list_counts_live_subscribers(client, catalog):
    pkg = Package.objects.get(slug="lab-pro")
    subscribe("du", pkg.pk)
    gone = subscribe("buet", pkg.pk)
    cancel_subscription(subscription=gone)
    row = next(r for r in get(client, "packages/", app="synapse").json()["results"] if r["id"] == str(pkg.id))
    assert row["subscribers"] == 1


# ---------------------------------------------------------------- detail and presentation

def test_detail_lists_versions_newest_first(client, catalog):
    pkg = create(client, single_draft())
    subscribe("du", pkg["id"])
    r = post(client, f"packages/{pkg['id']}/versions/", {
        "price": "1800.00", "change_reason": "Price review", "migration_policy": "new_only",
    })
    assert r.status_code == 201
    detail = get(client, f"packages/{pkg['id']}/").json()
    assert [v["version"] for v in detail["versions"]] == [2, 1]
    assert [v["subscribers"] for v in detail["versions"]] == [0, 1]
    assert detail["versions"][0]["change_reason"] == "Price review"
    assert detail["versions"][1]["price"] == "1500.00" and detail["price"] == "1800.00"
    assert detail["current_version"] == 2 and detail["subscribers"] == 1
    assert error(get(client, "packages/00000000-0000-0000-0000-000000000000/")) == (404, "not_found")


def test_presentation_patch_needs_no_new_version(client, boss, catalog):
    pkg = create(client, single_draft())
    r = patch(client, f"packages/{pkg['id']}/", {"name": "Synapse Plus", "highlight": False, "audience": "Teams"})
    assert r.status_code == 200
    body = r.json()
    assert (body["name"], body["highlight"], body["audience"], body["current_version"]) == (
        "Synapse Plus", False, "Teams", 1)
    entry = last_audit("package.updated")
    assert entry.metadata["changes"]["name"] == ["Synapse Standard", "Synapse Plus"]
    assert entry.metadata["package_id"] == pkg["id"]


@pytest.mark.parametrize("body", [{"price": "1.00"}, {"limits": []}, {"apps": ["synapse"]}, {"seat_limit": 5},
                                  {"trial_days": 3}, {"billing_interval": "yearly"}])
def test_presentation_patch_refuses_commercial_fields(client, catalog, body):
    pkg = create(client, single_draft())
    assert error(patch(client, f"packages/{pkg['id']}/", {"name": "X Y", **body})) == (400, "use_new_version")
    assert Package.objects.get(pk=pkg["id"]).name == "Synapse Standard"


def test_presentation_patch_refuses_kind_and_slug(client, catalog):
    pkg = create(client, single_draft())
    r = patch(client, f"packages/{pkg['id']}/", {"slug": "other", "kind": "bundle"})
    assert error(r) == (400, "invalid") and sorted(r.json()["fields"]) == ["kind", "slug"]


# ---------------------------------------------------------------- preview

def test_preview_reports_changes_and_affected_subscriptions(client, catalog):
    pkg = create(client, single_draft())
    du = subscribe("du", pkg["id"])
    buet = subscribe("buet", pkg["id"])
    cancel_subscription(subscription=buet)
    person = make_user("solo@example.com", name="Solo Person")
    account, _ = Account.objects.get_or_create(account_type=Account.Type.PERSONAL, owner_user=person)
    personal = create_subscription(account=account, package=Package.objects.get(pk=pkg["id"]))
    versions_before = PackageVersion.objects.count()

    integrations = {"feature_id": str(feature("synapse", "integrations").id), "limit_value": 10}
    r = post(client, f"packages/{pkg['id']}/preview/", {
        "price": "1800", "seat_limit": None, "limits": [integrations],
    })
    assert r.status_code == 200, r.json()
    changes = r.json()["changes"]
    assert changes[:2] == [
        {"field": "price", "from": "1500.00", "to": "1800.00"},
        {"field": "seat_limit", "from": 100, "to": None},
    ]
    assert changes[2]["feature"]["key"] == "integrations" and changes[2]["from"] is None
    assert changes[2]["to"] == {"limit_value": 10, "limit_period": "monthly", "on_limit": "block"}
    assert changes[3] == {
        "field": "limit",
        "feature": {"id": str(feature("synapse", "api_requests").id), "key": "api_requests", "name": "API Calls",
                    "unit": "calls", "app": {"slug": "synapse", "name": "Synapse"}},
        "from": {"limit_value": 5000, "limit_period": "weekly", "on_limit": "warn"},
        "to": None,
    }
    affected = r.json()["affected"]
    assert affected["subscriptions"] == 2
    assert affected["institutions"] == [
        {"slug": "du", "name": "Institution du", "subscription_id": str(du.id), "status": "active"},
        {"slug": None, "name": "Solo Person", "subscription_id": str(personal.id), "status": "active"},
    ]
    assert PackageVersion.objects.count() == versions_before


def test_preview_of_a_bundle_reports_app_and_limit_changes(client, catalog):
    pkg = create(client, bundle_draft())
    mindspear_limit = {"feature_id": str(feature("mindspear", "ai_requests").id), "limit_value": 7000,
                       "limit_period": "daily", "on_limit": "warn"}
    r = post(client, f"packages/{pkg['id']}/preview/", {
        "price": "5000", "apps": ["synapse", "mindspear", "mail-wizard"], "limits": [mindspear_limit],
    })
    changes = r.json()["changes"]
    assert changes[0] == {"field": "price", "from": "4500.00", "to": "5000.00"}
    assert changes[1] == {"field": "apps", "added": [], "removed": [{"slug": "quigen", "name": "QuiGen"}]}
    by_feature = {c["feature"]["key"]: c for c in changes[2:]}
    assert by_feature["ai_requests"]["from"] == {"limit_value": 7000, "limit_period": "daily", "on_limit": "block"}
    assert by_feature["ai_requests"]["to"] == {"limit_value": 7000, "limit_period": "daily", "on_limit": "warn"}
    assert by_feature["api_requests"]["to"] is None
    assert r.json()["affected"] == {"subscriptions": 0, "institutions": []}


def test_preview_of_an_unchanged_draft_is_empty(client, catalog):
    pkg = create(client, single_draft())
    r = post(client, f"packages/{pkg['id']}/preview/", single_draft())
    assert r.json() == {"changes": [], "affected": {"subscriptions": 0, "institutions": []}}
    r = post(client, f"packages/{pkg['id']}/preview/", {})
    assert r.json()["changes"] == []


def test_preview_validates_the_draft(client, catalog):
    pkg = create(client, single_draft())
    assert error(post(client, f"packages/{pkg['id']}/preview/", {"app": "mindspear"})) == (400, "invalid")
    assert error(post(client, f"packages/{pkg['id']}/preview/", {"billing_interval": "free"})) == (400, "invalid")
    bundle = create(client, bundle_draft())
    r = post(client, f"packages/{bundle['id']}/preview/", {"apps": ["mindspear", "quigen"]})
    assert error(r) == (400, "feature_not_in_package")


# ---------------------------------------------------------------- publish

def _limit_of(subscription, key):
    return Entitlement.objects.get(source_subscription=subscription, feature__key=key).limit


def _new_limit(value):
    return [{"feature_id": str(feature("synapse", "api_requests").id), "limit_value": value,
             "limit_period": "weekly", "on_limit": "warn"}]


@pytest.fixture
def subscribed(client, catalog):
    pkg = create(client, single_draft())
    return pkg, subscribe("du", pkg["id"]), subscribe("buet", pkg["id"])


def publish(client, pkg, **body):
    return post(client, f"packages/{pkg['id']}/versions/", {"change_reason": "More calls", **body})


def test_publish_new_only(client, boss, subscribed):
    pkg, du, buet = subscribed
    r = publish(client, pkg, limits=_new_limit(8000), seat_limit=150, migration_policy="new_only")
    assert r.status_code == 201
    body = r.json()
    assert (body["migrated"], body["scheduled"]) == (0, 0)
    assert body["package"]["current_version"] == 2 and body["package"]["seat_limit"] == 150
    du.refresh_from_db()
    assert du.package_version.version == 1 and _limit_of(du, "api_requests") == 5000
    version = PackageVersion.objects.get(package_id=pkg["id"], version=2)
    assert version.created_by == boss and version.change_reason == "More calls"
    entry = last_audit("package.version_published")
    assert entry.metadata["package_id"] == pkg["id"] and entry.metadata["reason"] == "More calls"


def test_publish_immediate(client, subscribed):
    pkg, du, buet = subscribed
    body = publish(client, pkg, limits=_new_limit(8000), migration_policy="immediate").json()
    assert body["migrated"] == 2
    for sub in (du, buet):
        sub.refresh_from_db()
        assert sub.package_version.version == 2 and _limit_of(sub, "api_requests") == 8000


def test_publish_on_renewal(client, subscribed):
    pkg, du, _ = subscribed
    body = publish(client, pkg, price="2000", migration_policy="on_renewal").json()
    assert (body["migrated"], body["scheduled"]) == (0, 2)
    du.refresh_from_db()
    assert du.package_version.version == 1 and du.pending_package_version.version == 2
    assert Package.objects.get(pk=pkg["id"]).price == Decimal("2000.00")


def test_publish_selected_only(client, subscribed):
    pkg, du, buet = subscribed
    body = publish(client, pkg, limits=_new_limit(9000), migration_policy="selected_only",
                   selected_subscriptions=[str(du.id)]).json()
    assert body["migrated"] == 1
    du.refresh_from_db()
    buet.refresh_from_db()
    assert du.package_version.version == 2 and buet.package_version.version == 1


def test_publish_selected_only_needs_live_subscriptions_of_the_package(client, subscribed, catalog):
    pkg, du, _ = subscribed
    other = subscribe("cu", Package.objects.get(slug="lab-pro").pk)
    for selected in (None, [], ["nope"], [str(other.id)]):
        r = publish(client, pkg, limits=_new_limit(9000), migration_policy="selected_only",
                    selected_subscriptions=selected)
        assert error(r) == (400, "invalid") and "selected_subscriptions" in r.json()["fields"]
    assert PackageVersion.objects.filter(package_id=pkg["id"]).count() == 1


def test_publish_needs_a_reason_a_policy_and_a_change(client, subscribed):
    pkg, _, _ = subscribed
    r = post(client, f"packages/{pkg['id']}/versions/", {"price": "2000", "migration_policy": "new_only"})
    assert error(r) == (400, "invalid") and list(r.json()["fields"]) == ["change_reason"]
    r = publish(client, pkg, price="2000", change_reason="   ", migration_policy="new_only")
    assert list(r.json()["fields"]) == ["change_reason"]
    r = publish(client, pkg, price="2000", migration_policy="later")
    assert list(r.json()["fields"]) == ["migration_policy"]
    assert error(publish(client, pkg, **single_draft(), migration_policy="immediate")) == (400, "no_changes")
    assert PackageVersion.objects.filter(package_id=pkg["id"]).count() == 1


def test_publish_bundle_apps_change(client, catalog):
    pkg = create(client, bundle_draft())
    body = publish(client, pkg, apps=["synapse", "mindspear"], migration_policy="new_only").json()
    assert [a["slug"] for a in body["package"]["apps"]] == ["synapse", "mindspear"]
    assert [a["slug"] for a in body["package"]["versions"][1]["apps"]] == ALL_APPS


def test_new_bundle_version_keeps_an_app_that_became_inactive(client, catalog):
    pkg = create(client, bundle_draft(apps=["synapse", "mindspear", "quigen"]))
    Product.objects.filter(slug="quigen").update(status=Product.Status.INACTIVE)
    body = publish(client, pkg, apps=["synapse", "mindspear", "quigen"], price="5000.00",
                   migration_policy="new_only").json()
    assert body["package"]["price"] == "5000.00"
    assert [a["slug"] for a in body["package"]["apps"]] == ["synapse", "mindspear", "quigen"]
    Product.objects.filter(slug="mail-wizard").update(status=Product.Status.INACTIVE)
    r = publish(client, pkg, apps=["synapse", "mail-wizard"], migration_policy="new_only")
    assert r.json()["fields"] == {"apps": "Only active apps can be included: mail-wizard."}


# ---------------------------------------------------------------- archive and restore

def test_archive_and_restore(client, boss, catalog):
    pkg = create(client, single_draft())
    sub = subscribe("du", pkg["id"])
    assert error(post(client, f"packages/{pkg['id']}/archive/", {})) == (400, "invalid")
    r = post(client, f"packages/{pkg['id']}/archive/", {"reason": "Replaced by Plus"})
    assert r.status_code == 200 and r.json()["status"] == "archived"
    assert last_audit("package.archived").metadata == {"package_id": pkg["id"], "reason": "Replaced by Plus"}
    assert error(post(client, f"packages/{pkg['id']}/archive/", {"reason": "again"})) == (409, "already_archived")
    sub.refresh_from_db()
    assert sub.status == Subscription.Status.ACTIVE

    r = post(client, f"packages/{pkg['id']}/restore/", {"reason": "Back on sale"})
    assert r.json()["status"] == "active" and last_audit("package.restored").actor == boss
    assert error(post(client, f"packages/{pkg['id']}/restore/", {"reason": "x"})) == (409, "not_archived")


def test_create_package_reports_a_slug_race_as_taken(client, catalog, monkeypatch):
    create(client, single_draft())
    create(client, bundle_draft())
    monkeypatch.setattr(package_services, "_check_slug", lambda draft: None)
    assert error(post(client, "packages/", single_draft())) == (409, "slug_taken")
    assert error(post(client, "packages/", bundle_draft())) == (409, "slug_taken")
    assert Package.objects.filter(slug__in=["standard", "suite"]).count() == 2


# ---------------------------------------------------------------- apps and features

def test_apps_list(client, catalog):
    create(client, bundle_draft())
    create(client, single_draft())
    results = get(client, "apps/").json()["results"]
    assert [a["slug"] for a in results] == ALL_APPS
    synapse, _, _, quigen = results
    assert synapse["packages"] == {"single": 3, "bundle": 1}
    assert quigen["packages"] == {"single": 0, "bundle": 1} and quigen["features"] == []
    used = {f["key"]: f["in_use"] for f in synapse["features"]}
    assert used["api_requests"] is True
    assert set(synapse["features"][0]) == {"id", "key", "name", "unit", "description", "quota_policy", "status",
                                          "in_use"}


def test_update_app(client, boss, catalog):
    r = patch(client, "apps/quigen/", {"name": "QuiGen Quizzes", "sort_order": 9, "description": "Quizzes."})
    assert r.status_code == 200 and (r.json()["name"], r.json()["sort_order"]) == ("QuiGen Quizzes", 9)
    entry = last_audit("product.updated")
    assert entry.metadata["product_id"] == str(catalog["quigen"].id) and entry.actor == boss
    assert error(patch(client, "apps/quigen/", {"status": "gone"})) == (400, "invalid")
    assert error(patch(client, "apps/nope/", {"name": "Nope"})) == (404, "not_found")


def test_create_feature(client, catalog):
    body = {"key": "quizzes", "name": "Quizzes generated", "unit": "quizzes", "quota_policy": "organization_only"}
    r = post(client, "apps/quigen/features/", body)
    assert r.status_code == 201
    assert r.json() | {"id": None} == {"id": None, "key": "quizzes", "name": "Quizzes generated", "unit": "quizzes",
                                       "description": "", "quota_policy": "organization_only", "status": "active",
                                       "in_use": False}
    assert last_audit("feature.created").metadata["product_id"] == str(catalog["quigen"].id)
    assert error(post(client, "apps/quigen/features/", body)) == (409, "key_taken")
    r = post(client, "apps/quigen/features/", {"key": "Bad-Key", "name": "", "unit": ""})
    assert error(r) == (400, "invalid") and sorted(r.json()["fields"]) == ["key", "name", "unit"]


def test_feature_in_use_keeps_key_and_unit(client, catalog):
    used = feature("synapse", "api_requests")
    for body in ({"key": "calls"}, {"unit": "requests"}):
        assert error(patch(client, f"features/{used.id}/", body)) == (409, "feature_in_use")
    r = patch(client, f"features/{used.id}/", {"name": "API calls", "status": "inactive", "key": "api_requests"})
    assert r.status_code == 200 and (r.json()["name"], r.json()["status"], r.json()["in_use"]) == (
        "API calls", "inactive", True)
    assert last_audit("feature.updated").metadata["changes"] == {"name": ["API Calls", "API calls"],
                                                                 "status": ["active", "inactive"]}


def test_feature_not_in_use_can_change_key_and_unit(client, catalog):
    free = Feature.objects.create(product=catalog["quigen"], key="quizzes", name="Quizzes", unit="quizzes")
    Feature.objects.create(product=catalog["quigen"], key="taken", name="Taken", unit="x")
    r = patch(client, f"features/{free.id}/", {"key": "quiz_runs", "unit": "runs"})
    assert r.status_code == 200 and (r.json()["key"], r.json()["unit"]) == ("quiz_runs", "runs")
    assert error(patch(client, f"features/{free.id}/", {"key": "taken"})) == (409, "key_taken")
    assert error(patch(client, "features/00000000-0000-0000-0000-000000000000/", {"name": "X Y"})) == (
        404, "not_found")


def test_feature_key_race_is_reported_as_taken(client, catalog, monkeypatch):
    body = {"key": "quizzes", "name": "Quizzes", "unit": "quizzes"}
    assert post(client, "apps/quigen/features/", body).status_code == 201
    other = Feature.objects.create(product=catalog["quigen"], key="runs", name="Runs", unit="runs")
    monkeypatch.setattr(package_services, "_check_key", lambda *args, **kwargs: None)
    assert error(post(client, "apps/quigen/features/", body)) == (409, "key_taken")
    assert error(patch(client, f"features/{other.id}/", {"key": "quizzes"})) == (409, "key_taken")
    assert Feature.objects.filter(product=catalog["quigen"], key="quizzes").count() == 1


# ---------------------------------------------------------------- public catalog and compatibility

def test_public_catalog_hides_archived_and_hidden_packages_and_lists_bundles(client, catalog):
    suite = create(client, bundle_draft())
    hidden = create(client, single_draft(is_public=False))
    archived = Package.objects.get(slug="lab-pro")
    post(client, f"packages/{archived.id}/archive/", {"reason": "Old"})

    body = Client().get("/api/v1/catalog/products/").json()
    assert [p["slug"] for p in body["products"]] == ALL_APPS
    synapse = body["products"][0]
    assert [p["slug"] for p in synapse["packages"]] == ["community"]
    assert hidden["id"] not in {p["id"] for p in synapse["packages"]}
    [bundle] = body["bundles"]
    assert bundle["id"] == suite["id"] and bundle["price"] == "4500.00"
    assert [a["slug"] for a in bundle["apps"]] == ALL_APPS
    assert {lim["feature_key"] for lim in bundle["limits"]} == {"api_requests", "ai_requests"}


def test_public_catalog_leaves_out_apps_that_are_not_active(client, catalog):
    create(client, bundle_draft())
    create(client, bundle_draft(slug="pair", name="Pair", apps=["synapse", "mindspear"]))
    patch(client, "apps/mindspear/", {"status": "archived"})
    body = Client().get("/api/v1/catalog/products/").json()
    assert "mindspear" not in [p["slug"] for p in body["products"]]
    [suite] = body["bundles"]
    assert [a["slug"] for a in suite["apps"]] == ["synapse", "mail-wizard", "quigen"]
    assert {lim["feature_key"] for lim in suite["limits"]} == {"api_requests"}


def test_single_packages_of_an_app_that_is_not_active_cannot_be_subscribed(client, catalog):
    pkg = create(client, single_draft(billing_interval="free", price="0", trial_days=0, limits=[]))
    patch(client, "apps/synapse/", {"status": "inactive"})
    buyer = make_user("buyer@du.ac.bd")
    account, _ = Account.objects.get_or_create(account_type=Account.Type.PERSONAL, owner_user=buyer)
    c = Client()
    c.force_login(buyer)
    r = c.post("/api/v1/catalog/subscribe/", {"package_id": pkg["id"], "account_id": str(account.id)},
               content_type="application/json")
    assert (r.status_code, r.json()["error"]) == (404, "package_not_found")
    assert not Subscription.objects.exists()


def test_bundles_are_subscribed_through_billing_not_the_self_service_catalog(client, catalog):
    """Combined packages are sold per institution through billing (bKash checkout or a payment recorded by a
    superadmin), so a subscription to one now covers each of its apps. The self-service catalog endpoint stays
    single-package only: a bundle id there is still `package_not_found`."""
    suite = create(client, bundle_draft())
    buyer = make_user("buyer@du.ac.bd")
    account, _ = Account.objects.get_or_create(account_type=Account.Type.PERSONAL, owner_user=buyer)
    c = Client()
    c.force_login(buyer)
    r = c.post("/api/v1/catalog/subscribe/", {"package_id": suite["id"], "account_id": str(account.id)},
               content_type="application/json")
    assert (r.status_code, r.json()["error"]) == (404, "package_not_found")
    assert not Subscription.objects.exists()

    sub = subscribe("sau", suite["id"])
    assert sub.product_id is None and sub.status == Subscription.Status.ACTIVE
    covered = set(Entitlement.objects.filter(source_subscription=sub).values_list("product__slug", flat=True))
    assert covered == {"synapse", "mindspear"}


def test_legacy_publish_carries_the_previous_terms(catalog):
    pkg, v1 = create_package_with_version(
        product=catalog["quigen"], name="QuiGen Pro", slug="pro", price=900, trial_days=7, seat_limit=20,
        limits=[],
    )
    v2, _ = publish_new_package_version(package=pkg, limits=[])
    assert (v2.price, v2.trial_days, v2.seat_limit) == (Decimal("900.00"), 7, 20)
    assert [p.slug for p in v2.products.all()] == ["quigen"]


def test_weekly_limits_reset_on_monday():
    start, end = current_period_bounds(PackageLimit.Period.WEEKLY, datetime(2026, 11, 18, 15, tzinfo=UTC))
    assert start == datetime(2026, 11, 16, tzinfo=UTC) and (end - start).days == 7
