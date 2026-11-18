"""Portal API for the institution admin's pages: Members tabs, Add to package, Usage (+ CSV), Dashboard, Email
domains. Personal-plan members' usage and details must never come back (R2)."""
import csv
import io
from datetime import timedelta

import pytest
from django.core import mail
from django.test import Client
from django.utils import timezone

from apps.administration.models import PlatformRoleAssignment
from apps.audit.models import AuditLog
from apps.organizations.models import Membership
from apps.packages.services import create_package_with_version
from apps.portal import usage as portal_usage
from apps.products.models import Feature, Product
from apps.subscriptions.services import create_subscription
from apps.usage.models import UsageDaily, usage_day
from tests.factories import add_member, affiliate, give_personal_plan, make_invitation, make_org, make_user

pytestmark = pytest.mark.django_db

BASE = "/api/v1/portal/institutions/"
PERSONAL_PLAN_KEYS = {"membership_id", "user", "label", "joined_at"}


def signed_in(user):
    c = Client()
    c.force_login(user)
    return c


def get(client, path, slug="du", **query):
    return client.get(f"{BASE}{slug}/{path}", query)


def post(client, path, body=None, slug="du"):
    return client.post(f"{BASE}{slug}/{path}", body or {}, content_type="application/json")


def error(response):
    return response.status_code, response.json()["error"]


@pytest.fixture
def org():
    return make_org("du", name="University of Dhaka", sign_in_domains=["du.ac.bd", "bracu.ac.bd"], seat_cap=10)


@pytest.fixture
def admin(org):
    return add_member(org, make_user("admin@du.ac.bd", name="Admin"), role=Membership.Role.ADMIN)


@pytest.fixture
def client(admin):
    return signed_in(admin.user)


@pytest.fixture
def people(org, admin):
    """A covered member, a suspended covered member, a free-tier affiliate, an invited free-tier affiliate and a
    personal-plan affiliate."""
    covered = add_member(org, make_user("covered@du.ac.bd", name="Covered"))
    suspended = add_member(org, make_user("suspended@du.ac.bd", name="Suspended"), status=Membership.Status.SUSPENDED)
    free = affiliate(org, "free@du.ac.bd")
    invited = affiliate(org, "invited@du.ac.bd")
    make_invitation(org, "invited@du.ac.bd")
    paying = affiliate(org, "paying@du.ac.bd")
    give_personal_plan(paying.user)
    return {"covered": covered, "suspended": suspended, "free": free, "invited": invited, "paying": paying}


def ids(response):
    return {r["membership_id"] for r in response.json()["results"]}


# ---------------------------------------------------------------- access

def test_another_institutions_admin_and_a_superadmin_get_404_on_every_new_page(org, people):
    other = make_org("buet", name="BUET")
    outsider = add_member(other, make_user("chief@buet.ac.bd"), role=Membership.Role.ADMIN)
    superadmin = make_user("root@bdren.net.bd")
    PlatformRoleAssignment.objects.create(user=superadmin, role=PlatformRoleAssignment.Role.SUPER_ADMIN)
    free = people["free"]
    for user in (outsider.user, superadmin):
        c = signed_in(user)
        for r in (
            get(c, "dashboard/"), get(c, "usage/"), get(c, "usage/export.csv"), get(c, "domains/"),
            get(c, "members/", tab="personal_plan"), post(c, f"members/{free.id}/cover/"),
        ):
            assert error(r) == (404, "not_found")
    assert Membership.objects.get(pk=free.pk).coverage == Membership.Coverage.NONE
    assert not AuditLog.objects.filter(action__in=["membership.covered", "usage.exported"]).exists()


def test_new_pages_need_sign_in_and_an_admin_role(org, people):
    anon = Client()
    for path in ("dashboard/", "usage/", "usage/export.csv", "domains/"):
        assert error(get(anon, path)) == (401, "not_authenticated")
    plain = signed_in(people["covered"].user)
    for path in ("dashboard/", "usage/", "usage/export.csv", "domains/"):
        assert error(get(plain, path)) == (403, "not_institution_admin")


# ---------------------------------------------------------------- members tabs

