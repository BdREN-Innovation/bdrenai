from datetime import timedelta

import pytest
from django.contrib.sessions.models import Session
from django.core.cache import cache
from django.core import mail
from django.db import connection
from django.test import Client
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from apps.administration.models import PlatformRoleAssignment
from apps.audit.models import AuditLog
from apps.audit.services import client_ip
from apps.identities.models import ExternalIdentity, User, UserSession
from apps.invitations.models import Invitation, hash_token
from apps.organizations.models import Membership, Organization
from apps.invitations.errors import ServiceError
from apps.superadmin import services
from tests.factories import add_member, make_invitation, make_org, make_user, sent_tokens

pytestmark = pytest.mark.django_db

API = "/api/v1/superadmin/"
SUPER = PlatformRoleAssignment.Role.SUPER_ADMIN
ADMIN = Membership.Role.ADMIN


def make_superadmin(email="boss@bdren.ai", name="Platform Boss"):
    user = make_user(email, name=name)
    PlatformRoleAssignment.objects.create(user=user, role=SUPER)
    return user


def signed_in(user, **kw):
    c = Client(**kw)
    c.force_login(user)
    return c


@pytest.fixture
def boss():
    return make_superadmin()


@pytest.fixture
def client(boss):
    return signed_in(boss)


@pytest.fixture
def org():
    return make_org("du", name="University of Dhaka", seat_cap=10)


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


# ---------------------------------------------------------------- permissions

def all_endpoints(org, membership, user, invitation):
    return [
        ("get", "session/"), ("get", "dashboard/"), ("get", "institutions/"), ("post", "institutions/"),
        ("get", "institutions/options/"), ("get", f"institutions/{org.slug}/"),
        ("patch", f"institutions/{org.slug}/"), ("post", f"institutions/{org.slug}/suspend/"),
        ("post", f"institutions/{org.slug}/reactivate/"), ("post", f"institutions/{org.slug}/deactivate/"),
        ("get", f"institutions/{org.slug}/members/"), ("get", f"institutions/{org.slug}/history/"),
        ("post", f"institutions/{org.slug}/import/"), ("patch", f"memberships/{membership.id}/"),
        ("post", f"memberships/{membership.id}/remove/"), ("get", "users/"), ("get", f"users/{user.id}/"),
        ("patch", f"users/{user.id}/"), ("get", "invitations/"), ("post", "invitations/"),
        ("post", f"invitations/{invitation.id}/resend/"), ("post", f"invitations/{invitation.id}/revoke/"),
        ("post", "invitations/resend-expired/"), ("get", "admins/"), ("post", "admins/"),
        ("delete", f"admins/{user.id}/"), ("get", "audit/"),
    ]


def call(c, method, path):
    if method == "get":
        return c.get(API + path)
    return getattr(c, method)(API + path, {"reason": "x"}, content_type="application/json")


def test_every_endpoint_needs_a_signed_in_superadmin(org):
    member = add_member(org, role=ADMIN)
    invitation, _ = make_invitation(org)
    endpoints = all_endpoints(org, member, member.user, invitation)
    support = make_user("support@bdren.ai")
    PlatformRoleAssignment.objects.create(user=support, role=PlatformRoleAssignment.Role.SUPPORT_ADMIN)
    audit_before = AuditLog.objects.count()

    for method, path in endpoints:
        r = call(Client(), method, path)
        assert r.status_code == 401, (method, path)
        assert r.json() == {"error": "not_authenticated", "message": "Sign in first."}
        for user in (member.user, support):
            r = call(signed_in(user), method, path)
            assert error(r) == (403, "not_superadmin"), (method, path)

    assert AuditLog.objects.count() == audit_before
    org.refresh_from_db()
    assert org.status == Organization.Status.ACTIVE
    assert Invitation.objects.get().status == Invitation.Status.PENDING


def test_suspended_superadmin_is_signed_out(boss, client):
    assert get(client, "session/").status_code == 200
    User.objects.filter(pk=boss.pk).update(status=User.Status.SUSPENDED)
    assert error(get(client, "session/")) == (401, "not_authenticated")


def test_unsafe_methods_need_the_csrf_token(boss):
    strict = signed_in(boss, enforce_csrf_checks=True)
    r = post(strict, "institutions/", {"name": "Example", "slug": "example"})
    assert r.status_code == 403 and r.json()["error"] == "forbidden" and "CSRF" in r.json()["message"]
    assert not Organization.objects.filter(slug="example").exists()


def test_session(client, boss):
    r = get(client, "session/")
    assert r.status_code == 200
    assert r.json() == {
        "user": {"id": str(boss.id), "email": "boss@bdren.ai", "name": "Platform Boss", "initials": "PB"},
        "roles": ["platform_super_admin"],
    }


# ---------------------------------------------------------------- dashboard

