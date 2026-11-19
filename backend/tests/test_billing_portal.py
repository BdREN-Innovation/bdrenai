"""Institution console billing (docs/BILLING_API.md "Portal API additions" / "Portal errors and shapes"), scheduled
downgrades, combined-package subscriptions, the end-of-period reminder and the PaymentRecord data migration."""
from datetime import timedelta
from decimal import Decimal
from io import StringIO

import pytest
from django.core.management import call_command
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import Client
from django.utils import timezone

from apps.accounts.models import Account
from apps.billing import services as billing
from apps.billing.models import PaymentRecord
from apps.entitlements.services import user_plan
from apps.invitations.models import Notice
from apps.invitations.shapes import iso
from apps.organizations.models import Membership, Organization
from apps.packages.models import Package
from apps.subscriptions.models import Subscription
from apps.subscriptions.services import renew_subscription, stop_renewal
from tests.billing_support import (  # noqa: F401  (fixtures)
    CALLBACK,
    PAYMENT_ID,
    account,
    admin,
    apps_,
    boss,
    created,
    error,
    executed,
    fake_bkash,
    manual_body,
    member,
    no_bkash,
    org,
    other_org,
    owner,
    packages,
    portal,
    signed_in,
    single,
    subscribe,
)
from tests.factories import add_member, make_org, make_user

pytestmark = pytest.mark.django_db


def checkout(c, package, kind="new"):
    return portal(c, "post", "checkout/", {"package": str(package.id), "kind": kind})


def downgrade(c, package):
    return portal(c, "post", "downgrade/", {"package": str(package.id)})


# ---------------------------------------------------------------- GET billing/

def test_billing_page_offers_new_packages_when_nothing_is_active(no_bkash, admin, packages):
    r = portal(signed_in(admin.user), "get", "")
    assert r.status_code == 200
    body = r.json()
    assert body["subscriptions"] == [] and body["payments"] == [] and body["bkash_enabled"] is False
    offers = {(o["package"]["name"], o["kind"]) for o in body["offers"]}
    assert offers == {("Basic", "new"), ("Standard", "new"), ("Mind", "new"), ("BdREN AI Suite", "new")}
    suite = next(o for o in body["offers"] if o["package"]["kind"] == "bundle")
    assert suite["package"]["apps"] == [{"slug": "synapse", "name": "Synapse"}, {"slug": "mindspear", "name": "Mindspear"}]
    assert set(suite["quote"]) == {"package_version", "amount", "currency", "periods", "period_start", "period_end",
                                   "kind"}


def test_billing_page_offers_renewal_and_upgrades(fake_bkash, boss, admin, account, packages):
    sub = subscribe(account, packages["basic"])
    signed_in(boss).post("/api/v1/superadmin/billing/payments/manual/",
                         manual_body(packages["mind"], amount="2000.00", notes="x"), content_type="application/json")
    body = portal(signed_in(admin.user), "get", "").json()
    assert body["bkash_enabled"] is True
    offers = {(o["package"]["name"], o["kind"]) for o in body["offers"]}
    assert offers == {("Basic", "renew"), ("Mind", "renew"), ("Standard", "upgrade"), ("BdREN AI Suite", "upgrade")}
    renewal = next(o for o in body["offers"] if o["package"]["name"] == "Basic")
    assert renewal["quote"]["period_start"] == iso(sub.expires_at)
    payment = body["payments"][0]
    assert payment["recorded_by"] == {"name": "Platform Boss"} and payment["verified_by"] == {"name": "Platform Boss"}
    assert {s["package"]["name"] for s in body["subscriptions"]} == {"Basic", "Mind"}


# ---------------------------------------------------------------- checkout errors

def test_checkout_errors(fake_bkash, admin, account, packages, apps_):
    c = signed_in(admin.user)
    basic = packages["basic"]
    assert error(portal(c, "post", "checkout/", {"package": str(basic.id)})) == (400, "invalid")
    assert error(portal(c, "post", "checkout/", {"package": str(basic.id), "kind": "gift"})) == (400, "invalid")
    assert error(portal(c, "post", "checkout/", {"kind": "new"})) == (400, "invalid")
    assert error(portal(c, "post", "checkout/", {"package": "8b8f6c1e-55a6-4d0b-9a49-1f0d2d0e8a11", "kind": "new"})) \
        == (404, "not_found")
    assert error(checkout(c, packages["free"])) == (400, "free_package")
    hidden = single(apps_["synapse"], "hidden", 800, is_public=False)
    assert error(checkout(c, hidden)) == (400, "package_unavailable")
    assert error(checkout(c, basic, "renew")) == (400, "package_not_offered")
    subscribe(account, packages["suite"])
    assert error(checkout(c, packages["mind"])) == (409, "covered_by_bundle")
    assert error(checkout(c, basic)) == (409, "covered_by_bundle")
    assert error(checkout(c, packages["suite"])) == (400, "package_not_offered")
    assert error(checkout(c, packages["suite"], "upgrade")) == (400, "package_not_offered")
    assert not PaymentRecord.objects.exists()


