"""Institution-admin portal API (/api/v1/portal/): access rules, every endpoint and its 4xx paths."""
import threading
import uuid

import pytest
from django.core import mail
from django.core.cache import cache
from django.db import connection
from django.test import Client

from apps.administration.models import PlatformRoleAssignment
from apps.audit.models import AuditLog
from apps.invitations import services
from apps.invitations.errors import ServiceError
from apps.invitations.models import Invitation, hash_token
from apps.organizations.models import Membership, Organization
from apps.portal import services as portal
from tests.factories import add_member, make_invitation, make_org, make_user, sent_tokens

pytestmark = pytest.mark.django_db

BASE = "/api/v1/portal/institutions/"


def signed_in(user, **kw):
    c = Client(**kw)
    c.force_login(user)
    return c


def call(client, method, path, body=None, **query):
    """GET sends `query` as the query string; other methods send `body` as JSON."""
    if method == "get":
        return client.get(BASE + path, query)
    return getattr(client, method)(BASE + path, {} if body is None else body, content_type="application/json")


def error(response):
    return response.status_code, response.json()["error"]


@pytest.fixture
def org():
    return make_org("du", name="University of Dhaka", seat_cap=10)


@pytest.fixture
def other():
    org = make_org("buet", name="BUET")
    add_member(org, make_user("chief@buet.ac.bd"), role=Membership.Role.ADMIN)
    return org


@pytest.fixture
def owner(org):
    return add_member(org, make_user("owner@du.ac.bd", name="Owner"), role=Membership.Role.OWNER)


@pytest.fixture
def admin(org, owner):
    return add_member(org, make_user("admin@du.ac.bd", name="Admin"), role=Membership.Role.ADMIN)


@pytest.fixture
def member(org):
    return add_member(org, make_user("member@du.ac.bd", name="Member"))


@pytest.fixture
def client(admin):
    return signed_in(admin.user)


def portal_audits(action):
    return list(AuditLog.objects.filter(action=action, metadata__source="portal"))


# ---------------------------------------------------------------- access

def test_anonymous_callers_get_401_everywhere(org, member):
    anon = Client()
    paths = [("get", ""), ("get", "du/"), ("get", "du/members/"), ("get", "du/invitations/"),
             ("post", "du/invitations/"), ("post", "du/import/"),
             ("patch", f"du/members/{member.id}/"), ("post", f"du/members/{member.id}/remove/")]
    for method, path in paths:
        assert error(call(anon, method, path)) == (401, "not_authenticated"), path


def test_unsafe_methods_need_the_csrf_token(admin):
    strict = signed_in(admin.user, enforce_csrf_checks=True)
    r = call(strict, "post", "du/invitations/", {"email": "x@du.ac.bd"})
    assert error(r) == (403, "forbidden") and r.json()["message"]
    assert not Invitation.objects.exists()


def test_framework_errors_use_the_contract_shape(client):
    assert error(call(client, "delete", "du/members/")) == (405, "method_not_allowed")
    r = client.post(BASE + "du/invitations/", "{not json", content_type="application/json")
    assert error(r) == (400, "invalid")


def test_a_suspended_user_is_signed_out(client, admin):
    admin.user.status = admin.user.Status.SUSPENDED
    admin.user.save()
    assert error(call(client, "get", "du/")) == (401, "not_authenticated")


def test_admin_of_one_institution_cannot_touch_another(client, other):
    their_member = add_member(other)
    their_invite, _ = make_invitation(other, "x@buet.ac.bd")
    attempts = [
        ("get", "buet/", None), ("get", "buet/members/", None), ("get", "buet/invitations/", None),
        ("post", "buet/invitations/", {"email": "spy@buet.ac.bd"}),
        ("post", "buet/import/", {"rows": [{"email": "spy@buet.ac.bd"}], "dry_run": False}),
        ("patch", f"buet/members/{their_member.id}/", {"status": "suspended"}),
        ("post", f"buet/members/{their_member.id}/remove/", None),
        ("post", f"buet/invitations/{their_invite.id}/resend/", None),
        ("post", f"buet/invitations/{their_invite.id}/revoke/", None),
        ("get", "nowhere/", None),
    ]
    for method, path, body in attempts:
        assert error(call(client, method, path, body)) == (404, "not_found"), path
    their_member.refresh_from_db()
    their_invite.refresh_from_db()
    assert their_member.status == Membership.Status.ACTIVE and their_invite.sent_count == 1
    assert Invitation.objects.filter(organization=other).count() == 1