def test_dashboard_counts_and_attention(client, org):
    org.seat_cap = 2
    org.save()
    add_member(org)
    make_invitation(org, "live@du.ac.bd")
    make_invitation(org, "old@du.ac.bd", expired=True)
    add_member(org, status=Membership.Status.PENDING)
    roomy = make_org("roomy", seat_cap=100)
    add_member(roomy)
    gone = make_org("gone")
    gone.status = Organization.Status.DEACTIVATED
    gone.save()
    add_member(gone, status=Membership.Status.PENDING)
    record = AuditLog.objects.create(action="organization.created", target_type="Organization", target_id=org.id)

    body = get(client, "dashboard/").json()
    assert body["counts"] == {
        "institutions": 2, "active_institutions": 2, "users": 5, "active_users": 5,
        "pending_invitations": 1, "expired_invitations": 1, "pending_requests": 1,
    }
    assert body["attention"] == [
        {"kind": "seats_near_cap", "institution": {"slug": "du", "name": "University of Dhaka"},
         "seats": {"used": 2, "cap": 2}},
        {"kind": "expired_invitations", "count": 1},
        {"kind": "pending_requests", "institution": {"slug": "du", "name": "University of Dhaka"}, "count": 1},
    ]
    assert [i["slug"] for i in body["recent_institutions"]] == ["roomy", "du"]
    assert body["recent_institutions"][1]["seats"] == {"used": 2, "cap": 2}
    assert body["recent_activity"][0]["id"] == str(record.id)


# ---------------------------------------------------------------- institutions

def test_institution_list_shape_filters_and_pagination(client, org):
    owner = add_member(org, role=Membership.Role.OWNER, email="owner@du.ac.bd")
    add_member(org, status=Membership.Status.SUSPENDED)
    add_member(org, status=Membership.Status.PENDING)
    make_invitation(org, "live@du.ac.bd")
    make_org("buet", name="BUET")
    removed = make_org("old", name="Old College")
    removed.status = Organization.Status.DEACTIVATED
    removed.save()

    body = get(client, "institutions/").json()
    assert (body["count"], body["page"], body["page_size"]) == (2, 1, 25)
    assert [r["slug"] for r in body["results"]] == ["buet", "du"]
    du = body["results"][1]
    assert du == {
        "id": str(org.id), "slug": "du", "name": "University of Dhaka", "type": "other", "sector": "", "status": "active",
        "seats": {"used": 3, "cap": 10},  # owner, the suspended member (keeps a seat), the live invitation
        "admins": [{"id": str(owner.user.id), "name": "Person", "email": "owner@du.ac.bd"}],
        "members_count": 2, "pending_invitations": 1, "pending_requests": 1, "created_at": du["created_at"],
    }

    assert [r["slug"] for r in get(client, "institutions/", status="deactivated").json()["results"]] == ["old"]
    assert [r["slug"] for r in get(client, "institutions/", q="DHAKA").json()["results"]] == ["du"]
    page2 = get(client, "institutions/", page=2, page_size=1).json()
    assert [r["slug"] for r in page2["results"]] == ["du"] and page2["count"] == 2 and page2["page_size"] == 1
    assert get(client, "institutions/", page_size=500).json()["page_size"] == 100
    assert error(get(client, "institutions/", status="gone")) == (400, "invalid")
    r = get(client, "institutions/", page="0")
    assert error(r) == (400, "invalid") and "page" in r.json()["fields"]


def test_institution_list_query_count_does_not_grow_with_rows(client):
    def count_queries():
        with CaptureQueriesContext(connection) as ctx:
            assert get(client, "institutions/").status_code == 200
        return len(ctx)

    org = make_org("first")
    add_member(org, role=ADMIN)
    few = count_queries()
    for i in range(12):
        more = make_org(f"org-{i}")
        add_member(more, role=ADMIN)
        add_member(more, role=Membership.Role.OWNER)
        make_invitation(more, f"x{i}@du.ac.bd")
    assert count_queries() == few
    assert few <= 7


def test_institution_options(client, org):
    make_org("buet", name="BUET")
    gone = make_org("gone")
    gone.status = Organization.Status.DEACTIVATED
    gone.save()
    body = get(client, "institutions/options/", q="u").json()
    assert body == {"results": [
        {"slug": "buet", "name": "BUET", "status": "active", "seats": {"used": 0, "cap": None}},
        {"slug": "du", "name": "University of Dhaka", "status": "active", "seats": {"used": 0, "cap": 10}},
    ]}


@pytest.mark.django_db(transaction=True)
def test_create_institution_with_admin_sends_the_invitation():
    boss = make_superadmin()
    body = {
        "name": "Example University", "slug": "example-university", "type": "university", "timezone": "Asia/Dhaka",
        "contact_email": "", "sign_in_domains": ["Example.edu"], "seat_cap": 200,
        "admin": {"email": "admin@example.edu", "name": "Admin Name"},
    }
    r = post(signed_in(boss), "institutions/", body)
    assert r.status_code == 201
    data = r.json()
    assert data["email_sent"] is True
    detail = data["institution"]
    assert detail["slug"] == "example-university" and detail["sign_in_domains"] == ["example.edu"]
    assert detail["seats"] == {"used": 1, "cap": 200} and detail["counts"]["pending_invitations"] == 1
    assert data["invitation"]["email"] == "admin@example.edu" and data["invitation"]["role"] == "admin"
    assert data["invitation"]["invited_by"]["id"] == str(boss.id)
    (token,) = sent_tokens()
    assert Invitation.objects.get().token_hash == hash_token(token)
    created = last_audit("organization.created")
    assert created.actor == boss and created.ip_address == "127.0.0.1"
    assert created.metadata["organization_id"] == detail["id"] and created.metadata["source"] == "superadmin"


