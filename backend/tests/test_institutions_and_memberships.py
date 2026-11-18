from io import StringIO

import pytest
from django.core.exceptions import ValidationError
from django.core.management import CommandError, call_command
from django.test import Client

from apps.accounts.models import Account
from apps.administration.models import PlatformRoleAssignment
from apps.audit.models import AuditLog
from apps.invitations import services
from apps.invitations.errors import ServiceError
from apps.organizations.models import Membership, Organization
from apps.organizations.validators import normalize_domains, validate_timezone
from tests.factories import add_member, make_invitation, make_org, make_user

pytestmark = pytest.mark.django_db

SOURCE = "superadmin"
ADMIN = Membership.Role.ADMIN


@pytest.fixture
def org():
    return make_org("du", name="University of Dhaka")


def code_of(excinfo):
    return excinfo.value.code, excinfo.value.status


# ---------------------------------------------------------------- validators

def test_domain_and_timezone_validation():
    assert normalize_domains([" Example.EDU", "du.ac.bd", "example.edu"]) == ["example.edu", "du.ac.bd"]
    for bad in (["user@example.edu"], ["https://example.edu"], ["example"], ["exa mple.edu"], ["-x.edu"], "x.edu"):
        with pytest.raises(ValidationError):
            normalize_domains(bad)
    validate_timezone("Asia/Dhaka")
    with pytest.raises(ValidationError):
        validate_timezone("Mars/Olympus")


# ---------------------------------------------------------------- institutions

def test_create_institution_with_admin_invitation(django_capture_on_commit_callbacks):
    boss = make_user("boss@bdren.ai")
    data = {
        "name": "Example University", "slug": "example-university", "type": "university", "timezone": "Asia/Dhaka",
        "contact_email": "Info@Example.edu", "sign_in_domains": ["Example.edu"], "seat_cap": 200,
    }
    with django_capture_on_commit_callbacks(execute=True):
        created = services.create_institution(
            data=data, admin={"email": "admin@example.edu", "name": "Admin Name"}, actor=boss, ip_address="10.1.1.1"
        )
    org = created.organization
    org.refresh_from_db()
    assert (org.type, org.timezone, org.contact_email, org.sign_in_domains, org.seat_cap) == (
        "university", "Asia/Dhaka", "info@example.edu", ["example.edu"], 200,
    )
    assert Account.objects.filter(organization=org, account_type=Account.Type.ORGANIZATION).exists()
    inv = created.invited.invitation
    assert inv.role == ADMIN and inv.organization == org and created.invited.email_sent is True
    assert services.seat_summary(org) == {"used": 1, "cap": 200}
    entry = AuditLog.objects.get(action="organization.created")
    assert entry.metadata["organization_id"] == str(org.id) and entry.actor == boss


def test_create_institution_without_admin_uses_defaults():
    created = services.create_institution(data={"name": "Plain Org", "slug": "plain"})
    org = created.organization
    assert created.invited is None
    assert (org.type, org.timezone, org.sign_in_domains, org.seat_cap) == ("other", "Asia/Dhaka", [], None)


def test_create_institution_validation_and_conflicts(org):
    with pytest.raises(ServiceError) as e:
        services.create_institution(data={"name": "X", "slug": "Bad Slug", "timezone": "Nowhere/City",
                                          "sign_in_domains": ["a@b.edu"], "seat_cap": 0, "type": "club"})
    assert code_of(e) == ("invalid", 400)
    assert set(e.value.fields) == {"name", "slug", "timezone", "sign_in_domains", "seat_cap", "type"}

    with pytest.raises(ServiceError) as e:
        services.create_institution(data={"name": "Again", "slug": "du"})
    assert code_of(e) == ("slug_taken", 409)


def test_failed_admin_invitation_leaves_no_half_made_institution():
    with pytest.raises(ServiceError) as e:
        services.create_institution(
            data={"name": "Strict University", "slug": "strict", "sign_in_domains": ["strict.edu"]},
            admin={"email": "admin@gmail.com"},
        )
    assert code_of(e) == ("domain_not_allowed", 400) and "admin.email" in e.value.fields
    assert not Organization.objects.filter(slug="strict").exists()
    assert not Account.objects.filter(organization__slug="strict").exists()


def test_partial_clean_only_returns_given_fields():
    assert services.clean_institution({"seat_cap": None, "sign_in_domains": ["A.edu"]}, partial=True) == {
        "seat_cap": None, "sign_in_domains": ["a.edu"],
    }
    with pytest.raises(ServiceError) as e:
        services.clean_institution({"timezone": None}, partial=True)
    assert "timezone" in e.value.fields


# ---------------------------------------------------------------- memberships

def test_activating_a_member_is_seat_checked(org):
    org.seat_cap = 1
    org.save()
    add_member(org)
    request = add_member(org, status=Membership.Status.PENDING)
    with pytest.raises(ServiceError) as e:
        services.activate_membership(request, source=SOURCE)
    assert code_of(e) == ("seat_cap_reached", 409)

    org.seat_cap = 2
    org.save()
    boss = make_user("boss@bdren.ai")
    activated = services.activate_membership(request, source=SOURCE, actor=boss, reason="approved")
    assert activated.status == Membership.Status.ACTIVE
    entry = AuditLog.objects.get(action="membership.updated")
    assert entry.metadata["organization_id"] == str(org.id)
    assert entry.metadata["changes"] == {"status": ["pending", "active"]} and entry.metadata["reason"] == "approved"