def test_ids_from_another_institution_are_not_found_under_your_own_slug(client, other):
    their_member = add_member(other)
    their_invite, _ = make_invitation(other, "x@buet.ac.bd")
    attempts = [
        ("patch", f"du/members/{their_member.id}/", {"status": "suspended"}),
        ("post", f"du/members/{their_member.id}/remove/", None),
        ("post", f"du/invitations/{their_invite.id}/resend/", None),
        ("post", f"du/invitations/{their_invite.id}/revoke/", None),
        ("post", f"du/invitations/{uuid.uuid4()}/revoke/", None),
    ]
    for method, path, body in attempts:
        assert error(call(client, method, path, body)) == (404, "not_found"), path
    their_member.refresh_from_db()
    their_invite.refresh_from_db()
    assert their_member.status == Membership.Status.ACTIVE
    assert their_invite.status == Invitation.Status.PENDING and their_invite.sent_count == 1


@pytest.mark.parametrize("role", [Membership.Role.MEMBER, Membership.Role.BILLING])
def test_members_and_billing_managers_cannot_use_the_portal(org, role):
    m = add_member(org, role=role)
    c = signed_in(m.user)
    for method, path in [("get", "du/"), ("get", "du/members/"), ("post", "du/invitations/")]:
        assert error(call(c, method, path, {"email": "x@du.ac.bd"})) == (403, "not_institution_admin")
    assert call(c, "get", "").json() == []
    assert not Invitation.objects.exists()


@pytest.mark.parametrize("status", [Membership.Status.SUSPENDED, Membership.Status.PENDING,
                                    Membership.Status.DEPROVISIONED])
def test_inactive_admin_memberships_grant_nothing(org, status):
    m = add_member(org, role=Membership.Role.ADMIN, status=status)
    c = signed_in(m.user)
    assert error(call(c, "get", "du/")) == (404, "not_found")
    assert call(c, "get", "").json() == []


def test_superadmins_get_no_implicit_access(org, member):
    boss = make_user("boss@bdren.ai")
    PlatformRoleAssignment.objects.create(user=boss, role=PlatformRoleAssignment.Role.SUPER_ADMIN)
    c = signed_in(boss)
    assert call(c, "get", "").json() == []
    assert error(call(c, "get", "du/")) == (404, "not_found")
    assert error(call(c, "patch", f"du/members/{member.id}/", {"status": "suspended"})) == (404, "not_found")


def test_suspended_institution_is_403_for_reads_and_writes(org, client, member):
    org.status = Organization.Status.SUSPENDED
    org.save()
    for method, path, body in [("get", "du/", None), ("get", "du/members/", None),
                               ("post", "du/invitations/", {"email": "x@du.ac.bd"}),
                               ("patch", f"du/members/{member.id}/", {"status": "suspended"})]:
        assert error(call(client, method, path, body)) == (403, "institution_suspended"), path
    assert not Invitation.objects.exists()


def test_deactivated_institution_is_403_and_not_listed(org, client):
    org.status = Organization.Status.DEACTIVATED
    org.save()
    assert error(call(client, "get", "du/")) == (403, "institution_inactive")
    assert call(client, "get", "").json() == []


# ---------------------------------------------------------------- reads

def test_institutions_lists_only_those_you_administer(org, other, admin):
    make_invitation(org, "live@du.ac.bd")
    assert call(signed_in(admin.user), "get", "").json() == [
        {"slug": "du", "name": "University of Dhaka", "status": "active",
         "seats": {"used": 3, "cap": 10}, "role": "admin"},
    ]
    third = make_org("ru", name="Rajshahi University")
    head = add_member(third, make_user("head@ru.ac.bd"), role=Membership.Role.OWNER)
    third.status = Organization.Status.SUSPENDED
    third.save()
    assert call(signed_in(head.user), "get", "").json() == [
        {"slug": "ru", "name": "Rajshahi University", "status": "suspended",
         "seats": {"used": 1, "cap": None}, "role": "owner"},
    ]


