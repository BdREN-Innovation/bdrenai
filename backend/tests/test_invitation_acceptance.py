import pytest
from django.test import Client

from apps.accounts.models import Account
from apps.audit.models import AuditLog
from apps.invitations import services
from apps.invitations.models import Invitation
from apps.organizations.models import Membership
from tests.factories import add_member, make_invitation, make_org, make_user

pytestmark = pytest.mark.django_db


@pytest.fixture
def org():
    return make_org("du", name="University of Dhaka", seat_cap=5)


def signed_in(user, **kw):
    c = Client(**kw)
    c.force_login(user)
    return c


def accept(client, token):
    return client.post(f"/api/v1/invitations/{token}/accept/", content_type="application/json")


def test_preview_masks_the_email_until_the_matching_user_signs_in(org):
    boss = make_user("boss@bdren.ai", name="Platform Boss")
    _, token = make_invitation(org, "rahim@du.ac.bd", role=Membership.Role.ADMIN, invited_by=boss)

    anon = Client().get(f"/api/v1/invitations/{token}/").json()
    assert anon["status"] == "pending" and anon["email_masked"] == "r***@du.ac.bd"
    assert anon["email"] is None and anon["signed_in"] is False and anon["email_matches"] is False
    assert anon["institution"] == {"name": "University of Dhaka"} and anon["role"] == "admin"
    assert anon["invited_by_name"] == "Platform Boss" and anon["expires_at"].endswith("Z")

    other = signed_in(make_user("someone@du.ac.bd")).get(f"/api/v1/invitations/{token}/").json()
    assert other["signed_in"] is True and other["email_matches"] is False and other["email"] is None

    mine = signed_in(make_user("Rahim@DU.ac.bd")).get(f"/api/v1/invitations/{token}/").json()
    assert mine["email_matches"] is True and mine["email"] == "rahim@du.ac.bd"


def test_unknown_or_malformed_tokens_are_404():
    for token in ("x" * 43, "short", "bad%20chars-but-long-enough-to-pass"):
        r = Client().get(f"/api/v1/invitations/{token}/")
        assert r.status_code == 404 and r.json()["error"] == "not_found"


def test_accept_requires_sign_in_and_csrf(org):
    _, token = make_invitation(org, "rahim@du.ac.bd")
    r = accept(Client(), token)
    assert r.status_code == 401 and r.json()["error"] == "not_authenticated"
    strict = signed_in(make_user("rahim@du.ac.bd"), enforce_csrf_checks=True)
    r = accept(strict, token)
    assert r.status_code == 403 and r.json()["error"] == "forbidden"
    r = Client().get(f"/api/v1/invitations/{token}/accept/")
    assert r.status_code == 405 and r.json()["error"] == "method_not_allowed"
    assert Invitation.objects.get().status == Invitation.Status.PENDING


def test_accept_creates_an_active_membership_with_the_invited_role(org):
    inv, token = make_invitation(org, "rahim@du.ac.bd", role=Membership.Role.ADMIN)
    user = make_user("Rahim@du.ac.bd")
    used_before = services.seats_used(org)

    r = accept(signed_in(user), token)
    assert r.status_code == 200
    assert r.json() == {
        "institution": {"slug": "du", "name": "University of Dhaka"},
        "role": "admin",
        "redirect": "/admin/portal/du/members", "renewal_stopped": False,
    }
    m = Membership.objects.get(user=user, organization=org)
    assert m.role == Membership.Role.ADMIN and m.status == Membership.Status.ACTIVE
    inv.refresh_from_db()
    assert inv.status == Invitation.Status.ACCEPTED and inv.accepted_by == user and inv.accepted_at
    assert services.seats_used(org) == used_before
    assert AuditLog.objects.filter(action="invitation.accepted", metadata__organization_id=str(org.id)).exists()
    assert AuditLog.objects.filter(action="membership.joined", actor=user).exists()

    again = accept(signed_in(user), token)
    assert again.status_code == 409 and again.json()["status"] == "accepted"


def test_member_invite_redirects_to_the_profile(org):
    _, token = make_invitation(org, "m@du.ac.bd")
    assert accept(signed_in(make_user("m@du.ac.bd")), token).json()["redirect"] == "/profile"


def test_accept_refuses_a_different_or_unverified_email(org):
    _, token = make_invitation(org, "rahim@du.ac.bd")
    r = accept(signed_in(make_user("karim@du.ac.bd")), token)
    assert r.status_code == 403 and r.json()["error"] == "email_mismatch"
    r = accept(signed_in(make_user("rahim@du.ac.bd", verified=False)), token)
    assert r.status_code == 403 and r.json()["error"] == "email_unverified"
    assert not Membership.objects.filter(organization=org).exists()