def test_create_institution_without_admin_and_its_errors(client, org):
    r = post(client, "institutions/", {"name": "Plain Org", "slug": "plain"})
    assert r.status_code == 201
    assert r.json()["invitation"] is None and r.json()["email_sent"] is False
    assert r.json()["institution"]["seats"] == {"used": 0, "cap": None}

    r = post(client, "institutions/", {"name": "X", "slug": "Bad Slug", "seat_cap": 0})
    assert error(r) == (400, "invalid") and set(r.json()["fields"]) == {"name", "slug", "seat_cap"}
    assert error(post(client, "institutions/", {"name": "Again", "slug": "du"})) == (409, "slug_taken")
    r = post(client, "institutions/", {"name": "Options", "slug": "options"})
    assert error(r) == (400, "invalid") and "slug" in r.json()["fields"]
    r = post(client, "institutions/", {"name": "Strict", "slug": "strict", "sign_in_domains": ["strict.edu"],
                                       "admin": {"email": "not-an-email"}})
    assert error(r) == (400, "invalid") and "admin.email" in r.json()["fields"]
    assert not Organization.objects.filter(slug="strict").exists()
    assert post(client, "institutions/", {"name": "Open", "slug": "open", "sign_in_domains": ["open.edu"],
                                          "admin": {"email": "a@gmail.com"}}).status_code == 201
    r = post(client, "institutions/", {"name": "Copy", "slug": "copy", "sign_in_domains": ["Open.edu"]})
    assert error(r) == (409, "domain_taken") and "sign_in_domains" in r.json()["fields"]
    assert r.json()["conflicts"] == [{"domain": "open.edu", "institution": {"slug": "open", "name": "Open"}}]
    assert error(client.post(API + "institutions/", "[1]", content_type="application/json")) == (400, "invalid")
    assert error(client.post(API + "institutions/", "{bad", content_type="application/json")) == (400, "invalid")


def test_institution_detail(client, org):
    admin = add_member(org, role=ADMIN, email="admin@du.ac.bd")
    owner = add_member(org, role=Membership.Role.OWNER, email="owner@du.ac.bd")
    add_member(org, role=ADMIN, status=Membership.Status.SUSPENDED)
    make_invitation(org, "old@du.ac.bd", expired=True)
    make_invitation(org, "live@du.ac.bd")

    body = get(client, "institutions/du/").json()
    assert body["counts"] == {"members": 3, "active": 2, "suspended": 1, "pending_invitations": 1,
                              "expired_invitations": 1, "pending_requests": 0, "not_covered": 0, "personal_plan": 0}
    assert body["seats"] == {"used": 4, "cap": 10}
    assert [a["membership_id"] for a in body["admins"]] == [str(admin.id), str(owner.id)]
    assert body["admins"][1] == {"membership_id": str(owner.id), "user_id": str(owner.user.id), "name": "Person",
                                 "email": "owner@du.ac.bd", "role": "owner"}
    assert body["timezone"] == "Asia/Dhaka" and body["updated_at"].endswith("Z")
    assert error(get(client, "institutions/nowhere/")) == (404, "not_found")


def test_patch_institution(client, org, boss):
    add_member(org)
    add_member(org)
    r = patch(client, "institutions/du/", {"seat_cap": 1})
    assert error(r) == (400, "invalid") and "reason" in r.json()["fields"]

    r = patch(client, "institutions/du/", {"seat_cap": 1, "reason": "Contract reduced", "name": "Dhaka University",
                                           "sign_in_domains": ["DU.ac.bd"], "slug": "ignored"})
    assert r.status_code == 200
    body = r.json()
    assert body["warning"] == "over_cap" and body["seats"] == {"used": 2, "cap": 1}
    assert body["seat_cap_reason"] == "Contract reduced" and body["slug"] == "du"
    assert body["name"] == "Dhaka University" and body["sign_in_domains"] == ["du.ac.bd"]
    entry = last_audit("organization.updated")
    assert entry.metadata["changes"]["seat_cap"] == [10, 1] and entry.metadata["reason"] == "Contract reduced"
    assert entry.actor == boss and entry.metadata["organization_id"] == str(org.id)

    r = patch(client, "institutions/du/", {"contact_email": "Help@DU.ac.bd"})
    assert r.status_code == 200 and "warning" in r.json()
    assert r.json()["contact_email"] == "help@du.ac.bd"
    r = patch(client, "institutions/du/", {"seat_cap": None, "reason": "Unlimited"})
    assert r.json()["seats"]["cap"] is None and "warning" not in r.json()
    assert error(patch(client, "institutions/du/", {"timezone": "Mars/Base"})) == (400, "invalid")
    assert error(patch(client, "institutions/nowhere/", {"name": "X Y"})) == (404, "not_found")


def test_suspend_reactivate_and_deactivate(client, org):
    invitation, _ = make_invitation(org, "live@du.ac.bd")
    stale, _ = make_invitation(org, "old@du.ac.bd", expired=True)
    accepted, _ = make_invitation(org, "done@du.ac.bd", status=Invitation.Status.ACCEPTED)

    assert error(post(client, "institutions/du/suspend/", {})) == (400, "invalid")
    r = post(client, "institutions/du/suspend/", {"reason": "Unpaid"})
    assert r.status_code == 200 and r.json()["status"] == "suspended"
    assert last_audit("organization.suspended").metadata["reason"] == "Unpaid"
    assert error(post(client, "institutions/du/suspend/", {"reason": "Again"})) == (409, "invalid_transition")
    assert post(client, "institutions/du/reactivate/", {"reason": "Paid"}).json()["status"] == "active"

    r = post(client, "institutions/du/deactivate/", {"reason": "Closed", "confirm": "university of dhaka"})
    assert error(r) == (400, "confirm_mismatch")
    r = post(client, "institutions/du/deactivate/", {"reason": "Closed", "confirm": "University of Dhaka"})
    assert r.status_code == 200 and r.json()["status"] == "deactivated"
    statuses = dict(Invitation.objects.values_list("id", "status"))
    assert statuses == {invitation.id: "revoked", stale.id: "revoked", accepted.id: "accepted"}
    entry = last_audit("organization.deactivated")
    assert entry.metadata["revoked_invitations"] == 2 and entry.metadata["previous_status"] == "active"
    assert AuditLog.objects.filter(action="invitation.revoked", metadata__organization_id=str(org.id)).count() == 2
    assert get(client, "institutions/").json()["count"] == 0
    assert error(post(client, "institutions/du/suspend/", {"reason": "x"})) == (409, "invalid_transition")
    assert post(client, "institutions/du/reactivate/", {"reason": "Back"}).json()["status"] == "active"


