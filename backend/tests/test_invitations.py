import io
import threading
from datetime import timedelta

import pytest
from django.core import mail
from django.core.mail.backends.base import BaseEmailBackend
from django.core.management import call_command
from django.db import connection, transaction
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from apps.audit.models import AuditLog
from apps.invitations import services
from apps.invitations.emails import send_queued
from apps.invitations.errors import ServiceError
from apps.invitations.models import Invitation, hash_token
from apps.invitations.shapes import serialize_invitation
from apps.organizations.models import Membership, Organization
from tests.factories import add_member, make_invitation, make_org, make_user, sent_tokens

pytestmark = pytest.mark.django_db

SOURCE = Invitation.Source.SUPERADMIN


class FailingBackend(BaseEmailBackend):
    """A mail server that is down."""

    def open(self):
        raise ConnectionRefusedError("smtp down")

    def send_messages(self, messages):
        raise ConnectionRefusedError("smtp down")


@pytest.fixture
def org():
    return make_org("du", name="University of Dhaka")


@pytest.fixture
def admin_user():
    return make_user("boss@bdren.ai", name="Platform Boss")


def invite(org, email="new@du.ac.bd", **kw):
    kw.setdefault("source", SOURCE)
    return services.create_invitation(organization=org, email=email, **kw)


def error_of(excinfo):
    return excinfo.value.code, excinfo.value.status


# ---------------------------------------------------------------- seats

def test_seats_count_active_members_and_live_invitations_only(org):
    add_member(org)
    add_member(org, role=Membership.Role.ADMIN)
    add_member(org, status=Membership.Status.PENDING)
    add_member(org, status=Membership.Status.SUSPENDED)
    add_member(org, status=Membership.Status.DEPROVISIONED)
    make_invitation(org, "live@du.ac.bd")
    make_invitation(org, "old@du.ac.bd", expired=True)
    make_invitation(org, "gone@du.ac.bd", status=Invitation.Status.REVOKED)
    make_invitation(org, "done@du.ac.bd", status=Invitation.Status.ACCEPTED)
    make_invitation(None, "solo@gmail.com")
    other = make_org("other")
    add_member(other)

    assert services.seats_used(org) == 3
    assert services.seat_summary(org) == {"used": 3, "cap": None}
    annotated = {o.slug: o for o in services.with_seats(Organization.objects.all())}
    assert annotated["du"].used_seats == 3
    assert annotated["other"].used_seats == 1
    org.seat_cap = 10
    assert services.seat_summary(annotated["du"]) == {"used": 3, "cap": None}
    assert services.seat_summary(org) == {"used": 3, "cap": 10}


def test_invite_is_blocked_at_the_seat_cap(org):
    org.seat_cap = 2
    org.save()
    add_member(org)
    invite(org, "first@du.ac.bd")
    with pytest.raises(ServiceError) as e:
        invite(org, "second@du.ac.bd")
    assert error_of(e) == ("seat_cap_reached", 409)
    assert e.value.body()["seats_used"] == 2 and e.value.body()["seat_cap"] == 2
    assert not Invitation.objects.filter(email="second@du.ac.bd").exists()


def test_unlimited_cap_never_blocks(org):
    for i in range(5):
        invite(org, f"p{i}@du.ac.bd")
    assert services.seats_used(org) == 5