def test_institution_summary_has_seats_counts_and_domains(org, client, member):
    org.sign_in_domains = ["du.ac.bd"]
    org.save()
    add_member(org, status=Membership.Status.SUSPENDED)
    add_member(org, status=Membership.Status.PENDING)
    add_member(org, status=Membership.Status.DEPROVISIONED)
    make_invitation(org, "live@du.ac.bd")
    make_invitation(org, "old@du.ac.bd", expired=True)
    make_invitation(org, "gone@du.ac.bd", status=Invitation.Status.REVOKED)

    assert call(client, "get", "du/").json() == {
        "slug": "du", "name": "University of Dhaka", "seats": {"used": 5, "cap": 10},  # suspended keeps a seat
        "counts": {"members": 4, "active": 3, "suspended": 1, "pending_invitations": 1,
                   "expired_invitations": 1, "pending_requests": 1, "not_covered": 0, "personal_plan": 0},
        "sign_in_domains": ["du.ac.bd"],
    }


def test_members_list_filters_searches_and_pages(org, client, admin, member):
    add_member(org, make_user("susp@du.ac.bd", name="Suspended One"), status=Membership.Status.SUSPENDED)
    gone = add_member(org, status=Membership.Status.DEPROVISIONED)

    body = call(client, "get", "du/members/").json()
    assert body["count"] == 4 and body["page"] == 1 and body["page_size"] == 25
    assert gone.id not in {r["membership_id"] for r in body["results"]}
    row = next(r for r in body["results"] if r["membership_id"] == str(member.id))
    assert row["user"] == {"id": str(member.user.id), "name": "Member", "email": "member@du.ac.bd",
                           "status": "active"}
    assert row["role"] == "member" and row["status"] == "active" and row["joined_at"].endswith("Z")
    assert row["coverage"] == "institution" and row["label"] == "covered"

    def emails(**query):
        return [r["user"]["email"] for r in call(client, "get", "du/members/", **query).json()["results"]]

    assert emails(status="suspended") == ["susp@du.ac.bd"]
    assert error(call(client, "get", "du/members/", status="deprovisioned")) == (400, "invalid")
    assert sorted(emails(role="admin")) == ["admin@du.ac.bd"]
    assert emails(q="MEMBER@du") == ["member@du.ac.bd"]
    assert emails(q="suspended one") == ["susp@du.ac.bd"]
    paged = call(client, "get", "du/members/", page=2, page_size=3).json()
    assert paged["count"] == 4 and len(paged["results"]) == 1 and paged["page_size"] == 3
    assert call(client, "get", "du/members/", page_size=500).json()["page_size"] == 100


@pytest.mark.parametrize("query", [{"status": "bogus"}, {"role": "king"}, {"page": "0"}, {"page": "x"},
                                   {"page_size": "-1"}])
def test_members_list_rejects_bad_filters(client, query):
    r = call(client, "get", "du/members/", **query)
    assert r.status_code == 400 and r.json()["error"] == "invalid" and set(r.json()["fields"]) == set(query)


def test_invitations_list_uses_effective_status_and_hides_inviter_email(org, client, admin):
    make_invitation(org, "live@du.ac.bd", invited_by=admin.user)
    make_invitation(org, "old@du.ac.bd", expired=True)
    make_invitation(org, "gone@du.ac.bd", status=Invitation.Status.REVOKED)
    make_invitation(make_org("x"), "elsewhere@x.edu")

    body = call(client, "get", "du/invitations/").json()
    assert body["count"] == 3
    live = next(r for r in body["results"] if r["email"] == "live@du.ac.bd")
    assert live["invited_by"] == {"id": str(admin.user.id), "name": "Admin"}
    assert live["institution"] == {"slug": "du", "name": "University of Dhaka"}

    def emails(status):
        return [r["email"] for r in call(client, "get", "du/invitations/", status=status).json()["results"]]

    assert emails("pending") == ["live@du.ac.bd"]
    assert emails("expired") == ["old@du.ac.bd"]
    assert emails("revoked") == ["gone@du.ac.bd"]
    assert error(call(client, "get", "du/invitations/", status="nope")) == (400, "invalid")


# ---------------------------------------------------------------- invite

@pytest.mark.django_db(transaction=True)  # emails go out on commit, before the response reports email_sent
def test_invite_creates_a_portal_invitation_emails_it_and_audits(org, client, admin):
    r = call(client, "post", "du/invitations/", {"email": " New@DU.ac.bd ", "name": "New Person", "role": "admin"})
    assert r.status_code == 201
    body = r.json()
    assert body["email_sent"] is True
    assert body["invitation"]["email"] == "new@du.ac.bd" and body["invitation"]["role"] == "admin"
    assert body["invitation"]["source"] == "portal" and body["invitation"]["status"] == "pending"
    assert body["invitation"]["invited_by"] == {"id": str(admin.user.id), "name": "Admin"}
    invitation = Invitation.objects.get()
    assert invitation.invited_by == admin.user and invitation.token_hash == hash_token(sent_tokens()[0])
    assert "University of Dhaka" in mail.outbox[0].subject
    [entry] = portal_audits("invitation.created")
    assert entry.actor == admin.user and entry.metadata["organization_id"] == str(org.id)
    assert entry.ip_address == "127.0.0.1"