def test_reactivating_a_suspended_member_needs_a_free_seat(org):
    org.seat_cap = 1
    org.save()
    suspended = add_member(org, status=Membership.Status.SUSPENDED)
    make_invitation(org, "holder@du.ac.bd")
    with pytest.raises(ServiceError):
        services.update_membership(suspended, status="active", source=SOURCE)


def test_last_admin_is_protected(org):
    only_admin = add_member(org, role=ADMIN)
    for change in (
        lambda: services.suspend_membership(only_admin, source=SOURCE),
        lambda: services.update_membership(only_admin, role=Membership.Role.MEMBER, source=SOURCE),
        lambda: services.remove_membership(only_admin, source=SOURCE),
    ):
        with pytest.raises(ServiceError) as e:
            change()
        assert code_of(e) == ("last_admin", 409)

    owner = add_member(org, role=Membership.Role.OWNER)
    assert services.suspend_membership(only_admin, source=SOURCE).status == Membership.Status.SUSPENDED
    forced = services.remove_membership(owner, source=SOURCE, force=True, reason="institution closing")
    assert forced.status == Membership.Status.DEPROVISIONED
    assert AuditLog.objects.get(action="membership.removed").metadata["forced"] is True


def test_last_admin_rule_does_not_apply_to_a_suspended_institution(org):
    only_admin = add_member(org, role=ADMIN)
    org.status = Organization.Status.SUSPENDED
    org.save()
    assert services.suspend_membership(only_admin, source=SOURCE).status == Membership.Status.SUSPENDED


def test_remove_frees_the_seat_and_roles_are_validated(org):
    member = add_member(org)
    add_member(org, role=ADMIN)
    assert services.seats_used(org) == 2
    services.remove_membership(member, source="portal", reason="left")
    assert services.seats_used(org) == 1
    entry = AuditLog.objects.get(action="membership.removed")
    assert entry.metadata["source"] == "portal" and entry.metadata["previous_status"] == "active"
    with pytest.raises(ServiceError) as e:
        services.update_membership(member, role="owner", source="portal", allowed_roles=services.PORTAL_ROLES)
    assert code_of(e) == ("bad_role", 400)
    with pytest.raises(ServiceError) as e:
        services.update_membership(member, status="deprovisioned", source=SOURCE)
    assert code_of(e) == ("invalid", 400)


# ---------------------------------------------------------------- grant_platform_role

def run(*args):
    out = StringIO()
    call_command("grant_platform_role", *args, stdout=out, stderr=StringIO())
    return out.getvalue()


def test_grant_platform_role_by_email_and_user_id():
    user = make_user("Boss@BDREN.ai")
    assert "Granted platform_super_admin" in run("--email", "boss@bdren.ai")
    assert PlatformRoleAssignment.objects.filter(user=user, role="platform_super_admin").exists()
    assert "already has" in run("--user", str(user.id))
    assert AuditLog.objects.filter(action="platform_role.granted", target_id=str(user.id)).count() == 1

    run("--user", str(user.id), "--role", "billing_administrator")
    assert "Revoked" in run("--email", "boss@bdren.ai", "--revoke")
    assert set(PlatformRoleAssignment.objects.filter(user=user).values_list("role", flat=True)) == {
        "billing_administrator"
    }
    assert AuditLog.objects.get(action="platform_role.revoked").metadata == {
        "role": "platform_super_admin", "source": "cli",
    }


def test_grant_platform_role_refuses_unknown_or_ambiguous_users():
    make_user("twin@du.ac.bd")
    make_user("TWIN@du.ac.bd")
    for args in (["--email", "nobody@du.ac.bd"], ["--email", "twin@du.ac.bd"], ["--user", "not-a-uuid"],
                 ["--user", "00000000-0000-0000-0000-000000000000"]):
        with pytest.raises(CommandError):
            run(*args)
    assert not PlatformRoleAssignment.objects.exists()


def test_grant_platform_role_by_email_ignores_unverified_accounts():
    """Anyone can register an account under someone else's email without verifying it."""
    squatter = make_user("newadmin@bdren.ai", verified=False)
    with pytest.raises(CommandError, match="--user"):
        run("--email", "newadmin@bdren.ai")
    real = make_user("NewAdmin@bdren.ai")
    run("--email", "newadmin@bdren.ai")
    assert list(PlatformRoleAssignment.objects.values_list("user_id", flat=True)) == [real.id]
    assert not PlatformRoleAssignment.objects.filter(user=squatter).exists()


def test_legacy_set_membership_action_is_gone():
    """It changed memberships with no seat lock, cap or last-admin check; the superadmin API replaces it."""
    admin = make_user("orgadmin@bdren.ai")
    PlatformRoleAssignment.objects.create(user=admin, role=PlatformRoleAssignment.Role.ORG_ADMIN)
    org = make_org("capped", seat_cap=1)
    add_member(org)
    person = make_user("extra@du.ac.bd")
    c = Client()
    c.force_login(admin)
    r = c.post("/api/v1/admin/organizations/", {
        "action": "set_membership", "organization_id": str(org.id), "user_id": str(person.id), "status": "active",
    }, content_type="application/json")
    assert r.status_code == 400 and r.json() == {"error": "unknown_action"}
    assert not Membership.objects.filter(user=person).exists()