def test_members_tabs_split_covered_not_covered_and_personal_plan(client, people, admin):
    p = people
    r = get(client, "members/", tab="covered")
    assert ids(r) == {str(m.id) for m in (admin, p["covered"], p["suspended"])}
    assert r.json()["tabs"] == {"covered": 3, "not_covered": 2, "personal_plan": 1}
    rows = get(client, "members/", tab="not_covered").json()["results"]
    assert {r["membership_id"]: r["label"] for r in rows} == {
        str(p["free"].id): "not_covered", str(p["invited"].id): "invited",
    }
    assert all(r["coverage"] == "none" and "role" in r for r in rows)
    assert ids(get(client, "members/")) == {str(m.id) for m in (admin, *p.values())}


def test_personal_plan_rows_carry_only_name_email_joined_date_and_label(client, people):
    paying = people["paying"]
    for query in ({"tab": "personal_plan"}, {}, {"q": "paying"}):
        rows = [r for r in get(client, "members/", **query).json()["results"]
                if r["membership_id"] == str(paying.id)]
        assert len(rows) == 1
        assert set(rows[0]) == PERSONAL_PLAN_KEYS
        assert rows[0]["user"] == {"name": "Person", "email": "paying@du.ac.bd"}
        assert rows[0]["label"] == "personal_plan"


def test_role_and_status_filters_never_match_personal_plan_members(client, people):
    for query in ({"status": "active"}, {"role": "member"}):
        assert str(people["paying"].id) not in ids(get(client, "members/", **query))
    for query in ({"tab": "personal_plan", "status": "active"}, {"tab": "personal_plan", "role": "member"}):
        assert error(get(client, "members/", **query)) == (400, "invalid")
    assert error(get(client, "members/", tab="invited")) == (400, "invalid")


def test_tab_counts_follow_the_search(client, people):
    r = get(client, "members/", q="paying", tab="covered")
    assert r.json()["results"] == []
    assert r.json()["tabs"] == {"covered": 0, "not_covered": 0, "personal_plan": 1}


def test_tabs_leave_out_pending_requests_and_removed_members(org, client, people):
    add_member(org, make_user("waiting@du.ac.bd"), status=Membership.Status.PENDING,
               coverage=Membership.Coverage.NONE)
    add_member(org, make_user("gone@du.ac.bd"), status=Membership.Status.DEPROVISIONED)
    assert get(client, "members/").json()["tabs"] == {"covered": 3, "not_covered": 2, "personal_plan": 1}


# ---------------------------------------------------------------- Add to package, change and remove

def test_add_to_package_covers_a_free_tier_member(client, people, admin, django_capture_on_commit_callbacks):
    free = people["free"]
    with django_capture_on_commit_callbacks(execute=True):
        r = post(client, f"members/{free.id}/cover/", {"role": "admin", "reason": "lab staff"})
    assert r.status_code == 200
    body = r.json()
    assert (body["member"]["coverage"], body["member"]["label"], body["member"]["role"]) == (
        "institution", "covered", "admin"
    )
    assert [m.to[0] for m in mail.outbox] == ["free@du.ac.bd"]
    [entry] = AuditLog.objects.filter(action="membership.covered")
    assert entry.actor == admin.user and entry.metadata["source"] == "portal"
    assert entry.metadata["via"] == "add_to_package" and entry.metadata["reason"] == "lab staff"


def test_add_to_package_refuses_covered_and_personal_plan_members(client, people):
    for key in ("covered", "suspended"):
        assert error(post(client, f"members/{people[key].id}/cover/")) == (409, "already_covered")
    assert error(post(client, f"members/{people['paying'].id}/cover/")) == (409, "needs_consent_invitation")
    assert Membership.objects.get(pk=people["paying"].pk).coverage == Membership.Coverage.NONE
    assert error(post(client, f"members/{people['free'].id}/cover/", {"role": "owner"})) == (400, "bad_role")
    assert not AuditLog.objects.filter(action="membership.covered").exists()


def test_add_to_package_at_the_seat_cap_gives_the_seat_cap_error(org, client, people):
    org.seat_cap = 4  # admin, covered, suspended + the live invitation
    org.save()
    r = post(client, f"members/{people['free'].id}/cover/")
    assert r.status_code == 409
    assert r.json() == {
        "error": "seat_cap_reached", "message": r.json()["message"], "seats_used": 4, "seat_cap": 4,
    }