def test_invite_role_defaults_to_member(client):
    r = call(client, "post", "du/invitations/", {"email": "new@du.ac.bd"})
    assert r.status_code == 201 and r.json()["invitation"]["role"] == "member"


@pytest.mark.parametrize("role", ["owner", "billing", "king", ["admin"]])
def test_invite_refuses_roles_outside_member_and_admin(client, role):
    r = call(client, "post", "du/invitations/", {"email": "new@du.ac.bd", "role": role})
    assert error(r) == (400, "bad_role") and "role" in r.json()["fields"]
    assert not Invitation.objects.exists()


def test_invite_4xx_paths(org, client, member):
    assert error(call(client, "post", "du/invitations/", {"email": "not-an-email"})) == (400, "invalid")
    assert error(call(client, "post", "du/invitations/", ["x"])) == (400, "invalid")
    assert error(call(client, "post", "du/invitations/", {"email": "member@du.ac.bd"})) == (409, "already_member")
    assert call(client, "post", "du/invitations/", {"email": "a@du.ac.bd"}).status_code == 201
    assert error(call(client, "post", "du/invitations/", {"email": "a@du.ac.bd"})) == (409, "already_invited")
    org.sign_in_domains = ["du.ac.bd"]
    org.save()
    assert call(client, "post", "du/invitations/", {"email": "x@gmail.com"}).status_code == 201


def test_invite_is_seat_checked(org, client):
    org.seat_cap = 3  # owner + admin + one more
    org.save()
    assert call(client, "post", "du/invitations/", {"email": "a@du.ac.bd"}).status_code == 201
    r = call(client, "post", "du/invitations/", {"email": "b@du.ac.bd"})
    assert error(r) == (409, "seat_cap_reached")
    assert r.json()["seats_used"] == 3 and r.json()["seat_cap"] == 3


# ---------------------------------------------------------------- resend / revoke

@pytest.mark.django_db(transaction=True)  # emails go out on commit, before the response reports email_sent
def test_resend_issues_a_new_link(org, client):
    invitation, old_token = make_invitation(org, "a@du.ac.bd")
    r = call(client, "post", f"du/invitations/{invitation.id}/resend/")
    assert r.status_code == 200 and r.json()["email_sent"] is True
    assert r.json()["invitation"]["sent_count"] == 2
    invitation.refresh_from_db()
    assert invitation.token_hash != hash_token(old_token)
    assert invitation.token_hash == hash_token(sent_tokens()[0])
    assert len(portal_audits("invitation.resent")) == 1


def test_resend_4xx_paths(org, client):
    revoked, _ = make_invitation(org, "r@du.ac.bd", status=Invitation.Status.REVOKED)
    assert error(call(client, "post", f"du/invitations/{revoked.id}/resend/")) == (409, "invitation_not_pending")
    org.seat_cap = 2
    org.save()
    expired, _ = make_invitation(org, "e@du.ac.bd", expired=True)
    assert error(call(client, "post", f"du/invitations/{expired.id}/resend/")) == (409, "seat_cap_reached")


def test_revoke_then_revoke_again(org, client):
    invitation, _ = make_invitation(org, "a@du.ac.bd")
    r = call(client, "post", f"du/invitations/{invitation.id}/revoke/", {"reason": "typo"})
    assert r.status_code == 200 and r.json()["invitation"]["status"] == "revoked"
    [entry] = portal_audits("invitation.revoked")
    assert entry.metadata["reason"] == "typo" and entry.metadata["organization_id"] == str(org.id)
    assert error(call(client, "post", f"du/invitations/{invitation.id}/revoke/")) == (409, "invitation_not_pending")


# ---------------------------------------------------------------- import

def test_import_is_a_dry_run_unless_asked(client):
    rows = [{"email": "a@du.ac.bd"}, {"email": "b@du.ac.bd", "role": "admin"}]
    r = call(client, "post", "du/import/", {"rows": rows})
    assert r.status_code == 200
    assert r.json()["summary"]["ok"] == 2 and r.json()["summary"]["fits"] == 2 and r.json()["created"] == 0
    assert not Invitation.objects.exists() and not mail.outbox