def test_checkout_refuses_a_package_with_fewer_seats(fake_bkash, admin, member, apps_, packages):
    tiny = single(apps_["synapse"], "tiny", 500, seat_limit=2)
    r = checkout(signed_in(admin.user), tiny)
    assert error(r) == (409, "seats_exceed_package")
    assert r.json()["seats"] == {"used": 3, "cap": 2}
    assert not PaymentRecord.objects.exists()


def test_suspended_institution_cannot_pay(fake_bkash, admin, packages):
    Organization.objects.filter(slug="sau").update(status=Organization.Status.SUSPENDED)
    assert error(checkout(signed_in(admin.user), packages["basic"])) == (403, "institution_suspended")
    assert error(portal(signed_in(admin.user), "get", "")) == (403, "institution_suspended")


# ---------------------------------------------------------------- downgrades

def test_downgrade_is_scheduled_cancelled_and_applied_at_renewal(fake_bkash, admin, account, packages):
    c = signed_in(admin.user)
    sub = subscribe(account, packages["standard"], days_left=4)
    old_end = sub.expires_at
    r = downgrade(c, packages["basic"])
    assert r.status_code == 200
    assert r.json()["subscription"]["scheduled_package"] == {"id": str(packages["basic"].id), "name": "Basic"}
    r = portal(c, "delete", "downgrade/")
    assert r.status_code == 200 and r.json()["subscription"]["scheduled_package"] is None
    assert error(portal(c, "delete", "downgrade/")) == (409, "no_scheduled_change")

    downgrade(c, packages["basic"])
    offers = {(o["package"]["name"], o["kind"]) for o in portal(c, "get", "").json()["offers"]}
    assert ("Basic", "renew") in offers and ("Standard", "renew") not in offers
    fake_bkash.on("checkout/create", created()).on("checkout/execute", executed())
    assert checkout(c, packages["basic"], "renew").status_code == 201
    Client().get(CALLBACK, {"paymentID": PAYMENT_ID, "status": "success"})
    sub.refresh_from_db()
    assert PaymentRecord.objects.get().status == PaymentRecord.Status.COMPLETED
    assert sub.package_version.package_id == packages["basic"].pk and sub.pending_package_version is None
    assert sub.expires_at == old_end + timedelta(days=30) and Subscription.objects.count() == 1


def test_scheduled_downgrade_also_applies_on_a_plain_renewal(no_bkash, admin, account, packages):
    sub = subscribe(account, packages["standard"])
    downgrade(signed_in(admin.user), packages["basic"])
    renew_subscription(subscription=sub)
    sub.refresh_from_db()
    assert sub.package_version.package_id == packages["basic"].pk and sub.pending_package_version is None


def test_downgrade_errors(no_bkash, admin, member, account, packages, apps_):
    c = signed_in(admin.user)
    basic = packages["basic"]
    assert error(portal(c, "post", "downgrade/", {})) == (400, "invalid")
    assert error(portal(c, "post", "downgrade/", {"package": "8b8f6c1e-55a6-4d0b-9a49-1f0d2d0e8a11"})) == (
        404, "not_found")
    assert error(downgrade(c, basic)) == (409, "nothing_to_downgrade")
    sub = subscribe(account, packages["standard"])
    assert error(downgrade(c, packages["mind"])) == (409, "nothing_to_downgrade")
    premium = single(apps_["synapse"], "premium", 5000)
    assert error(downgrade(c, premium)) == (400, "package_not_offered")
    assert error(downgrade(c, packages["standard"])) == (400, "package_not_offered")
    assert error(downgrade(c, packages["suite"])) == (400, "package_not_offered")
    tiny = single(apps_["synapse"], "tiny", 500, seat_limit=2)
    r = downgrade(c, tiny)
    assert error(r) == (409, "seats_exceed_package") and r.json()["seats"] == {"used": 3, "cap": 2}
    stop_renewal(subscription=sub)
    assert error(downgrade(c, basic)) == (409, "renewal_stopped")
    sub.refresh_from_db()
    assert sub.pending_package_version is None


# ---------------------------------------------------------------- permissions

PORTAL_ENDPOINTS = [
    ("get", ""), ("post", "checkout/"), ("post", "downgrade/"), ("delete", "downgrade/"),
    ("get", "payments/{pk}/receipt/"), ("get", "payments/{pk}/attachment/"),
]