def test_add_to_package_of_a_pending_request_or_unknown_member_is_404(org, client):
    waiting = add_member(org, make_user("waiting@du.ac.bd"), status=Membership.Status.PENDING,
                         coverage=Membership.Coverage.NONE)
    assert error(post(client, f"members/{waiting.id}/cover/")) == (404, "not_found")
    assert error(post(client, "members/00000000-0000-0000-0000-000000000000/cover/")) == (404, "not_found")


def test_change_and_remove_refuse_members_who_are_not_covered(client, people):
    for key, expected in (("free", (409, "not_covered")), ("paying", (403, "personal_plan_member"))):
        target = people[key]
        r = client.patch(f"{BASE}du/members/{target.id}/", {"role": "admin"}, content_type="application/json")
        assert error(r) == expected
        assert error(post(client, f"members/{target.id}/remove/")) == expected
    assert not AuditLog.objects.filter(action__in=["membership.updated", "membership.uncovered"]).exists()


def test_remove_uncovers_and_frees_the_seat(client, people, admin):
    covered = people["covered"]
    before = get(client, "dashboard/").json()["seats"]["used"]
    r = post(client, f"members/{covered.id}/remove/", {"reason": "left"})
    assert (r.json()["coverage"], r.json()["label"], r.json()["status"]) == ("none", "not_covered", "active")
    assert get(client, "dashboard/").json()["seats"]["used"] == before - 1
    [entry] = AuditLog.objects.filter(action="membership.uncovered")
    assert entry.actor == admin.user and entry.metadata["reason"] == "left"


# ---------------------------------------------------------------- usage

@pytest.fixture
def usage_data(org, people):
    """Usage on the institution's account over the last 30 days and the 30 before, by a covered member, a member who
    was later uncovered, a personal-plan member (from when they were covered), nobody in particular, and another
    institution."""
    synapse = Product.objects.create(name="Synapse", slug="synapse-app")
    mindspear = Product.objects.create(name="Mindspear", slug="mindspear")
    tokens = Feature.objects.create(product=synapse, key="tokens", name="Tokens", unit="tokens")
    quizzes = Feature.objects.create(product=mindspear, key="quizzes", name="Quizzes", unit="count")
    today = usage_day(timezone.now())
    account = org.account
    covered, free, paying = (people[k].user for k in ("covered", "free", "paying"))
    other = make_org("buet", name="BUET")
    outsider = add_member(other, make_user("x@buet.ac.bd")).user

    def add(user, feature, days_ago, quantity, requests=1, acct=account):
        UsageDaily.objects.create(
            account=acct, product=feature.product, feature=feature, user=user,
            day=today - timedelta(days=days_ago), quantity=quantity, requests=requests,
        )

    add(covered, tokens, 0, 300, 3)
    add(covered, quizzes, 5, 20, 2)
    add(free, tokens, 10, 100, 1)
    add(paying, tokens, 1, 7000, 70)
    add(paying, quizzes, 2, 900, 9)
    add(None, tokens, 3, 40, 1)
    add(covered, tokens, 40, 50, 1)
    add(paying, tokens, 45, 6000, 60)
    add(outsider, tokens, 0, 5000, 50, acct=other.account)
    return {"synapse": synapse, "mindspear": mindspear, "today": today, "covered": covered, "free": free,
            "paying": paying}