def test_members_list(client, org):
    a = add_member(org, role=ADMIN, email="rahim@du.ac.bd")
    s = add_member(org, status=Membership.Status.SUSPENDED, email="karim@du.ac.bd")
    gone = add_member(org, status=Membership.Status.DEPROVISIONED)
    add_member(make_org("other"))

    body = get(client, "institutions/du/members/").json()
    assert body["count"] == 2 and {r["membership_id"] for r in body["results"]} == {str(a.id), str(s.id)}
    row = next(r for r in body["results"] if r["membership_id"] == str(a.id))
    assert row == {"membership_id": str(a.id), "user": {"id": str(a.user.id), "name": "Person",
                   "email": "rahim@du.ac.bd", "status": "active"}, "role": "admin", "status": "active",
                   "coverage": "institution", "label": "covered", "joined_at": row["joined_at"]}
    removed = get(client, "institutions/du/members/", status="deprovisioned").json()["results"]
    ids = [r["membership_id"] for r in removed]
    assert ids == [str(gone.id)]
    assert get(client, "institutions/du/members/", role="admin").json()["count"] == 1
    assert get(client, "institutions/du/members/", q="KARIM").json()["count"] == 1
    assert error(get(client, "institutions/du/members/", role="king")) == (400, "invalid")
    assert error(get(client, "institutions/nowhere/members/")) == (404, "not_found")


def test_history_lists_only_this_institutions_entries(client, org):
    member = add_member(org, role=ADMIN)
    add_member(org, role=ADMIN)
    patch(client, f"memberships/{member.id}/", {"role": "member", "reason": "Demoted"})
    post(client, "invitations/", {"institution": "du", "email": "new@du.ac.bd", "role": "member"})
    patch(client, "institutions/du/", {"name": "Dhaka University"})
    other = make_org("other")
    post(client, "invitations/", {"institution": "other", "email": "x@other.edu", "role": "member"})

    body = get(client, "institutions/du/history/").json()
    assert [e["action"] for e in body["results"]] == [
        "organization.updated", "invitation.created", "membership.updated",
    ]
    assert all(e["actor"]["email"] == "boss@bdren.ai" for e in body["results"])
    assert get(client, f"institutions/{other.slug}/history/").json()["count"] == 1


def test_import_dry_run_and_real_run(client, org):
    rows = [{"email": "a@du.ac.bd", "name": "A"}, {"email": "bad"}, {"email": "a@du.ac.bd"}]
    r = post(client, "institutions/du/import/", {"rows": rows})
    assert r.status_code == 200
    body = r.json()
    assert [row["status"] for row in body["rows"]] == ["ok", "error", "skip"]
    assert body["summary"]["fits"] == 1 and body["created"] == 0 and not Invitation.objects.exists()

    body = post(client, "institutions/du/import/", {"rows": rows, "dry_run": False}).json()
    assert body["created"] == 1 and body["summary"]["seats"] == {"used": 1, "cap": 10}
    assert Invitation.objects.get().source == Invitation.Source.IMPORT
    assert last_audit("organization.members_imported").metadata["source"] == "superadmin"
    assert error(post(client, "institutions/du/import/", {"rows": rows, "dry_run": "no"})) == (400, "invalid")
    assert error(post(client, "institutions/du/import/", {"rows": [{}] * 1001})) == (400, "too_many_rows")


# ---------------------------------------------------------------- memberships

def test_membership_patch(client, org, boss):
    org.seat_cap = 1
    org.save()
    admin = add_member(org, role=ADMIN)
    pending = add_member(org, status=Membership.Status.PENDING)

    r = patch(client, f"memberships/{pending.id}/", {"status": "active"})
    assert error(r) == (409, "seat_cap_reached") and r.json()["seats_used"] == 1 and r.json()["seat_cap"] == 1

    r = patch(client, f"memberships/{admin.id}/", {"status": "suspended", "reason": "Left"})
    assert error(r) == (409, "last_admin")
    r = patch(client, f"memberships/{admin.id}/", {"status": "suspended", "reason": "Left", "force": True})
    assert r.status_code == 200 and r.json()["status"] == "suspended"
    entry = last_audit("membership.updated")
    assert entry.metadata["forced"] is True and entry.metadata["reason"] == "Left" and entry.actor == boss

    assert error(patch(client, f"memberships/{pending.id}/", {"status": "active"})) == (409, "seat_cap_reached")
    org.seat_cap = 2  # the suspended admin keeps their seat
    org.save()
    r = patch(client, f"memberships/{pending.id}/", {"status": "active", "role": "billing"})
    assert r.status_code == 200 and (r.json()["status"], r.json()["role"]) == ("active", "billing")
    assert error(patch(client, f"memberships/{pending.id}/", {"role": "king"})) == (400, "bad_role")
    assert error(patch(client, f"memberships/{pending.id}/", {"status": "deprovisioned"})) == (400, "invalid")
    assert error(patch(client, f"memberships/{pending.id}/", {"force": "yes"})) == (400, "invalid")
    assert error(patch(client, "memberships/7d1c4c9e-5d0b-4a0c-9d7e-2b9f0f0a1b2c/", {})) == (404, "not_found")