@pytest.mark.django_db(transaction=True)  # emails go out on commit, before the response reports email_sent
def test_import_creates_rows_within_member_and_admin_roles_up_to_the_cap(org, client, member):
    org.seat_cap = 5  # owner, admin, member + 2
    org.save()
    rows = [{"email": "a@du.ac.bd"}, {"email": "boss@du.ac.bd", "role": "owner"},
            {"email": "pay@du.ac.bd", "role": "billing"}, {"email": "member@du.ac.bd"},
            {"email": "b@du.ac.bd", "role": "admin"}, {"email": "c@du.ac.bd"}]
    body = call(client, "post", "du/import/", {"rows": rows, "dry_run": False}).json()
    assert [(row["status"], row["reason"]) for row in body["rows"]] == [
        ("ok", None), ("error", "bad_role"), ("error", "bad_role"), ("skip", "already_member"),
        ("ok", None), ("error", "over_cap"),
    ]
    assert body["created"] == 2 and body["email_failures"] == 0 and len(mail.outbox) == 2
    assert set(Invitation.objects.values_list("email", "role")) == {("a@du.ac.bd", "member"), ("b@du.ac.bd", "admin")}
    assert len(portal_audits("invitation.created")) == 2
    [entry] = portal_audits("organization.members_imported")
    assert entry.metadata["created"] == 2 and entry.metadata["organization_id"] == str(org.id)


def test_import_4xx_paths(client):
    assert error(call(client, "post", "du/import/", {"rows": "a@du.ac.bd"})) == (400, "invalid")
    assert error(call(client, "post", "du/import/", {"rows": [], "dry_run": "no"})) == (400, "invalid")
    assert error(call(client, "post", "du/import/", {"rows": [{}] * 1001})) == (400, "too_many_rows")


# ---------------------------------------------------------------- members

def test_promote_suspend_and_reactivate_a_member(org, client, member):
    r = call(client, "patch", f"du/members/{member.id}/", {"role": "admin"})
    assert r.status_code == 200 and r.json()["role"] == "admin"
    r = call(client, "patch", f"du/members/{member.id}/", {"status": "suspended", "reason": "left"})
    assert r.json()["status"] == "suspended"
    r = call(client, "patch", f"du/members/{member.id}/", {"status": "active", "role": "member"})
    assert r.json()["status"] == "active" and r.json()["role"] == "member"
    entries = sorted(portal_audits("membership.updated"), key=lambda e: e.created_at)
    assert [e.metadata["changes"] for e in entries] == [
        {"role": ["member", "admin"]},
        {"status": ["active", "suspended"]},
        {"role": ["admin", "member"], "status": ["suspended", "active"]},
    ]
    assert all(e.metadata["organization_id"] == str(org.id) for e in entries)
    assert entries[1].metadata["reason"] == "left"


def test_sign_up_requests_are_hidden_and_reactivating_needs_no_new_seat(org, client):
    request = add_member(org, status=Membership.Status.PENDING)
    suspended = add_member(org, status=Membership.Status.SUSPENDED)
    org.seat_cap = 3
    org.save()
    assert error(call(client, "patch", f"du/members/{request.id}/", {"status": "active"})) == (404, "not_found")
    assert request.id not in {r["membership_id"] for r in call(client, "get", "du/members/").json()["results"]}
    r = call(client, "patch", f"du/members/{suspended.id}/", {"status": "active"})
    assert r.status_code == 200 and r.json()["status"] == "active"


def test_member_changes_4xx_paths(org, client, admin, owner, member):
    path = f"du/members/{member.id}/"
    assert error(call(client, "patch", path, {})) == (400, "invalid")
    assert error(call(client, "patch", path, {"role": "owner"})) == (400, "bad_role")
    assert error(call(client, "patch", path, {"role": "billing"})) == (400, "bad_role")
    assert error(call(client, "patch", path, {"status": "deprovisioned"})) == (400, "invalid")
    assert error(call(client, "patch", f"du/members/{owner.id}/", {"role": "member"})) == (403, "cannot_change_owner")
    assert error(call(client, "patch", f"du/members/{admin.id}/", {"role": "member"})) == (403, "cannot_change_self")
    assert error(call(client, "patch", f"du/members/{uuid.uuid4()}/", {"role": "member"})) == (404, "not_found")
    gone = add_member(org, status=Membership.Status.DEPROVISIONED)
    assert error(call(client, "patch", f"du/members/{gone.id}/", {"status": "active"})) == (409, "membership_removed")
    member.refresh_from_db()
    owner.refresh_from_db()
    assert member.role == Membership.Role.MEMBER and owner.role == Membership.Role.OWNER
    assert not portal_audits("membership.updated")