def test_usage_reports_the_institution_without_personal_plan_members(client, usage_data, people):
    d = usage_data
    r = get(client, "usage/")
    assert r.status_code == 200
    assert b"paying@du.ac.bd" not in r.content and str(d["paying"].id).encode() not in r.content
    body = r.json()
    assert body["range"] == {
        "start": (d["today"] - timedelta(days=29)).isoformat(), "end": d["today"].isoformat(), "days": 30,
        "timezone": "Asia/Dhaka",
    }
    assert body["product"] is None
    s = body["summary"]
    assert (s["quantity"], s["requests"], s["members_with_usage"], s["features_used"]) == (460, 7, 2, 2)
    assert (s["previous"]["quantity"], s["previous"]["members_with_usage"]) == (50, 1)
    assert s["change"]["quantity"] == 820.0
    members = body["members"]
    assert members["total"] == 2 and (members["limit"], members["offset"]) == (50, 0)
    assert [(m["user"]["email"], m["label"], m["coverage"], m["quantity"]) for m in members["results"]] == [
        ("covered@du.ac.bd", "covered", "institution", 320),
        ("free@du.ac.bd", "not_covered", "none", 100),
    ]
    assert members["results"][0]["membership_id"] == str(people["covered"].id)
    assert members["results"][0]["last_used"] == d["today"].isoformat()
    assert [(p["product_slug"], p["quantity"]) for p in body["by_product"]] == [("synapse-app", 440), ("mindspear", 20)]
    assert [(f["feature_key"], f["quantity"]) for f in body["by_feature"]] == [("tokens", 440), ("quizzes", 20)]
    assert len(body["by_day"]) == 30 and sum(x["quantity"] for x in body["by_day"]) == 460


def test_usage_by_one_app_still_lists_every_app(client, usage_data):
    body = get(client, "usage/", product="mindspear").json()
    assert body["product"] == {"slug": "mindspear", "name": "Mindspear"}
    assert body["summary"]["quantity"] == 20
    assert [m["user"]["email"] for m in body["members"]["results"]] == ["covered@du.ac.bd"]
    assert {p["product_slug"] for p in body["by_product"]} == {"synapse-app", "mindspear"}


def test_usage_pages_members_with_limit_and_offset(client, usage_data):
    body = get(client, "usage/", limit=1, offset=1).json()["members"]
    assert [m["user"]["email"] for m in body["results"]] == ["free@du.ac.bd"]
    assert (body["total"], body["limit"], body["offset"]) == (2, 1, 1)


def test_usage_shows_a_covered_member_whose_personal_plan_is_still_running(client, usage_data, people):
    give_personal_plan(people["covered"].user)
    emails = [m["user"]["email"] for m in get(client, "usage/").json()["members"]["results"]]
    assert emails == ["covered@du.ac.bd", "free@du.ac.bd"]


def test_usage_hides_someone_who_bought_a_personal_plan_after_leaving_the_package(client, usage_data, people):
    give_personal_plan(people["free"].user)
    body = get(client, "usage/").json()
    assert [m["user"]["email"] for m in body["members"]["results"]] == ["covered@du.ac.bd"]
    assert body["summary"]["quantity"] == 360


def test_usage_shows_former_members_who_left_the_institution_without_a_label(client, usage_data, people):
    people["free"].status = Membership.Status.DEPROVISIONED
    people["free"].save()
    row = get(client, "usage/").json()["members"]["results"][1]
    assert (row["user"]["email"], row["membership_id"], row["coverage"], row["label"]) == (
        "free@du.ac.bd", None, None, None
    )


@pytest.mark.parametrize("query, field", [
    ({"start": "2026-11-10", "end": "2026-11-01"}, "start"),
    ({"start": "2025-01-01", "end": "2026-01-02"}, "end"),
    ({"start": "18/11/2026"}, "start"),
    ({"end": "2026-02-30"}, "end"),
    ({"product": "nope"}, "product"),
    ({"limit": "0"}, "limit"),
    ({"limit": "201"}, "limit"),
    ({"offset": "-1"}, "offset"),
    ({"offset": "x"}, "offset"),
])
def test_usage_rejects_bad_ranges_and_paging(client, query, field):
    r = get(client, "usage/", **query)
    assert error(r) == (400, "invalid")
    assert field in r.json()["fields"]


def test_usage_accepts_a_full_366_day_range(client, usage_data):
    body = get(client, "usage/", start="2024-01-01", end="2024-12-31").json()
    assert body["range"]["days"] == 366 and body["summary"]["quantity"] == 0