def test_membership_remove(client, org):
    admin = add_member(org, role=ADMIN)
    member = add_member(org)
    assert error(post(client, f"memberships/{member.id}/remove/", {})) == (400, "invalid")
    r = post(client, f"memberships/{member.id}/remove/", {"reason": "Graduated"})
    assert r.status_code == 200 and r.json()["status"] == "deprovisioned"
    assert get(client, "institutions/du/").json()["seats"]["used"] == 1
    assert last_audit("membership.removed").metadata["reason"] == "Graduated"
    assert error(post(client, f"memberships/{admin.id}/remove/", {"reason": "x"})) == (409, "last_admin")


# ---------------------------------------------------------------- users

def test_users_list_filters(client, org, boss):
    rahim = add_member(org, role=ADMIN, email="rahim@du.ac.bd").user
    other_org = make_org("buet", name="BUET")
    karim = add_member(other_org, email="karim@buet.ac.bd").user
    add_member(org, karim, status=Membership.Status.DEPROVISIONED)
    karim.status = User.Status.SUSPENDED
    karim.save()

    body = get(client, "users/").json()
    assert body["count"] == 3
    row = next(r for r in body["results"] if r["id"] == str(rahim.id))
    assert row == {
        "id": str(rahim.id), "name": "Person", "email": "rahim@du.ac.bd", "email_verified": True,
        "status": "active", "created_at": row["created_at"], "last_login_at": None,
        "memberships": [{"membership_id": row["memberships"][0]["membership_id"],
                         "institution": {"slug": "du", "name": "University of Dhaka"}, "role": "admin",
                         "status": "active", "coverage": "institution", "label": "covered"}],
        "is_superadmin": False,
    }
    assert next(r for r in body["results"] if r["id"] == str(boss.id))["is_superadmin"] is True

    def ids(**params):
        return {r["id"] for r in get(client, "users/", **params).json()["results"]}

    assert ids(q="KARIM") == {str(karim.id)}
    assert ids(status="suspended") == {str(karim.id)}
    assert ids(institution="du") == {str(rahim.id)}
    assert ids(institution="du", role="member") == set()
    assert ids(role="member") == {str(karim.id)}
    assert error(get(client, "users/", status="lost")) == (400, "invalid")


def test_users_list_query_count_does_not_grow_with_rows(client):
    def count_queries():
        with CaptureQueriesContext(connection) as ctx:
            assert get(client, "users/").status_code == 200
        return len(ctx)

    few = count_queries()
    for i in range(10):
        org = make_org(f"org-{i}")
        add_member(org, email=f"p{i}@du.ac.bd")
        add_member(org, email=f"q{i}@du.ac.bd", role=ADMIN)
    assert count_queries() == few
    assert few <= 7


def test_user_detail(client, org, boss):
    user = add_member(org, email="rahim@du.ac.bd").user
    ExternalIdentity.objects.create(user=user, issuer="https://idp.du.ac.bd", subject="r-1", provider_type="saml")
    patch(client, f"users/{user.id}/", {"status": "suspended", "reason": "Abuse"})
    AuditLog.objects.create(actor=user, action="profile.updated", target_type="User", target_id=user.id)

    body = get(client, f"users/{user.id}/").json()
    assert body["zitadel_subject"] == user.zitadel_subject and body["issuer"] == user.issuer
    assert body["external_identities"][0]["subject"] == "r-1"
    assert [e["action"] for e in body["recent_activity"]] == ["profile.updated", "user.status_changed"]
    assert body["status"] == "suspended" and body["memberships"][0]["institution"]["slug"] == "du"
    assert error(get(client, "users/7d1c4c9e-5d0b-4a0c-9d7e-2b9f0f0a1b2c/")) == (404, "not_found")


def test_suspending_a_user_ends_their_sessions(client, boss):
    other = make_superadmin("second@bdren.ai", name="Second")
    theirs = signed_in(other)
    assert get(theirs, "session/").status_code == 200

    assert error(patch(client, f"users/{other.id}/", {"status": "suspended"})) == (400, "invalid")
    r = patch(client, f"users/{other.id}/", {"status": "suspended", "reason": "Compromised"})
    assert r.status_code == 200 and r.json()["status"] == "suspended"
    assert error(get(theirs, "session/")) == (401, "not_authenticated")
    entry = last_audit("user.status_changed")
    assert entry.metadata["sessions_ended"] == 1 and entry.metadata["reason"] == "Compromised"
    assert entry.target_id == str(other.id) and entry.actor == boss
    assert get(client, "session/").status_code == 200

    r = patch(client, f"users/{other.id}/", {"status": "active", "reason": "Cleared"})
    assert r.json()["status"] == "active"
    r = patch(client, f"users/{boss.id}/", {"status": "suspended", "reason": "x"})
    assert error(r) == (409, "cannot_suspend_self")
    assert error(patch(client, f"users/{other.id}/", {"status": "deactivated", "reason": "x"})) == (400, "invalid")
    assert Session.objects.count() == 1