@pytest.mark.django_db(transaction=True)
def test_concurrent_invites_cannot_exceed_the_cap():
    org = make_org("race", seat_cap=1)
    barrier = threading.Barrier(2)
    outcomes = []

    def attempt(email):
        try:
            barrier.wait()
            services.create_invitation(organization=org, email=email, source=SOURCE)
            outcomes.append("ok")
        except ServiceError as e:
            outcomes.append(e.code)
        finally:
            connection.close()

    threads = [threading.Thread(target=attempt, args=(f"r{i}@race.edu",)) for i in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(outcomes) == ["ok", "seat_cap_reached"]
    assert services.seats_used(org) == 1


# ---------------------------------------------------------------- create

def test_create_invitation_stores_only_the_token_hash_and_emails_after_commit(
    org, admin_user, django_capture_on_commit_callbacks, settings
):
    settings.PLATFORM_PUBLIC_URL = "https://bdren.ai"
    with django_capture_on_commit_callbacks(execute=True):
        result = invite(org, " New.Person@DU.ac.bd ", name="New Person", role=Membership.Role.ADMIN, actor=admin_user,
                        ip_address="10.0.0.9")
        assert mail.outbox == []  # nothing leaves before the transaction commits
    inv = result.invitation
    inv.refresh_from_db()
    (token,) = sent_tokens()
    assert inv.email == "new.person@du.ac.bd"
    assert inv.token_hash == hash_token(token) and token not in inv.token_hash
    assert inv.status == Invitation.Status.PENDING and inv.sent_count == 1 and inv.invited_by == admin_user
    assert abs((inv.expires_at - timezone.now()) - timedelta(days=7)) < timedelta(minutes=1)
    assert result.email_sent is True and result.warning is None

    msg = mail.outbox[0]
    assert msg.to == ["new.person@du.ac.bd"]
    assert msg.subject == "You're invited to University of Dhaka on BDREN AI"
    assert f"https://bdren.ai/invite/{token}" in msg.body
    assert "Platform Boss has invited you to join University of Dhaka on BDREN AI as an administrator." in msg.body
    local_expiry = inv.expires_at.astimezone(timezone.get_fixed_timezone(360))
    assert f"{local_expiry.day} {local_expiry:%B %Y, %H:%M} (Asia/Dhaka)" in msg.body
    html, mime = msg.alternatives[0]
    assert mime == "text/html" and f'href="https://bdren.ai/invite/{token}"' in html

    entry = AuditLog.objects.get(action="invitation.created")
    assert entry.metadata["organization_id"] == str(org.id)
    assert entry.metadata["source"] == SOURCE and entry.actor == admin_user and entry.ip_address == "10.0.0.9"


def test_individual_invitation_email(django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        result = services.create_invitation(organization=None, email="solo@gmail.com", role="owner", source=SOURCE)
    assert result.invitation.organization is None and result.invitation.role == Membership.Role.MEMBER
    assert mail.outbox[0].subject == "You're invited to BDREN AI"
    assert "BDREN AI has invited you to create your BDREN AI account." in mail.outbox[0].body
    with pytest.raises(ServiceError) as e:
        services.create_invitation(organization=None, email="SOLO@gmail.com", source=SOURCE)
    assert error_of(e) == ("already_invited", 409)


def test_email_failure_is_reported_and_the_invitation_stays_pending(org, settings, django_capture_on_commit_callbacks):
    settings.EMAIL_BACKEND = "tests.test_invitations.FailingBackend"
    with django_capture_on_commit_callbacks(execute=True):
        result = invite(org)
    assert result.email_sent is False
    result.invitation.refresh_from_db()
    assert result.invitation.status == Invitation.Status.PENDING


def test_rolled_back_invitation_sends_nothing(org, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True) as callbacks:
        with pytest.raises(RuntimeError), transaction.atomic():
            invite(org)
            raise RuntimeError("caller fails after inviting")
    assert callbacks == [] and mail.outbox == []
    assert not Invitation.objects.exists()


def test_duplicate_pending_invitation_is_refused_but_an_expired_one_is_replaced(org):
    invite(org, "dup@du.ac.bd")
    with pytest.raises(ServiceError) as e:
        invite(org, "DUP@du.ac.bd")
    assert error_of(e) == ("already_invited", 409)

    stale, _ = make_invitation(org, "late@du.ac.bd", expired=True)
    fresh = invite(org, "late@du.ac.bd").invitation
    stale.refresh_from_db()
    assert stale.status == Invitation.Status.REVOKED and fresh.status == Invitation.Status.PENDING
    retired = AuditLog.objects.get(action="invitation.revoked", target_id=str(stale.id))
    assert retired.metadata == {"organization_id": str(org.id), "source": SOURCE, "reason": "superseded"}


def test_invitation_rules(org):
    add_member(org, make_user("member@du.ac.bd"))
    with pytest.raises(ServiceError) as e:
        invite(org, "Member@du.ac.bd")
    assert error_of(e) == ("already_member", 409)

    with pytest.raises(ServiceError) as e:
        invite(org, "x@du.ac.bd", role="owner", allowed_roles=services.PORTAL_ROLES)
    assert error_of(e) == ("bad_role", 400)

    with pytest.raises(ServiceError) as e:
        invite(org, "x@du.ac.bd", role="superuser")
    assert error_of(e) == ("bad_role", 400)

    org.sign_in_domains = ["du.ac.bd"]
    org.save()
    with pytest.raises(ServiceError) as e:
        invite(org, "x@gmail.com")
    assert error_of(e) == ("domain_not_allowed", 400) and "email" in e.value.fields

    org.status = Organization.Status.SUSPENDED
    org.save()
    assert invite(org, "ok@du.ac.bd").warning == "institution_suspended"

    org.status = Organization.Status.DEACTIVATED
    org.save()
    with pytest.raises(ServiceError) as e:
        invite(org, "late@du.ac.bd")
    assert error_of(e) == ("institution_inactive", 409)


# ---------------------------------------------------------------- resend / revoke

def test_resend_issues_a_new_token_and_the_old_link_stops_working(org, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        first = invite(org).invitation
    first.expires_at = timezone.now() + timedelta(days=1)
    first.last_sent_at = timezone.now() - timedelta(minutes=6)
    first.save()
    with django_capture_on_commit_callbacks(execute=True):
        result = services.resend_invitation(first, source=SOURCE)
    old_token, new_token = sent_tokens()
    assert old_token != new_token
    assert services.find_by_token(old_token) is None
    assert services.find_by_token(new_token).pk == first.pk
    inv = result.invitation
    assert inv.sent_count == 2 and inv.expires_at > timezone.now() + timedelta(days=6)
    assert result.email_sent is True
    assert AuditLog.objects.filter(action="invitation.resent", metadata__organization_id=str(org.id)).count() == 1


def test_resending_an_expired_invitation_takes_a_seat_again(org):
    org.seat_cap = 1
    org.save()
    expired, _ = make_invitation(org, "old@du.ac.bd", expired=True)
    add_member(org)
    with pytest.raises(ServiceError) as e:
        services.resend_invitation(expired, source=SOURCE)
    assert error_of(e) == ("seat_cap_reached", 409)

    Membership.objects.update(status=Membership.Status.SUSPENDED)
    assert services.resend_invitation(expired, source=SOURCE).invitation.effective_status == "pending"


def test_revoke_frees_the_seat_and_only_open_invitations_can_change(org):
    inv = invite(org).invitation
    revoked = services.revoke_invitation(inv, source=SOURCE, reason="wrong person")
    assert revoked.status == Invitation.Status.REVOKED and services.seats_used(org) == 0
    entry = AuditLog.objects.get(action="invitation.revoked")
    assert entry.metadata == {"organization_id": str(org.id), "source": SOURCE, "reason": "wrong person"}
    for action in (services.revoke_invitation, services.resend_invitation):
        with pytest.raises(ServiceError) as e:
            action(inv, source=SOURCE)
        assert error_of(e) == ("invitation_not_pending", 409)
        assert e.value.body()["status"] == "revoked"

    expired, _ = make_invitation(org, "late@du.ac.bd", expired=True)
    assert services.revoke_invitation(expired, source=SOURCE).status == Invitation.Status.REVOKED


def test_resend_expired_respects_each_cap(org, django_capture_on_commit_callbacks):
    org.seat_cap = 2
    org.save()
    make_invitation(org, "live@du.ac.bd")
    make_invitation(org, "e1@du.ac.bd", expired=True)
    make_invitation(org, "e2@du.ac.bd", expired=True)
    make_invitation(None, "solo@gmail.com", expired=True)
    gone = make_org("gone", status=Organization.Status.DEACTIVATED)
    make_invitation(gone, "x@gone.edu", expired=True)

    with django_capture_on_commit_callbacks(execute=True):
        result = services.resend_expired(source=SOURCE)
    assert result.body() == {"resent": 2, "email_failures": 0, "email_queued": 0}
    assert services.seats_used(org) == 2
    assert Invitation.objects.get(email="solo@gmail.com").effective_status == "pending"
    assert Invitation.objects.get(email="x@gone.edu").effective_status == "expired"
    assert sorted(m.to[0] for m in mail.outbox) == ["e1@du.ac.bd", "solo@gmail.com"]

    scoped = services.resend_expired(organization=org, source=SOURCE)
    assert scoped.count == 0


def test_serialized_invitation_matches_the_contract(org, admin_user):
    inv = invite(org, actor=admin_user).invitation
    data = serialize_invitation(inv)
    assert set(data) == {
        "id", "email", "name", "institution", "role", "status", "source", "invited_by", "expires_at",
        "created_at", "last_sent_at", "sent_count", "email_status", "accepted_by", "accepted_at",
    }
    assert data["email_status"] == "sending"  # read before the transaction committed and the email went out
    assert data["institution"] == {"slug": "du", "name": "University of Dhaka"}
    assert data["invited_by"]["email"] == "boss@bdren.ai" and data["expires_at"].endswith("Z")
    assert "email" not in serialize_invitation(inv, inviter_email=False)["invited_by"]


# ---------------------------------------------------------------- import

def test_import_dry_run_reports_every_reason_without_writing(org):
    org.sign_in_domains = ["du.ac.bd"]
    org.seat_cap = 4
    org.save()
    add_member(org, make_user("member@du.ac.bd"))
    make_invitation(org, "invited@du.ac.bd")
    make_invitation(org, "stale@du.ac.bd", expired=True)
    rows = [
        {"email": "a@du.ac.bd", "name": "A"},
        {"email": "not an email"},
        {"email": "b@du.ac.bd", "role": "owner"},
        {"email": "A@du.ac.bd"},
        {"email": "c@gmail.com"},
        {"email": "member@du.ac.bd"},
        {"email": "invited@du.ac.bd"},
        {"email": "stale@du.ac.bd", "role": "admin"},
        {"email": "d@du.ac.bd"},
    ]
    before = Invitation.objects.count()
    result = services.import_rows(org, rows, dry_run=True, source="portal", allowed_roles=services.PORTAL_ROLES)
    body = result.body()
    reasons = [(r["index"], r["status"], r["reason"]) for r in body["rows"]]
    assert reasons == [
        (0, "ok", None),
        (1, "error", "invalid_email"),
        (2, "error", "bad_role"),
        (3, "skip", "duplicate_in_file"),
        (4, "error", "domain_not_allowed"),
        (5, "skip", "already_member"),
        (6, "skip", "already_invited"),
        (7, "ok", None),
        (8, "ok", None),
    ]
    assert body["summary"] == {"ok": 3, "error": 3, "skip": 3, "fits": 2, "seats": {"used": 2, "cap": 4}}
    assert body["created"] == 0 and body["email_failures"] == 0
    assert Invitation.objects.count() == before


def test_import_creates_rows_in_file_order_and_stops_at_the_cap(org, admin_user, django_capture_on_commit_callbacks):
    org.seat_cap = 3
    org.save()
    add_member(org)
    rows = [{"email": f"p{i}@du.ac.bd", "name": f"P{i}", "role": "member"} for i in range(4)]
    with django_capture_on_commit_callbacks(execute=True):
        result = services.import_rows(org, rows, dry_run=False, source="superadmin", actor=admin_user)
    body = result.body()
    assert [r["status"] for r in body["rows"]] == ["ok", "ok", "error", "error"]
    assert [r["reason"] for r in body["rows"][2:]] == ["over_cap", "over_cap"]
    assert body["created"] == 2 and body["email_failures"] == 0
    assert body["summary"]["seats"] == {"used": 3, "cap": 3}
    created = Invitation.objects.filter(organization=org).order_by("email")
    assert [i.email for i in created] == ["p0@du.ac.bd", "p1@du.ac.bd"]
    assert {i.source for i in created} == {Invitation.Source.IMPORT}
    assert sorted(m.to[0] for m in mail.outbox) == ["p0@du.ac.bd", "p1@du.ac.bd"]
    assert AuditLog.objects.filter(action="invitation.created", metadata__organization_id=str(org.id)).count() == 2
    summary = AuditLog.objects.get(action="organization.members_imported")
    assert summary.metadata["created"] == 2 and summary.actor == admin_user


def test_import_limits(org):
    with pytest.raises(ServiceError) as e:
        services.import_rows(org, [{"email": "a@du.ac.bd"}] * 1001, dry_run=True, source=SOURCE)
    assert error_of(e) == ("too_many_rows", 400)
    with pytest.raises(ServiceError) as e:
        services.import_rows(org, "a@du.ac.bd", dry_run=True, source=SOURCE)
    assert error_of(e) == ("invalid", 400)
    org.status = Organization.Status.DEACTIVATED
    org.save()
    with pytest.raises(ServiceError) as e:
        services.import_rows(org, [], dry_run=False, source=SOURCE)
    assert error_of(e) == ("institution_inactive", 409)


# ---------------------------------------------------------------- review fixes

def test_resend_is_refused_once_the_person_joined_or_the_domain_is_no_longer_allowed(org):
    joined, _ = make_invitation(org, "joined@du.ac.bd", expired=True)
    add_member(org, make_user("Joined@du.ac.bd"))
    with pytest.raises(ServiceError) as e:
        services.resend_invitation(joined, source=SOURCE)
    assert error_of(e) == ("already_member", 409)

    outsider, _ = make_invitation(org, "x@gmail.com")
    org.sign_in_domains = ["du.ac.bd"]
    org.save()
    with pytest.raises(ServiceError) as e:
        services.resend_invitation(outsider, source=SOURCE)
    assert error_of(e) == ("domain_not_allowed", 400)
    assert mail.outbox == []


def test_reinviting_and_joining_retire_the_old_expired_invitation(org, django_capture_on_commit_callbacks):
    """Invitation A expires, B replaces it and is accepted: A must not count as expired or be re-sent."""
    old, _ = make_invitation(org, "x@du.ac.bd", expired=True)
    with django_capture_on_commit_callbacks(execute=True):
        new = invite(org, "x@du.ac.bd").invitation
    services.accept_invitation(sent_tokens()[0], user=make_user("x@du.ac.bd"))
    old.refresh_from_db()
    assert old.status == Invitation.Status.REVOKED

    requested, _ = make_invitation(org, "y@du.ac.bd", expired=True)
    request = add_member(org, make_user("y@du.ac.bd"), status=Membership.Status.PENDING)
    services.activate_membership(request, source=SOURCE)
    requested.refresh_from_db()
    assert requested.status == Invitation.Status.REVOKED
    reasons = AuditLog.objects.filter(action="invitation.revoked").values_list("target_id", "metadata__reason")
    assert sorted(reasons) == sorted([(str(old.id), "superseded"), (str(requested.id), "joined")])

    counts = services.with_counts(Organization.objects.filter(pk=org.pk)).get()
    assert counts.expired_invitations == 0 and new.pk != old.pk
    mail.outbox.clear()
    assert services.resend_expired(source=SOURCE).count == 0 and mail.outbox == []


def test_resend_expired_skips_people_who_are_already_members(org, django_capture_on_commit_callbacks):
    """Rows written before the retire rule existed (or joined by a path that bypassed it) are still skipped."""
    make_invitation(org, "member@du.ac.bd", expired=True)
    add_member(org, make_user("Member@du.ac.bd"))
    make_invitation(org, "outsider@gmail.com", expired=True)
    org.sign_in_domains = ["du.ac.bd"]
    org.save()
    make_invitation(org, "late@du.ac.bd", expired=True)
    with django_capture_on_commit_callbacks(execute=True):
        result = services.resend_expired(source=SOURCE)
    assert result.count == 1 and [m.to[0] for m in mail.outbox] == ["late@du.ac.bd"]
    assert Invitation.objects.get(email="member@du.ac.bd").effective_status == "expired"


def test_resend_waits_for_the_cooldown(org, settings):
    settings.INVITATION_RESEND_COOLDOWN_MINUTES = 5
    inv = invite(org).invitation
    with pytest.raises(ServiceError) as e:
        services.resend_invitation(inv, source=SOURCE)
    assert error_of(e) == ("resend_too_soon", 429) and 0 < e.value.body()["retry_after"] <= 300
    Invitation.objects.filter(pk=inv.pk).update(last_sent_at=timezone.now() - timedelta(minutes=5, seconds=1))
    assert services.resend_invitation(inv, source=SOURCE).invitation.sent_count == 2


def test_an_invited_person_who_also_asked_to_join_takes_one_seat(org):
    org.seat_cap = 1
    org.save()
    make_invitation(org, "x@du.ac.bd")
    request = add_member(org, make_user("X@du.ac.bd"), status=Membership.Status.PENDING)
    assert services.seats_used(org) == 1

    approved = services.activate_membership(request, source=SOURCE)
    assert approved.status == Membership.Status.ACTIVE
    assert services.seats_used(org) == 1
    assert Invitation.objects.get(email="x@du.ac.bd").status == Invitation.Status.PENDING  # may still raise the role


def test_import_duplicate_check_only_counts_rows_that_were_invited(org):
    rows = [{"email": "z@du.ac.bd", "role": "owner"}, {"email": "z@du.ac.bd", "role": "member"},
            {"email": "z@du.ac.bd", "role": "member"}]
    result = services.import_rows(org, rows, dry_run=True, source=SOURCE, allowed_roles=services.PORTAL_ROLES)
    assert [(r["status"], r["reason"]) for r in result.body()["rows"]] == [
        ("error", "bad_role"), ("ok", None), ("skip", "duplicate_in_file"),
    ]


def test_email_body_carries_no_inviter_supplied_free_text(org, django_capture_on_commit_callbacks):
    spoofer = make_user("spoof@du.ac.bd", name="Support. Verify at bdren-login.example now")
    with django_capture_on_commit_callbacks(execute=True):
        invite(org, "victim@du.ac.bd", name="Bob. Your account is locked, verify at https://bdren-login.example",
               actor=spoofer)
    body, html = mail.outbox[0].body, mail.outbox[0].alternatives[0][0]
    assert "bdren-login" not in body and "bdren-login" not in html and "locked" not in body
    assert body.startswith("Hello,\n")
    assert "BDREN AI has invited you to join University of Dhaka" in body

    named = make_user("j@du.ac.bd", name="J. O'Neil-Rahman")
    with django_capture_on_commit_callbacks(execute=True):
        invite(org, "second@du.ac.bd", actor=named)
    assert "J. O'Neil-Rahman has invited you" in mail.outbox[1].body


def test_bulk_emails_beyond_the_inline_limit_go_to_the_mail_worker(org, settings, django_capture_on_commit_callbacks):
    settings.INVITATION_INLINE_EMAILS = 2
    rows = [{"email": f"p{i}@du.ac.bd"} for i in range(5)]
    with django_capture_on_commit_callbacks(execute=True):
        result = services.import_rows(org, rows, dry_run=False, source=SOURCE)
    assert result.body()["email_queued"] == 3 and result.body()["email_failures"] == 0
    assert [m.to[0] for m in mail.outbox] == ["p0@du.ac.bd", "p1@du.ac.bd"]
    statuses = dict(Invitation.objects.values_list("email", "email_status"))
    assert sorted(statuses.values()) == ["queued", "queued", "queued", "sent", "sent"]

    call_command("send_invitation_emails", stdout=io.StringIO())
    assert sorted(m.to[0] for m in mail.outbox[2:]) == ["p2@du.ac.bd", "p3@du.ac.bd", "p4@du.ac.bd"]
    assert set(Invitation.objects.values_list("email_status", flat=True)) == {"sent"}
    for token, message in zip(sent_tokens(), mail.outbox):
        assert services.find_by_token(token).email == message.to[0]  # the worker's fresh tokens are the live ones
    call_command("send_invitation_emails", stdout=io.StringIO())
    assert len(mail.outbox) == 5


def test_mail_worker_takes_over_a_send_left_unfinished_and_records_failures(org, settings):
    stuck, old_token = make_invitation(org, "stuck@du.ac.bd")
    Invitation.objects.filter(pk=stuck.pk).update(
        email_status=Invitation.EmailStatus.SENDING, last_sent_at=timezone.now() - timedelta(minutes=11)
    )
    fresh, _ = make_invitation(org, "fresh@du.ac.bd")
    Invitation.objects.filter(pk=fresh.pk).update(email_status=Invitation.EmailStatus.SENDING, last_sent_at=timezone.now())
    settings.EMAIL_BACKEND = "tests.test_invitations.FailingBackend"
    assert send_queued() == (0, 1)
    stuck.refresh_from_db()
    assert stuck.email_status == "failed" and stuck.token_hash != hash_token(old_token)
    assert Invitation.objects.get(pk=fresh.pk).email_status == "sending"


def test_resend_expired_does_not_load_each_inviter_separately(org, django_capture_on_commit_callbacks):
    for i in range(3):
        make_invitation(org, f"e{i}@du.ac.bd", expired=True, invited_by=make_user(f"admin{i}@du.ac.bd"))
    with CaptureQueriesContext(connection) as queries, django_capture_on_commit_callbacks(execute=True):
        assert services.resend_expired(organization=org, source=SOURCE).count == 3
    user_reads = [q["sql"] for q in queries.captured_queries if q["sql"].startswith('SELECT') and
                  'FROM "identities_user"' in q["sql"]]
    assert user_reads == [] and len(mail.outbox) == 3