def test_portal_billing_is_for_that_institutions_admins(no_bkash, org, admin, member, other_org, packages):
    pk = "8b8f6c1e-55a6-4d0b-9a49-1f0d2d0e8a11"
    anonymous, normal = Client(), signed_in(member.user)
    outsider = signed_in(other_org.memberships.get().user)
    stranger = signed_in(make_user("nobody@example.com"))
    for method, path in PORTAL_ENDPOINTS:
        path = path.format(pk=pk)
        assert error(portal(anonymous, method, path)) == (401, "not_authenticated"), path
        assert error(portal(normal, method, path)) == (403, "not_institution_admin"), path
        assert error(portal(outsider, method, path)) == (404, "not_found"), path
        assert error(portal(stranger, method, path)) == (404, "not_found"), path


# ---------------------------------------------------------------- combined packages

def test_bundle_subscription_covers_each_app(no_bkash, boss, account, member, packages, apps_):
    basic = subscribe(account, packages["basic"])
    assert user_plan(member.user, apps_["mindspear"])["plan_source"] == "free"
    assert user_plan(member.user, apps_["synapse"])["plan_source"] == "institution"
    payment = billing.record_manual(manual_body(packages["suite"], kind="upgrade", amount="4500.00"), actor=boss)
    basic.refresh_from_db()
    assert basic.status == Subscription.Status.CANCELLED
    sub = payment.subscription
    assert sub.product_id is None and sub.status == Subscription.Status.ACTIVE
    assert user_plan(member.user, apps_["mindspear"])["plan_source"] == "institution"
    assert user_plan(member.user, apps_["synapse"])["plan_source"] == "institution"


def test_personal_bundle_counts_as_a_personal_plan(no_bkash, apps_, packages):
    user = make_user("solo@example.com")
    account, _ = Account.objects.get_or_create(owner_user=user, account_type=Account.Type.PERSONAL)
    subscribe(account, packages["suite"])
    assert user_plan(user, apps_["mindspear"])["plan_source"] == "personal"


# ---------------------------------------------------------------- end-of-period reminder

def test_expiry_reminder_is_sent_once(no_bkash, org, admin, member, account, packages):
    ended = subscribe(account, packages["basic"], days_left=-1)
    subscribe(make_org_account("old"), packages["basic"], days_left=-10)
    out = StringIO()
    call_command("send_expiry_reminders", stdout=out)
    notices = Notice.objects.filter(kind=Notice.Kind.EXPIRY_REMINDER)
    assert sorted(n.email for n in notices) == ["admin@sau.ac.bd", "owner@sau.ac.bd"]
    assert "Basic period ended on" in notices[0].body_text and "http" not in notices[0].body_text
    assert "subscriptions=1 emails=2" in out.getvalue()
    ended.refresh_from_db()
    assert ended.expiry_reminder_sent_at is not None
    call_command("send_expiry_reminders", stdout=StringIO())
    assert Notice.objects.filter(kind=Notice.Kind.EXPIRY_REMINDER).count() == 2


def make_org_account(slug):
    org = make_org(slug, name=f"Institution {slug}")
    add_member(org, make_user(f"admin@{slug}.ac.bd"), role=Membership.Role.ADMIN)
    return org.account


# ---------------------------------------------------------------- data migration

@pytest.mark.django_db(transaction=True)
def test_data_migration_maps_legacy_payments():
    executor = MigrationExecutor(connection)
    before = [("billing", "0002_initial")]
    executor.migrate(before)
    old = executor.loader.project_state(before).apps
    acct = make_org("legacy", name="Legacy U").account  # unchanged tables: today's models write them
    Old = old.get_model("billing", "PaymentRecord")
    verified = timezone.now() - timedelta(days=3)
    bank = Old.objects.create(account_id=acct.id, amount=Decimal("1500.00"), provider="bank_transfer",
                              reference="SIBL-1", status="completed", verified_at=verified)
    invoice = Old.objects.create(account_id=acct.id, amount=Decimal("900.00"), provider="institutional_invoice",
                                 reference="INV-2", status="pending")
    offline = Old.objects.create(account_id=acct.id, amount=Decimal("100.00"), provider="manual_offline",
                                 reference="X-3", status="rejected")

    executor = MigrationExecutor(connection)
    executor.loader.build_graph()
    executor.migrate(executor.loader.graph.leaf_nodes())

    rows = {p.pk: p for p in PaymentRecord.objects.all()}
    assert {p.kind for p in rows.values()} == {"legacy"}
    assert (rows[bank.pk].method, rows[bank.pk].status, rows[bank.pk].completed_at) == (
        "bank_transfer", "completed", verified)
    assert (rows[invoice.pk].method, rows[invoice.pk].status, rows[invoice.pk].completed_at) == (
        "other", "pending", None)
    assert (rows[offline.pk].method, rows[offline.pk].status) == ("other", "rejected")
    assert all(p.payment_date is not None and p.package_version_id is None for p in rows.values())
    assert rows[bank.pk].refunded_amount == Decimal("0") and rows[bank.pk].receipt_number is None
    assert Package.objects.count() == 0