# ---------------------------------------------------------------- invitations

def test_invitations_list_filters(client, org, boss):
    live, _ = make_invitation(org, "live@du.ac.bd", invited_by=boss)
    old, _ = make_invitation(org, "old@du.ac.bd", expired=True)
    solo, _ = make_invitation(None, "solo@gmail.com")
    make_invitation(make_org("buet"), "x@buet.ac.bd", status=Invitation.Status.REVOKED)

    body = get(client, "invitations/").json()
    assert body["count"] == 4
    row = next(r for r in body["results"] if r["id"] == str(live.id))
    assert row["institution"] == {"slug": "du", "name": "University of Dhaka"} and row["status"] == "pending"
    assert row["invited_by"] == {"id": str(boss.id), "name": "Platform Boss", "email": "boss@bdren.ai"}

    def ids(**params):
        return {r["id"] for r in get(client, "invitations/", **params).json()["results"]}

    assert ids(status="pending") == {str(live.id), str(solo.id)}
    assert ids(status="expired") == {str(old.id)}
    assert ids(institution="du") == {str(live.id), str(old.id)}
    assert ids(q="SOLO") == {str(solo.id)}
    assert error(get(client, "invitations/", status="lost")) == (400, "invalid")


def test_invite_to_an_existing_institution(client, org, boss):
    r = post(client, "invitations/", {"institution": "du", "email": "New@DU.ac.bd", "name": "New", "role": "admin"})
    assert r.status_code == 201
    body = r.json()
    assert body["invitation"]["email"] == "new@du.ac.bd" and body["invitation"]["role"] == "admin"
    assert body["institution"]["seats"] == {"used": 1, "cap": 10} and "warning" not in body
    entry = last_audit("invitation.created")
    assert entry.actor == boss and entry.metadata["organization_id"] == str(org.id)

    assert error(post(client, "invitations/", {"institution": "du", "email": "new@du.ac.bd", "role": "admin"})) == (
        409, "already_invited")
    member = add_member(org, email="member@du.ac.bd")
    assert error(post(client, "invitations/", {"institution": "du", "email": member.user.email, "role": "member"})) == (
        409, "already_member")
    assert error(post(client, "invitations/", {"institution": "du", "email": "x@du.ac.bd"})) == (400, "invalid")
    assert error(post(client, "invitations/", {"institution": "du", "email": "x@du.ac.bd", "role": "king"})) == (
        400, "bad_role")
    r = post(client, "invitations/", {"institution": "nowhere", "email": "x@du.ac.bd", "role": "member"})
    assert error(r) == (400, "invalid") and "institution" in r.json()["fields"]
    assert error(post(client, "invitations/", {"email": "x@du.ac.bd"})) == (400, "invalid")

    org.seat_cap = 2
    org.save()
    r = post(client, "invitations/", {"institution": "du", "email": "full@du.ac.bd", "role": "member"})
    assert error(r) == (409, "seat_cap_reached") and (r.json()["seats_used"], r.json()["seat_cap"]) == (2, 2)

    org.seat_cap = None
    org.status = Organization.Status.SUSPENDED
    org.save()
    r = post(client, "invitations/", {"institution": "du", "email": "late@du.ac.bd", "role": "member"})
    assert r.status_code == 201 and r.json()["warning"] == "institution_suspended"
    org.status = Organization.Status.DEACTIVATED
    org.save()
    r = post(client, "invitations/", {"institution": "du", "email": "gone@du.ac.bd", "role": "member"})
    assert error(r) == (409, "institution_inactive")


def test_invite_an_individual(client):
    r = post(client, "invitations/", {"institution": None, "email": "solo@gmail.com", "name": "Solo", "role": "owner"})
    assert r.status_code == 201
    body = r.json()
    assert body["institution"] is None and body["invitation"]["institution"] is None
    assert body["invitation"]["role"] is None and body["email_sent"] is False


def test_invite_with_a_new_institution(client):
    body = {"new_institution": {"name": "New College", "slug": "new-college", "seat_cap": 50,
                                "sign_in_domains": ["new.edu"]},
            "email": "head@new.edu", "name": "Head", "role": "admin"}
    r = post(client, "invitations/", body)
    assert r.status_code == 201
    assert r.json()["institution"]["slug"] == "new-college" and r.json()["institution"]["seats"]["used"] == 1
    assert r.json()["invitation"]["institution"] == {"slug": "new-college", "name": "New College"}

    other_college = {**body["new_institution"], "slug": "other-college"}
    r = post(client, "invitations/", {**body, "new_institution": other_college, "email": "x@gmail.com"})
    assert error(r) == (409, "domain_taken") and "new_institution.sign_in_domains" in r.json()["fields"]
    other_college["sign_in_domains"] = ["other.edu"]
    r = post(client, "invitations/", {**body, "new_institution": other_college, "email": "not-an-email"})
    assert error(r) == (400, "invalid") and "email" in r.json()["fields"]
    assert not Organization.objects.filter(slug="other-college").exists()
    r = post(client, "invitations/", {**body, "new_institution": {"name": "Y", "slug": "Bad Slug"}})
    assert error(r) == (400, "invalid")
    assert set(r.json()["fields"]) == {"new_institution.name", "new_institution.slug"}
    assert error(post(client, "invitations/", {**body, "new_institution": "x"})) == (400, "invalid")
    r = post(client, "invitations/", {**body, "new_institution": {"name": "Third", "slug": "third"}, "role": None})
    assert error(r) == (400, "bad_role") and "role" in r.json()["fields"]
    assert not Organization.objects.filter(slug="third").exists()


