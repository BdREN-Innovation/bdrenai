import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor

from apps.audit.models import AuditLog
from apps.audit.services import record_audit
from apps.organizations.models import Membership
from tests.factories import add_member, make_org, make_user
from tests.test_superadmin_api import get, make_superadmin, post, signed_in

pytestmark = pytest.mark.django_db

PORTAL = "/api/v1/portal/institutions/"


def roles(client, **params):
    return [(e["action"], e["actor_role"]) for e in get(client, "audit/", **params).json()["results"]]


def test_entries_record_the_role_the_actor_acted_in():
    boss = make_superadmin()
    org = make_org("du", name="University of Dhaka", seat_cap=10)
    admin = add_member(org, make_user("admin@du.ac.bd"), role=Membership.Role.ADMIN).user
    member = make_user("someone@du.ac.bd")

    post(signed_in(boss), "invitations/", {"institution": "du", "email": "a@du.ac.bd", "role": "member"})
    portal = signed_in(admin)
    r = portal.post(PORTAL + "du/invitations/", {"email": "b@du.ac.bd", "name": "", "role": "member"},
                    content_type="application/json")
    assert r.status_code == 201, r.json()
    record_audit(actor=member, action="profile.updated", target_type="User", target_id=member.id)
    record_audit(action="invitation.expired", target_type="Invitation", target_id="x")

    by_email = {e.metadata.get("email") or e.action: e.actor_role for e in AuditLog.objects.all()}
    assert by_email["a@du.ac.bd"] == AuditLog.ActorRole.SUPERADMIN
    assert by_email["b@du.ac.bd"] == AuditLog.ActorRole.INSTITUTION_ADMIN
    assert by_email["profile.updated"] == AuditLog.ActorRole.USER
    assert by_email["invitation.expired"] == AuditLog.ActorRole.SYSTEM


def test_audit_list_shows_and_filters_by_role():
    boss = make_superadmin()
    client = signed_in(boss)
    make_org("du", name="University of Dhaka")
    record_audit(action="invitation.expired", target_type="Invitation", target_id="x")
    post(client, "invitations/", {"institution": "du", "email": "a@du.ac.bd", "role": "member"})

    assert roles(client, role="system") == [("invitation.expired", "system")]
    assert roles(client, role="superadmin") == [("invitation.created", "superadmin")]
    assert roles(client, role="institution_admin") == []
    r = get(client, "audit/", role="owner")
    assert r.status_code == 400 and "role" in r.json()["fields"]


def test_filter_options_list_actions_and_target_types_in_use():
    client = signed_in(make_superadmin())
    record_audit(action="organization.created", target_type="Organization", target_id="1")
    record_audit(action="invitation.created", target_type="Invitation", target_id="2")
    record_audit(action="invitation.created", target_type="Invitation", target_id="3")

    body = get(client, "audit/filters/").json()
    assert body["actions"] == ["invitation.created", "organization.created"]
    assert body["target_types"] == ["Invitation", "Organization"]
    assert [r["value"] for r in body["roles"]] == ["superadmin", "institution_admin", "user", "system"]
    assert body["roles"][1]["label"] == "Institution admin"


def test_filter_options_are_superadmin_only():
    member = make_user("someone@du.ac.bd")
    assert signed_in(member).get("/api/v1/superadmin/audit/filters/").status_code == 403


@pytest.mark.django_db(transaction=True)
def test_migration_backfills_roles_of_existing_entries():
    executor = MigrationExecutor(connection)
    before = [("audit", "0003_target_index"), ("administration", "0001_initial"), ("identities", "0003_user_session")]
    executor.migrate(before)
    old = executor.loader.project_state(before).apps
    Log = old.get_model("audit", "AuditLog")
    User = old.get_model("identities", "User")
    Role = old.get_model("administration", "PlatformRoleAssignment")
    boss = User.objects.create(issuer="https://idp", zitadel_subject="1", email="boss@bdren.ai")
    Role.objects.create(user_id=boss.id, role="platform_super_admin")
    admin = User.objects.create(issuer="https://idp", zitadel_subject="2", email="admin@du.ac.bd")
    rows = {
        "system": Log.objects.create(action="a", target_type="T", target_id="1"),
        "superadmin": Log.objects.create(actor_id=boss.id, action="b", target_type="T", target_id="2"),
        "institution_admin": Log.objects.create(actor_id=admin.id, action="c", target_type="T", target_id="3",
                                                metadata={"source": "portal"}),
        "user": Log.objects.create(actor_id=admin.id, action="d", target_type="T", target_id="4"),
    }

    executor = MigrationExecutor(connection)
    executor.loader.build_graph()
    executor.migrate(executor.loader.graph.leaf_nodes())

    for role, row in rows.items():
        assert AuditLog.objects.get(pk=row.pk).actor_role == role