def test_expired_and_revoked_invitations_cannot_be_accepted(org):
    user = make_user("rahim@du.ac.bd")
    _, expired = make_invitation(org, "rahim@du.ac.bd", expired=True)
    r = accept(signed_in(user), expired)
    assert r.status_code == 409 and r.json() == {
        "error": "invitation_not_pending", "message": "This invitation can no longer be accepted.", "status": "expired",
    }
    other_org = make_org("buet")
    _, revoked = make_invitation(other_org, "rahim@du.ac.bd", status=Invitation.Status.REVOKED)
    r = accept(signed_in(user), revoked)
    assert r.status_code == 409 and r.json()["status"] == "revoked"
    assert Client().get(f"/api/v1/invitations/{revoked}/").json()["status"] == "revoked"


def test_pending_sign_up_request_is_upgraded(org):
    user = make_user("rahim@du.ac.bd")
    request = add_member(org, user, status=Membership.Status.PENDING)
    _, token = make_invitation(org, "rahim@du.ac.bd", role=Membership.Role.ADMIN)
    assert accept(signed_in(user), token).status_code == 200
    request.refresh_from_db()
    assert request.status == Membership.Status.ACTIVE and request.role == Membership.Role.ADMIN
    assert Membership.objects.filter(user=user).count() == 1


def test_deprovisioned_member_is_reactivated_even_when_the_cap_is_full(org):
    org.seat_cap = 1
    org.save()
    user = make_user("rahim@du.ac.bd")
    removed = add_member(org, user, status=Membership.Status.DEPROVISIONED)
    _, token = make_invitation(org, "rahim@du.ac.bd")  # holds the only seat
    assert accept(signed_in(user), token).status_code == 200
    removed.refresh_from_db()
    assert removed.status == Membership.Status.ACTIVE
    assert services.seat_summary(org) == {"used": 1, "cap": 1}


def test_invitation_to_a_removed_institution_cannot_be_accepted(org):
    _, token = make_invitation(org, "rahim@du.ac.bd")
    org.status = "deactivated"
    org.save()
    r = accept(signed_in(make_user("rahim@du.ac.bd")), token)
    assert r.status_code == 409 and r.json()["error"] == "institution_inactive"


def test_individual_invitation_ensures_a_personal_account():
    _, token = make_invitation(None, "solo@gmail.com")
    user = make_user("solo@gmail.com")
    assert not Account.objects.filter(owner_user=user).exists()
    r = accept(signed_in(user), token)
    assert r.json() == {"institution": None, "role": None, "redirect": "/profile", "renewal_stopped": False}
    assert Account.objects.filter(owner_user=user, account_type=Account.Type.PERSONAL).count() == 1
    assert not Membership.objects.filter(user=user).exists()


def test_csrf_endpoint_sets_the_cookie():
    r = Client().get("/api/v1/csrf/")
    assert r.status_code == 200 and r.json() == {"ok": True}
    assert "csrftoken" in r.cookies


def test_an_active_member_accepting_gets_a_higher_invited_role_and_the_matching_redirect(org):
    """Invited as admin while a sign-up request was approved meanwhile: the admin role is applied, not dropped."""
    user = make_user("y@du.ac.bd")
    add_member(org, user)
    _, token = make_invitation(org, "y@du.ac.bd", role=Membership.Role.ADMIN)
    r = accept(signed_in(user), token)
    assert r.json() == {
        "institution": {"slug": "du", "name": "University of Dhaka"}, "role": "admin",
        "redirect": "/admin/portal/du/members", "renewal_stopped": False,
    }
    assert Membership.objects.get(user=user, organization=org).role == Membership.Role.ADMIN
    assert signed_in(user).get("/api/v1/portal/institutions/du/").status_code == 200


def test_an_invitation_never_demotes_an_active_member(org):
    user = make_user("z@du.ac.bd")
    add_member(org, user, role=Membership.Role.ADMIN)
    _, token = make_invitation(org, "z@du.ac.bd", role=Membership.Role.MEMBER)
    r = accept(signed_in(user), token)
    assert r.json()["role"] == "admin" and r.json()["redirect"] == "/admin/portal/du/members"
    assert Membership.objects.get(user=user, organization=org).role == Membership.Role.ADMIN