def test_remove_uncovers_and_frees_the_seat(org, client, member):
    before = call(client, "get", "du/").json()["seats"]["used"]
    r = call(client, "post", f"du/members/{member.id}/remove/", {"reason": "graduated"})
    assert r.status_code == 200
    assert (r.json()["status"], r.json()["coverage"], r.json()["label"]) == ("active", "none", "not_covered")
    assert call(client, "get", "du/").json()["seats"]["used"] == before - 1
    [entry] = portal_audits("membership.uncovered")
    assert entry.metadata["reason"] == "graduated" and entry.metadata["organization_id"] == str(org.id)


def test_remove_4xx_paths(client, admin, owner):
    assert error(call(client, "post", f"du/members/{owner.id}/remove/")) == (403, "cannot_change_owner")
    assert error(call(client, "post", f"du/members/{admin.id}/remove/")) == (403, "cannot_change_self")
    assert error(call(client, "post", f"du/members/{uuid.uuid4()}/remove/")) == (404, "not_found")
    assert Membership.objects.filter(status=Membership.Status.DEPROVISIONED).count() == 0


def test_the_last_active_admin_stays(org):
    """No owner, two admins: one may remove the other, and the one left can neither remove nor demote itself."""
    first = add_member(org, role=Membership.Role.ADMIN)
    second = add_member(org, role=Membership.Role.ADMIN)
    c = signed_in(first.user)
    assert call(c, "post", f"du/members/{second.id}/remove/").status_code == 200
    assert error(call(c, "post", f"du/members/{first.id}/remove/")) == (403, "cannot_change_self")
    assert error(call(c, "patch", f"du/members/{first.id}/", {"role": "member"})) == (403, "cannot_change_self")
    first.refresh_from_db()
    assert first.status == Membership.Status.ACTIVE and first.role == Membership.Role.ADMIN


@pytest.mark.django_db(transaction=True)
def test_two_admins_removing_each_other_at_once_leaves_one():
    org = make_org("race")
    add_member(org, role=Membership.Role.OWNER)
    a = add_member(org, role=Membership.Role.ADMIN)
    b = add_member(org, role=Membership.Role.ADMIN)
    barrier = threading.Barrier(2)
    outcomes = []

    def attempt(actor, target):
        try:
            barrier.wait()
            portal.remove_member(actor.user, "race", target.id, {})
            outcomes.append("ok")
        except ServiceError as e:
            outcomes.append(e.code)
        finally:
            connection.close()

    threads = [threading.Thread(target=attempt, args=pair) for pair in ((a, b), (b, a))]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(outcomes) == ["not_institution_admin", "ok"]  # the one uncovered first is no longer an admin
    assert Membership.objects.filter(organization=org, role=Membership.Role.ADMIN,
                                     status=Membership.Status.ACTIVE).count() == 1


# ---------------------------------------------------------------- review fixes

def test_seat_meter_uses_the_same_rule_as_the_seat_check(org, client):
    """An invitation to someone who is already an active member takes no second seat, in both places."""
    make_invitation(org, "both@du.ac.bd", role=Membership.Role.ADMIN)
    add_member(org, make_user("both@du.ac.bd"))
    used = call(client, "get", "du/").json()["seats"]["used"]
    assert used == services.seats_used(org) == 3  # owner, admin, the member; the invitation is not counted twice


def test_resend_and_invite_are_limited(org, client, settings):
    invitation, _ = make_invitation(org, "a@du.ac.bd")
    assert call(client, "post", f"du/invitations/{invitation.id}/resend/").status_code == 200
    r = call(client, "post", f"du/invitations/{invitation.id}/resend/")
    assert error(r) == (429, "resend_too_soon") and r.json()["retry_after"] > 0

    cache.clear()
    settings.INVITATION_SEND_RATE = "1/min"
    assert call(client, "post", "du/invitations/", {"email": "b@du.ac.bd"}).status_code == 201
    assert error(call(client, "post", "du/invitations/", {"email": "c@du.ac.bd"})) == (429, "throttled")
    assert error(call(client, "post", "du/import/", {"rows": []})) == (429, "throttled")
    assert call(client, "get", "du/invitations/").status_code == 200
    cache.clear()