def test_usage_export_streams_every_member_row_as_csv(client, usage_data, people, admin, monkeypatch):
    monkeypatch.setattr(portal_usage, "EXPORT_BATCH", 1)
    people["covered"].user.name = "=HYPERLINK(\"x\")"
    people["covered"].user.save()
    r = get(client, "usage/export.csv")
    assert r.status_code == 200 and r["Content-Type"].startswith("text/csv")
    today = usage_data["today"]
    assert r["Content-Disposition"] == (
        f'attachment; filename="du-usage-{(today - timedelta(days=29)).isoformat()}-{today.isoformat()}.csv"'
    )
    text = b"".join(r.streaming_content).decode()
    rows = list(csv.reader(io.StringIO(text)))
    assert rows == [
        ["name", "email", "label", "quantity", "requests", "last_used"],
        ["'=HYPERLINK(\"x\")", "covered@du.ac.bd", "covered", "320", "5", today.isoformat()],
        ["Person", "free@du.ac.bd", "not_covered", "100", "1", (today - timedelta(days=10)).isoformat()],
    ]
    assert "paying" not in text
    [entry] = AuditLog.objects.filter(action="usage.exported")
    assert entry.actor == admin.user and entry.metadata["source"] == "portal"
    assert entry.metadata["end"] == today.isoformat()


def test_usage_export_validates_like_the_report(client):
    assert error(get(client, "usage/export.csv", start="2026-11-10", end="2026-11-01")) == (400, "invalid")
    assert not AuditLog.objects.filter(action="usage.exported").exists()


# ---------------------------------------------------------------- dashboard

def test_dashboard_has_seats_counts_week_top_members_and_packages(org, client, usage_data, people):
    product = usage_data["synapse"]
    _, version = create_package_with_version(product=product, name="Campus", slug="campus", limits=[])
    expires = timezone.now() + timedelta(days=20, hours=1)
    create_subscription(account=org.account, package_version=version, expires_at=expires)
    body = get(client, "dashboard/").json()
    assert body["seats"] == {"used": 4, "cap": 10}
    assert body["counts"] == {
        "covered_active": 2, "covered_suspended": 1, "not_covered": 2, "personal_plan": 1,
        "pending_invitations": 1, "expired_invitations": 0,
    }
    week = body["usage"]
    assert week["range"]["days"] == 7 and week["range"]["end"] == usage_data["today"].isoformat()
    assert (week["summary"]["quantity"], week["summary"]["previous"]["quantity"]) == (360, 100)
    assert len(week["by_day"]) == 7
    assert [m["user"]["email"] for m in week["top_members"]] == ["covered@du.ac.bd"]
    [package] = body["packages"]
    assert package["product"] == {"slug": "synapse-app", "name": "Synapse"}
    assert package["package"] == {"name": "Campus", "version": 1}
    assert (package["days_left"], package["expires_soon"], package["auto_renew"]) == (20, True, True)
    assert "paying@du.ac.bd" not in str(body)


def test_dashboard_without_usage_or_packages(client):
    body = get(client, "dashboard/").json()
    assert body["usage"]["summary"]["quantity"] == 0 and body["usage"]["top_members"] == []
    assert body["packages"] == [] and body["product"] is None


def test_dashboard_narrows_usage_to_one_app(client, usage_data):
    body = get(client, "dashboard/", product="mindspear").json()
    assert body["product"]["slug"] == "mindspear"
    assert body["usage"]["summary"]["quantity"] == 20
    assert error(get(client, "dashboard/", product="nope")) == (400, "invalid")


# ---------------------------------------------------------------- domains

def test_domains_list_confirmed_members_per_domain(org, client, people):
    add_member(org, make_user("lab@cse.du.ac.bd"))
    add_member(org, make_user("guest@gmail.com"))
    add_member(org, make_user("waiting@bracu.ac.bd"), status=Membership.Status.PENDING,
               coverage=Membership.Coverage.NONE)
    add_member(org, make_user("gone@du.ac.bd"), status=Membership.Status.DEPROVISIONED)
    make_invitation(org, "new@bracu.ac.bd")
    body = get(client, "domains/").json()
    assert body == {
        "domains": [{"domain": "du.ac.bd", "confirmed_members": 7}, {"domain": "bracu.ac.bd", "confirmed_members": 0}],
        "confirmed_members": 8,
        "other_domains": 1,
    }


def test_domains_of_an_institution_without_any(org, client):
    org.sign_in_domains = []
    org.save()
    assert get(client, "domains/").json() == {"domains": [], "confirmed_members": 1, "other_domains": 1}