@pytest.mark.django_db(transaction=True)
def test_resend_and_revoke():
    boss = make_superadmin()
    client = signed_in(boss)
    org = make_org("du", name="University of Dhaka")
    invitation, old_token = make_invitation(org, "late@du.ac.bd", expired=True)

    r = post(client, f"invitations/{invitation.id}/resend/")
    assert r.status_code == 200
    assert r.json()["email_sent"] is True and r.json()["invitation"]["sent_count"] == 2
    assert r.json()["invitation"]["status"] == "pending"
    (token,) = sent_tokens()
    invitation.refresh_from_db()
    assert invitation.token_hash == hash_token(token) != hash_token(old_token)
    assert last_audit("invitation.resent").metadata["source"] == "superadmin"

    r = post(client, f"invitations/{invitation.id}/revoke/", {"reason": "Wrong person"})
    assert r.status_code == 200 and r.json()["invitation"]["status"] == "revoked"
    assert last_audit("invitation.revoked").metadata["reason"] == "Wrong person"
    assert error(post(client, f"invitations/{invitation.id}/revoke/")) == (409, "invitation_not_pending")
    assert error(post(client, f"invitations/{invitation.id}/resend/")) == (409, "invitation_not_pending")
    assert error(post(client, "invitations/7d1c4c9e-5d0b-4a0c-9d7e-2b9f0f0a1b2c/resend/")) == (404, "not_found")


@pytest.mark.django_db(transaction=True)
def test_resend_expired():
    client = signed_in(make_superadmin())
    du = make_org("du")
    buet = make_org("buet")
    make_invitation(du, "a@du.ac.bd", expired=True)
    make_invitation(buet, "b@buet.ac.bd", expired=True)
    make_invitation(du, "live@du.ac.bd")

    r = post(client, "invitations/resend-expired/", {"institution": "du"})
    assert r.json() == {"resent": 1, "email_failures": 0, "email_queued": 0}
    assert post(client, "invitations/resend-expired/").json() == {"resent": 1, "email_failures": 0, "email_queued": 0}
    assert len(mail.outbox) == 2
    assert error(post(client, "invitations/resend-expired/", {"institution": "nowhere"})) == (400, "invalid")


# ---------------------------------------------------------------- admins

def test_admins_list_add_and_remove(client, boss):
    second = make_user("second@bdren.ai", name="Second")
    make_user("twin@bdren.ai")
    make_user("TWIN@bdren.ai")

    r = post(client, "admins/", {"email": "Second@BDREN.ai"})
    assert r.status_code == 201 and r.json()["user"]["id"] == str(second.id) and r.json()["granted_at"]
    grant = last_audit("platform_role.granted")
    assert grant.target_id == str(second.id) and grant.actor == boss and grant.metadata["role"] == SUPER

    body = get(client, "admins/").json()
    assert [a["user"]["email"] for a in body["results"]] == ["boss@bdren.ai", "second@bdren.ai"]
    assert body["results"][0]["user"]["status"] == "active"

    assert error(post(client, "admins/", {"user_id": str(second.id)})) == (409, "already_superadmin")
    assert error(post(client, "admins/", {"email": "twin@bdren.ai"})) == (409, "ambiguous_email")
    assert error(post(client, "admins/", {"email": "nobody@bdren.ai"})) == (404, "not_found")
    assert error(post(client, "admins/", {"user_id": "not-a-uuid"})) == (400, "invalid")
    assert error(post(client, "admins/", {})) == (400, "invalid")

    assert error(client.delete(API + f"admins/{boss.id}/")) == (409, "cannot_remove_self")
    r = client.delete(API + f"admins/{second.id}/")
    assert r.status_code == 204
    assert not PlatformRoleAssignment.objects.filter(user=second).exists()
    assert last_audit("platform_role.revoked").target_id == str(second.id)
    assert error(client.delete(API + f"admins/{second.id}/")) == (404, "not_found")


def test_the_last_superadmin_cannot_be_removed(boss):
    with pytest.raises(ServiceError) as e:
        services.revoke_superadmin(boss.id, actor=make_user("support@bdren.ai"))
    assert (e.value.code, e.value.status) == ("last_superadmin", 409)
    assert PlatformRoleAssignment.objects.filter(user=boss, role=SUPER).exists()


# ---------------------------------------------------------------- audit

def test_audit_filters(client, org, boss):
    other = make_user("other@bdren.ai")
    old = AuditLog.objects.create(actor=other, action="organization.created", target_type="Organization",
                                  target_id=org.id)
    AuditLog.objects.filter(pk=old.pk).update(created_at=timezone.now() - timedelta(days=10))
    patch(client, "institutions/du/", {"name": "Dhaka University"})
    post(client, "invitations/", {"institution": "du", "email": "new@du.ac.bd", "role": "member"})

    body = get(client, "audit/").json()
    assert body["count"] == 3
    entry = body["results"][0]
    assert entry["action"] == "invitation.created" and entry["actor"]["id"] == str(boss.id)
    assert entry["ip_address"] == "127.0.0.1" and entry["metadata"]["email"] == "new@du.ac.bd"

    def actions(**params):
        return [e["action"] for e in get(client, "audit/", **params).json()["results"]]

    assert actions(action="organization.updated") == ["organization.updated"]
    assert actions(actor=str(other.id)) == ["organization.created"]
    by_target = actions(target_type="Organization", target_id=str(org.id))
    assert by_target == ["organization.updated", "organization.created"]
    assert actions(q="INVITATION") == ["invitation.created"]
    assert actions(q="other@bdren") == ["organization.created"]
    since = (timezone.now() - timedelta(days=1)).date().isoformat()
    assert len(actions(**{"from": since})) == 2
    assert actions(to=(timezone.now() - timedelta(days=5)).date().isoformat()) == ["organization.created"]
    assert error(get(client, "audit/", actor="me")) == (400, "invalid")
    assert error(get(client, "audit/", **{"from": "yesterday"})) == (400, "invalid")


# ---------------------------------------------------------------- review fixes

def test_granting_superadmin_by_email_matches_only_a_verified_account(client):
    """A self-registered account with someone else's unverified email must never receive the role."""
    squatter = make_user("newadmin@bdren.ai", verified=False)
    r = post(client, "admins/", {"email": "newadmin@bdren.ai"})
    assert error(r) == (404, "not_found") and "by id" in r.json()["message"]

    real = make_user("NewAdmin@bdren.ai")
    r = post(client, "admins/", {"email": "newadmin@bdren.ai"})
    assert r.status_code == 201 and r.json()["user"]["id"] == str(real.id)
    assert not PlatformRoleAssignment.objects.filter(user=squatter).exists()


def test_audit_records_the_client_address_behind_the_proxy(client, org):
    behind_nginx = {"REMOTE_ADDR": "172.18.0.5", "HTTP_X_REAL_IP": "203.0.113.7"}
    r = client.post(API + "invitations/", {"institution": "du", "email": "a@du.ac.bd", "role": "member"},
                    content_type="application/json", **behind_nginx)
    assert r.status_code == 201 and last_audit("invitation.created").ip_address == "203.0.113.7"

    direct = {"REMOTE_ADDR": "198.51.100.1", "HTTP_X_REAL_IP": "203.0.113.99"}
    r = client.post(API + "invitations/", {"institution": "du", "email": "b@du.ac.bd", "role": "member"},
                    content_type="application/json", **direct)
    assert r.status_code == 201
    assert AuditLog.objects.get(action="invitation.created", metadata__email="b@du.ac.bd").ip_address == "198.51.100.1"


def test_client_ip_trusts_x_real_ip_only_from_configured_proxies(rf, settings):
    settings.TRUSTED_PROXIES = ["10.0.0.0/8"]
    assert client_ip(rf.get("/", REMOTE_ADDR="10.1.2.3", HTTP_X_REAL_IP="2001:db8::1")) == "2001:db8::1"
    assert client_ip(rf.get("/", REMOTE_ADDR="10.1.2.3", HTTP_X_REAL_IP="not an ip")) == "10.1.2.3"
    assert client_ip(rf.get("/", REMOTE_ADDR="127.0.0.1", HTTP_X_REAL_IP="203.0.113.7")) == "127.0.0.1"
    assert client_ip(rf.get("/", REMOTE_ADDR="")) is None


def test_invitation_sending_is_rate_limited_per_admin(client, org, settings):
    cache.clear()
    settings.INVITATION_SEND_RATE = "2/min"
    for email in ("a@du.ac.bd", "b@du.ac.bd"):
        assert post(client, "invitations/", {"institution": "du", "email": email, "role": "member"}).status_code == 201
    assert error(post(client, "invitations/", {"institution": "du", "email": "c@du.ac.bd", "role": "member"})) == (
        429, "throttled"
    )
    assert error(post(client, "invitations/resend-expired/")) == (429, "throttled")
    assert get(client, "invitations/").status_code == 200
    assert signed_in(make_superadmin("second@bdren.ai")).post(
        API + "invitations/resend-expired/", {}, content_type="application/json"
    ).status_code == 200
    cache.clear()


def test_suspending_a_user_touches_only_their_sessions(client, boss, monkeypatch):
    other = make_superadmin("second@bdren.ai", name="Second")
    theirs = [signed_in(other), signed_in(other)]
    bystanders = [signed_in(make_user(f"u{i}@du.ac.bd")) for i in range(3)]
    decoded = []
    original = Session.get_decoded
    monkeypatch.setattr(Session, "get_decoded", lambda self: decoded.append(self.pk) or original(self))

    r = patch(client, f"users/{other.id}/", {"status": "suspended", "reason": "Compromised"})
    assert r.status_code == 200 and decoded == []
    assert last_audit("user.status_changed").metadata["sessions_ended"] == 2
    assert all(error(get(c, "session/")) == (401, "not_authenticated") for c in theirs)
    assert Session.objects.count() == 1 + len(bystanders)
    assert not UserSession.objects.filter(user=other).exists()


def test_signing_out_and_expired_sessions_are_forgotten(boss):
    first = signed_in(boss)
    assert UserSession.objects.filter(user=boss).count() == 1
    assert first.post("/api/v1/auth/logout/").status_code == 200
    assert not UserSession.objects.filter(user=boss).exists()

    signed_in(boss)
    Session.objects.update(expire_date=timezone.now() - timedelta(minutes=1))
    signed_in(boss)
    assert UserSession.objects.filter(user=boss).count() == 1


def test_audit_target_lookups_are_indexed():
    with connection.cursor() as cursor:
        constraints = connection.introspection.get_constraints(cursor, AuditLog._meta.db_table)
    assert constraints["audit_target"]["columns"] == ["target_type", "target_id", "created_at"]
