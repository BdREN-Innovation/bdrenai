"""Institution membership rules R0-R5 and D1 (docs/SUPERADMIN_API.md "Coverage"): one institution per person confirmed
by email domain, covered vs affiliated members, upgrade on invite/import/"Add to package", uncover on portal removal,
consent invitations for personal-plan users. Real Postgres throughout."""
import importlib
import threading
import uuid

import pytest
from django.apps import apps as django_apps
from django.core import mail
from django.db import IntegrityError, connection, transaction
from django.test import Client

from apps.administration.models import PlatformRoleAssignment
from apps.audit.models import AuditLog
from apps.billing.services import record_manual_payment
from apps.identities import zitadel
from apps.identities.models import User
from apps.identities.services import provision_user
from apps.invitations import services
from apps.invitations.emails import send_queued
from apps.invitations.errors import ServiceError
from apps.invitations.models import Invitation, Notice, new_token
from apps.invitations.shapes import iso
from apps.organizations.models import Membership, Organization
from apps.organizations.services import confirm_signup_institution, request_institution
from apps.subscriptions.models import Subscription, SubscriptionHistory
from apps.subscriptions.services import RenewalStopped, renew_subscription
from apps.superadmin import services as superadmin
from tests.conftest import ISSUER
from tests.factories import (
    add_member,
    affiliate,
    give_personal_plan,
    make_invitation,
    make_org,
    make_user,
)
from tests.test_signup import FakeZitadel, form, post

pytestmark = pytest.mark.django_db

SOURCE = "superadmin"
NONE = Membership.Coverage.NONE
COVERED = Membership.Coverage.INSTITUTION
PORTAL = "/api/v1/portal/institutions/du/"


@pytest.fixture
def org():
    return make_org("du", name="University of Dhaka", sign_in_domains=["du.ac.bd"], seat_cap=10)


@pytest.fixture
def admin(org):
    return add_member(org, make_user("admin@du.ac.bd", name="Admin"), role=Membership.Role.ADMIN)


@pytest.fixture
def portal(admin):
    c = Client()
    c.force_login(admin.user)
    return c


@pytest.fixture
def zitadel_fake(idp, settings, monkeypatch):
    settings.ZITADEL_SERVICE_TOKEN = "service-token"
    fake = FakeZitadel()
    monkeypatch.setattr(zitadel, "_call", fake)
    return fake


def code_of(excinfo):
    return excinfo.value.code, excinfo.value.status


def portal_call(client, method, path, body=None, **query):
    if method == "get":
        return client.get(PORTAL + path, query)
    return getattr(client, method)(PORTAL + path, body or {}, content_type="application/json")


def audits(action):
    return list(AuditLog.objects.filter(action=action).order_by("created_at"))


# ---------------------------------------------------------------- R0: sign-up confirmed by email domain

@pytest.mark.parametrize("email", ["rahim@du.ac.bd", "rahim@cse.du.ac.bd"])
def test_a_verified_email_on_the_institutions_domain_confirms_the_sign_up(org, email):
    user = make_user(email, verified=False)
    request = request_institution(user, org)
    assert (request.status, request.coverage) == (Membership.Status.PENDING, NONE)
    assert confirm_signup_institution(user) is None  # not verified yet: stays pending

    user.email_verified = True
    user.save()
    confirmed = confirm_signup_institution(user)
    assert (confirmed.status, confirmed.coverage) == (Membership.Status.ACTIVE, NONE)
    [entry] = audits("membership.confirmed")
    assert entry.metadata["organization_id"] == str(org.id) and entry.metadata["source"] == "signup"
    assert services.seats_used(org) == 0
    assert services.membership_label(confirmed) == services.Label.NOT_COVERED


@pytest.mark.parametrize("email", ["rahim@gmail.com", "rahim@du.ac.bd.evil.com", "rahim@xdu.ac.bd"])
def test_a_mismatched_domain_removes_the_request(org, email):
    user = make_user(email, verified=False)
    request_institution(user, org)
    user.email_verified = True
    user.save()
    assert confirm_signup_institution(user) is None
    assert not Membership.objects.filter(user=user).exists()
    [entry] = audits("membership.request_dropped")
    assert entry.metadata["reason"] == "domain_mismatch" and entry.metadata["organization_id"] == str(org.id)


def test_an_institution_without_domains_confirms_nobody(org):
    org.sign_in_domains = []
    org.save()
    user = make_user("rahim@du.ac.bd")
    assert request_institution(user, org) is None  # verified at once: evaluated straight away, and dropped
    assert not Membership.objects.filter(user=user).exists()


def test_register_and_verify_confirms_the_matching_institution(org, zitadel_fake):
    c = Client()
    assert post(c, "/api/v1/auth/register/", form(institution=str(org.id))).status_code == 201
    user = User.objects.get(zitadel_subject="z-1")
    assert Membership.objects.get(user=user).status == Membership.Status.PENDING
    assert post(c, "/api/v1/auth/register/verify/", {"code": "123456"}).status_code == 200
    membership = Membership.objects.get(user=user)
    assert (membership.status, membership.coverage) == (Membership.Status.ACTIVE, NONE)


def test_register_with_a_gmail_address_leaves_no_institution(org, zitadel_fake):
    c = Client()
    post(c, "/api/v1/auth/register/", form(institution=str(org.id), email="rahim@gmail.com"))
    post(c, "/api/v1/auth/register/verify/", {"code": "123456"})
    assert not Membership.objects.exists()


def test_a_sign_in_with_a_verified_email_confirms_a_pending_request(org):
    user = provision_user({"iss": ISSUER, "sub": "s-1", "email": "x@du.ac.bd", "email_verified": False})
    request_institution(user, org)
    provision_user({"iss": ISSUER, "sub": "s-1", "email": "x@du.ac.bd", "email_verified": True})
    assert Membership.objects.get(user=user).status == Membership.Status.ACTIVE


def test_a_sign_up_without_an_institution_gets_nothing(zitadel_fake):
    c = Client()
    post(c, "/api/v1/auth/register/", form(institution="none"))
    post(c, "/api/v1/auth/register/verify/", {"code": "123456"})
    assert not Membership.objects.exists()
    assert confirm_signup_institution(User.objects.get()) is None


def test_sign_in_domains_belong_to_one_institution(org):
    other = make_org("buet", name="BUET", sign_in_domains=["buet.ac.bd"])
    with pytest.raises(ServiceError) as e:
        superadmin.update_institution(other, {"sign_in_domains": ["buet.ac.bd", "DU.ac.bd"]})
    assert code_of(e) == ("domain_taken", 409)
    assert e.value.extra["conflicts"] == [
        {"domain": "du.ac.bd", "institution": {"slug": "du", "name": "University of Dhaka"}},
    ]
    assert superadmin.update_institution(org, {"sign_in_domains": ["du.ac.bd", "cse.du.ac.bd"]}).sign_in_domains == [
        "du.ac.bd", "cse.du.ac.bd",
    ]  # its own domains are not a conflict
    with pytest.raises(ServiceError) as e:
        services.create_institution(data={"name": "Copy", "slug": "copy", "sign_in_domains": ["cse.du.ac.bd"]})
    assert code_of(e) == ("domain_taken", 409)


# ---------------------------------------------------------------- R0: one institution per person

def test_the_database_allows_one_live_membership_per_person(org):
    user = make_user("x@du.ac.bd")
    other = make_org("buet", name="BUET")
    Membership.objects.create(user=user, organization=org, status=Membership.Status.DEPROVISIONED)
    Membership.objects.create(user=user, organization=other)
    with pytest.raises(IntegrityError), transaction.atomic():
        Membership.objects.filter(user=user, organization=org).update(status=Membership.Status.ACTIVE)


def test_someone_in_another_institution_cannot_be_invited_imported_or_accept(org):
    other = make_org("buet", name="BUET")
    add_member(other, make_user("moved@gmail.com"))
    with pytest.raises(ServiceError) as e:
        services.create_invitation(organization=org, email="moved@gmail.com", source=SOURCE)
    assert code_of(e) == ("member_of_other_institution", 409)

    result = services.import_rows(org, [{"email": "moved@gmail.com"}], dry_run=False, source=SOURCE)
    assert result.rows[0]["status"] == "skip" and result.rows[0]["reason"] == "member_of_other_institution"
    assert not Invitation.objects.exists()

    _, token = make_invitation(org, "late@gmail.com")
    late = make_user("late@gmail.com")
    add_member(other, late)
    with pytest.raises(ServiceError) as e:
        services.accept_invitation(token, user=late)
    assert code_of(e) == ("member_of_other_institution", 409)
    assert not Membership.objects.filter(user=late, organization=org).exists()


def test_an_unverified_account_elsewhere_does_not_block_an_invitation(org):
    add_member(make_org("buet", name="BUET"), make_user("same@gmail.com", verified=False))
    assert services.create_invitation(organization=org, email="same@gmail.com", source=SOURCE).invitation


def test_accepting_drops_a_pending_sign_up_request_elsewhere(org):
    other = make_org("buet", name="BUET", sign_in_domains=["buet.ac.bd"])
    user = make_user("x@gmail.com", verified=False)
    request_institution(user, other)
    user.email_verified = True
    user.save(update_fields=["email_verified"])
    Membership.objects.filter(user=user).update(status=Membership.Status.PENDING)  # still waiting
    _, token = make_invitation(org, "x@gmail.com")
    services.accept_invitation(token, user=user)
    assert list(Membership.objects.filter(user=user).values_list("organization__slug", "coverage")) == [("du", COVERED)]
    [entry] = audits("membership.request_dropped")
    assert entry.metadata["reason"] == "joined_other_institution"


def test_reviving_a_removed_membership_is_refused_while_in_another_institution(org):
    removed = add_member(org, make_user("x@du.ac.bd"), status=Membership.Status.DEPROVISIONED)
    add_member(make_org("buet", name="BUET"), removed.user)
    with pytest.raises(ServiceError) as e:
        services.update_membership(removed, status="active", source=SOURCE)
    assert code_of(e) == ("member_of_other_institution", 409)


@pytest.mark.django_db(transaction=True)
def test_two_accepts_into_different_institutions_at_once_leave_one_membership():
    first = make_org("du", name="DU")
    second = make_org("buet", name="BUET")
    user = make_user("both@gmail.com")
    tokens = [make_invitation(first, "both@gmail.com")[1], make_invitation(second, "both@gmail.com")[1]]
    barrier = threading.Barrier(2)
    outcomes = []

    def attempt(token):
        try:
            barrier.wait()
            services.accept_invitation(token, user=user)
            outcomes.append("ok")
        except ServiceError as e:
            outcomes.append(e.code)
        finally:
            connection.close()

    threads = [threading.Thread(target=attempt, args=(t,)) for t in tokens]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(outcomes) == ["member_of_other_institution", "ok"]
    assert Membership.objects.filter(user=user).exclude(status=Membership.Status.DEPROVISIONED).count() == 1


# ---------------------------------------------------------------- R4: upgrade on invite, import, Add to package

def test_inviting_a_free_tier_member_covers_the_same_account(org, admin, django_capture_on_commit_callbacks):
    free = affiliate(org, "free@du.ac.bd")
    stale, _ = make_invitation(org, "free@du.ac.bd", expired=True)
    with django_capture_on_commit_callbacks(execute=True):
        invited = services.create_invitation(
            organization=org, email="Free@du.ac.bd", role="admin", source="portal", actor=admin.user,
            allowed_roles=services.PORTAL_ROLES,
        )
    assert invited.outcome == "covered" and invited.invitation is None and invited.email_sent is True
    free.refresh_from_db()
    assert (free.coverage, free.status, free.role) == (COVERED, Membership.Status.ACTIVE, "admin")
    assert Membership.objects.filter(user=free.user).count() == 1
    assert services.seats_used(org) == 2
    [entry] = audits("membership.covered")
    assert entry.metadata["via"] == "invitation" and entry.metadata["previous_role"] == "member"
    assert [m.subject for m in mail.outbox] == ["University of Dhaka added you to its BDREN AI package"]
    assert Notice.objects.get().email_status == Invitation.EmailStatus.SENT
    stale.refresh_from_db()
    assert stale.status == Invitation.Status.REVOKED


def test_the_portal_invite_endpoint_reports_a_covered_member(org, portal):
    free = affiliate(org, "free@du.ac.bd")
    r = portal_call(portal, "post", "invitations/", {"email": "free@du.ac.bd"})
    assert r.status_code == 201
    body = r.json()
    assert body["outcome"] == "covered" and body["invitation"] is None
    assert body["member"]["membership_id"] == str(free.id) and body["member"]["label"] == "covered"


def test_covering_on_invite_is_seat_checked(org):
    org.seat_cap = 1
    org.save()
    add_member(org)
    affiliate(org, "free@du.ac.bd")
    with pytest.raises(ServiceError) as e:
        services.create_invitation(organization=org, email="free@du.ac.bd", source=SOURCE)
    assert code_of(e) == ("seat_cap_reached", 409)


def test_import_covers_free_tier_members_and_invites_the_rest(org, django_capture_on_commit_callbacks):
    free = affiliate(org, "free@du.ac.bd")
    paying = affiliate(org, "paying@du.ac.bd")
    give_personal_plan(paying.user)
    add_member(make_org("buet", name="BUET"), make_user("elsewhere@gmail.com"))
    rows = [
        {"email": "free@du.ac.bd"}, {"email": "paying@du.ac.bd"}, {"email": "new@gmail.com"},
        {"email": "elsewhere@gmail.com"},
    ]
    dry = services.import_rows(org, rows, dry_run=True, source=SOURCE)
    assert [(r["status"], r["reason"], r["action"]) for r in dry.rows] == [
        ("ok", None, "cover"), ("ok", None, "consent_invite"), ("ok", None, "invite"),
        ("skip", "member_of_other_institution", None),
    ]
    assert dry.summary["actions"] == {"invite": 1, "cover": 1, "consent_invite": 1}
    assert free.coverage == NONE and not Invitation.objects.exists()

    with django_capture_on_commit_callbacks(execute=True):
        result = services.import_rows(org, rows, dry_run=False, source=SOURCE)
    body = result.body()
    assert (body["created"], body["covered"]) == (2, 1)
    free.refresh_from_db()
    assert free.coverage == COVERED
    assert sorted(Invitation.objects.values_list("email", flat=True)) == ["new@gmail.com", "paying@du.ac.bd"]
    assert sorted(m.to[0] for m in mail.outbox) == ["free@du.ac.bd", "new@gmail.com", "paying@du.ac.bd"]
    assert audits("organization.members_imported")[0].metadata["covered"] == 1


def test_import_over_the_cap_shows_which_rows_do_not_fit(org):
    org.seat_cap = 2
    org.save()
    add_member(org)
    affiliate(org, "free@du.ac.bd")
    rows = [{"email": "free@du.ac.bd"}, {"email": "new@gmail.com"}]
    dry = services.import_rows(org, rows, dry_run=True, source=SOURCE)
    assert dry.summary["fits"] == 1
    result = services.import_rows(org, rows, dry_run=False, source=SOURCE)
    assert [(r["status"], r["reason"]) for r in result.rows] == [("ok", None), ("error", "over_cap")]
    assert services.seats_used(org) == 2


def test_add_to_package_covers_a_free_tier_member(org, admin, portal, django_capture_on_commit_callbacks):
    free = affiliate(org, "free@du.ac.bd")
    with django_capture_on_commit_callbacks(execute=True):
        r = portal_call(portal, "post", f"members/{free.id}/cover/", {"reason": "staff"})
    assert r.status_code == 200
    assert r.json()["member"]["coverage"] == "institution"
    assert [m.to[0] for m in mail.outbox] == ["free@du.ac.bd"]
    [entry] = audits("membership.covered")
    assert entry.actor == admin.user and entry.metadata["source"] == "portal" and entry.metadata["reason"] == "staff"
    assert entry.metadata["via"] == "add_to_package"
    r = portal_call(portal, "post", f"members/{free.id}/cover/")
    assert (r.status_code, r.json()["error"]) == (409, "already_covered")


def test_add_to_package_refuses_personal_plan_members_and_full_institutions(org, portal):
    paying = affiliate(org, "paying@du.ac.bd")
    give_personal_plan(paying.user)
    r = portal_call(portal, "post", f"members/{paying.id}/cover/")
    assert (r.status_code, r.json()["error"]) == (409, "needs_consent_invitation")
    with pytest.raises(ServiceError) as e:
        services.cover_membership(paying, source=SOURCE)
    assert code_of(e) == ("needs_consent_invitation", 409)

    org.seat_cap = 1
    org.save()
    free = affiliate(org, "free@du.ac.bd")
    r = portal_call(portal, "post", f"members/{free.id}/cover/")
    assert (r.status_code, r.json()["error"]) == (409, "seat_cap_reached")
    r = portal_call(portal, "post", f"members/{free.id}/cover/", {"role": "owner"})
    assert (r.status_code, r.json()["error"]) == (400, "bad_role")


@pytest.mark.django_db(transaction=True)
def test_two_add_to_package_actions_at_the_seat_cap_take_one_seat():
    org = make_org("du", name="DU", seat_cap=2)
    add_member(org, role=Membership.Role.ADMIN)
    targets = [affiliate(org, f"free{i}@du.ac.bd") for i in range(2)]
    barrier = threading.Barrier(2)
    outcomes = []

    def attempt(target):
        try:
            barrier.wait()
            services.cover_membership(target, source=SOURCE)
            outcomes.append("ok")
        except ServiceError as e:
            outcomes.append(e.code)
        finally:
            connection.close()

    threads = [threading.Thread(target=attempt, args=(t,)) for t in targets]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(outcomes) == ["ok", "seat_cap_reached"]
    assert services.seats_used(org) == 2


def test_notices_beyond_the_inline_limit_go_to_the_mail_worker(org, settings, django_capture_on_commit_callbacks):
    settings.INVITATION_INLINE_EMAILS = 0
    free = affiliate(org, "free@du.ac.bd")
    with django_capture_on_commit_callbacks(execute=True):
        covered = services.cover_membership(free, source=SOURCE)
    assert covered.email_sent is False and mail.outbox == []
    assert Notice.objects.get().email_status == Invitation.EmailStatus.QUEUED
    assert send_queued() == (1, 0)
    assert [m.to[0] for m in mail.outbox] == ["free@du.ac.bd"]
    assert Notice.objects.get().email_status == Invitation.EmailStatus.SENT


# ---------------------------------------------------------------- R2: personal-plan members

def test_personal_plan_members_are_read_only_and_shown_without_details(org, portal):
    paying = affiliate(org, "paying@du.ac.bd")
    give_personal_plan(paying.user)
    free = affiliate(org, "free@du.ac.bd")
    body = portal_call(portal, "get", "members/", label="personal_plan").json()
    assert body["results"] == [{
        "membership_id": str(paying.id), "user": {"name": "Person", "email": "paying@du.ac.bd"},
        "label": "personal_plan", "joined_at": body["results"][0]["joined_at"],
    }]
    not_covered = portal_call(portal, "get", "members/", label="not_covered").json()["results"]
    assert [r["membership_id"] for r in not_covered] == [str(free.id)]
    for method, path, payload in (
        ("patch", f"members/{paying.id}/", {"status": "suspended"}),
        ("post", f"members/{paying.id}/remove/", {}),
    ):
        r = portal_call(portal, method, path, payload)
        assert (r.status_code, r.json()["error"]) == (403, "personal_plan_member")
    summary = portal_call(portal, "get", "").json()["counts"]
    assert (summary["not_covered"], summary["personal_plan"]) == (1, 1)


def test_not_covered_members_cannot_be_changed_or_removed_in_the_portal(org, portal):
    free = affiliate(org, "free@du.ac.bd")
    for method, path, payload in (
        ("patch", f"members/{free.id}/", {"role": "admin"}),
        ("post", f"members/{free.id}/remove/", {}),
    ):
        r = portal_call(portal, method, path, payload)
        assert (r.status_code, r.json()["error"]) == (409, "not_covered")


def test_membership_labels(org):
    covered = add_member(org)
    free = affiliate(org, "free@du.ac.bd")
    paying = affiliate(org, "paying@du.ac.bd")
    give_personal_plan(paying.user)
    invited = affiliate(org, "invited@du.ac.bd")
    give_personal_plan(invited.user)
    make_invitation(org, "invited@du.ac.bd")
    pending = add_member(org, status=Membership.Status.PENDING, coverage=NONE)
    labels = {m.pk: services.membership_label(m) for m in services.filter_members(org)}
    assert labels[covered.pk] == "covered" and labels[free.pk] == "not_covered"
    assert labels[paying.pk] == "personal_plan" and labels[invited.pk] == "invited" and labels[pending.pk] is None
    for pk in (paying.pk, invited.pk, free.pk):  # the same without the list annotations
        assert services.membership_label(Membership.objects.select_related("user").get(pk=pk)) == labels[pk]
    for label in services.Label.values:
        expected = {pk for pk, value in labels.items() if value == label}
        assert {m.pk for m in services.filter_members(org, label=label)} == expected


# ---------------------------------------------------------------- R5: removal

def test_portal_removal_uncovers_and_superadmin_removal_takes_them_out(org, admin):
    member = add_member(org, make_user("m@du.ac.bd"), role=Membership.Role.ADMIN)
    uncovered = services.uncover_membership(member, source="portal", actor=admin.user, reason="left")
    assert (uncovered.coverage, uncovered.status, uncovered.role) == (NONE, Membership.Status.ACTIVE, "member")
    assert services.membership_label(uncovered) == "not_covered" and services.seats_used(org) == 1
    with pytest.raises(ServiceError) as e:
        services.uncover_membership(uncovered, source="portal")
    assert code_of(e) == ("not_covered", 409)

    removed = services.remove_membership(uncovered, source=SOURCE, reason="wrong institution")
    assert removed.status == Membership.Status.DEPROVISIONED
    assert services.create_invitation(organization=make_org("buet", name="BUET"), email="m@du.ac.bd", source=SOURCE)


def test_uncovering_the_last_admin_is_refused(org, admin):
    with pytest.raises(ServiceError) as e:
        services.uncover_membership(admin, source="portal")
    assert code_of(e) == ("last_admin", 409)


# ---------------------------------------------------------------- D1: personal-plan consent

def test_a_personal_plan_member_consents_by_accepting_and_their_plan_stops_renewing(org):
    paying = affiliate(org, "paying@du.ac.bd")
    subscription = give_personal_plan(paying.user)
    invited = services.create_invitation(organization=org, email="paying@du.ac.bd", source=SOURCE)
    assert invited.outcome == "invited"  # no direct cover: their consent is needed
    raw = make_token_for(invited.invitation)
    assert services.preview_invitation(raw)["ends_personal_plan"] is False  # anonymous: nothing disclosed
    preview = services.preview_invitation(raw, paying.user)
    assert preview["ends_personal_plan"] is True
    assert preview["personal_plan_ends_at"] == iso(subscription.expires_at)

    with pytest.raises(ServiceError) as e:
        services.accept_invitation(raw, user=paying.user)
    assert code_of(e) == ("personal_plan_consent_required", 409)
    paying.refresh_from_db()
    subscription.refresh_from_db()
    assert paying.coverage == NONE and subscription.auto_renew is True

    result = services.accept_invitation(raw, user=paying.user, end_personal_plan=True)
    assert result["renewal_stopped"] is True
    paying.refresh_from_db()
    assert (paying.coverage, paying.status) == (COVERED, Membership.Status.ACTIVE)
    subscription.refresh_from_db()
    assert subscription.auto_renew is False and subscription.status == Subscription.Status.ACTIVE
    assert SubscriptionHistory.objects.filter(subscription=subscription, notes__contains="does not renew").exists()
    [entry] = audits("subscription.renewal_stopped")
    assert entry.metadata["organization_id"] == str(org.id)
    with pytest.raises(RenewalStopped):
        renew_subscription(subscription=subscription)


def make_token_for(invitation):
    """Gives `invitation` a known token (the email's token is only in the sent link)."""
    token, invitation.token_hash = new_token()
    invitation.save(update_fields=["token_hash"])
    return token


def test_the_admin_api_refuses_to_renew_a_stopped_subscription():
    boss = make_user("boss@bdren.ai")
    PlatformRoleAssignment.objects.create(user=boss, role=PlatformRoleAssignment.Role.SUPER_ADMIN)
    subscription = give_personal_plan(make_user("p@gmail.com"))
    Subscription.objects.filter(pk=subscription.pk).update(auto_renew=False)
    c = Client()
    c.force_login(boss)
    r = c.post("/api/v1/admin/subscriptions/", {"action": "renew", "subscription_id": str(subscription.id)},
               content_type="application/json")
    assert r.status_code == 409 and r.json()["error"] == "renewal_stopped"


# ---------------------------------------------------------------- migration

def test_the_one_institution_migration_lists_people_in_several_institutions(org):
    migration = importlib.import_module("apps.organizations.migrations.0006_membership_coverage_backfill")
    with connection.cursor() as cursor:
        cursor.execute("DROP INDEX uniq_membership_one_institution")
    user = make_user("twice@du.ac.bd")
    add_member(org, user)
    add_member(make_org("buet", name="BUET"), user)
    request = add_member(org, status=Membership.Status.PENDING)
    with pytest.raises(RuntimeError) as e:
        migration.uncover_requests_and_check_duplicates(django_apps, None)
    message = str(e.value)
    assert "1 people belong to more than one institution" in message
    assert "twice@du.ac.bd" in message and "buet, du" in message
    request.refresh_from_db()
    assert request.coverage == NONE


def test_unknown_ids_are_404_in_the_portal(portal):
    r = portal_call(portal, "post", f"members/{uuid.uuid4()}/cover/")
    assert (r.status_code, r.json()["error"]) == (404, "not_found")


def test_organization_status_matters_for_covering(org):
    free = affiliate(org, "free@du.ac.bd")
    org.status = Organization.Status.DEACTIVATED
    org.save()
    with pytest.raises(ServiceError) as e:
        services.cover_membership(free, source=SOURCE)
    assert code_of(e) == ("institution_inactive", 409)


# ---------------------------------------------------------------- review follow-ups

def test_the_portal_cannot_learn_that_an_email_belongs_to_another_institution(org, portal):
    add_member(make_org("buet", name="BUET"), make_user("moved@gmail.com"))
    rows = [{"email": "moved@gmail.com"}, {"email": "new@gmail.com"}]
    dry = portal_call(portal, "post", "import/", {"rows": rows, "dry_run": True}).json()
    assert [(r["status"], r["reason"], r["action"]) for r in dry["rows"]] == [
        ("ok", None, "invite"), ("ok", None, "invite"),
    ]

    r = portal_call(portal, "post", "invitations/", {"email": "moved@gmail.com"})
    assert r.status_code == 201 and r.json()["outcome"] == "invited"
    raw = make_token_for(Invitation.objects.get(email="moved@gmail.com"))
    with pytest.raises(ServiceError) as e:
        services.accept_invitation(raw, user=User.objects.get(email="moved@gmail.com"))
    assert code_of(e) == ("member_of_other_institution", 409)

    superadmin_dry = services.import_rows(org, rows, dry_run=True, source=SOURCE)
    assert superadmin_dry.rows[0]["reason"] == "member_of_other_institution"


def test_accepting_needs_consent_from_a_personal_plan_user_over_the_api(org):
    paying = make_user("paying@gmail.com")
    subscription = give_personal_plan(paying)
    invitation, _ = make_invitation(org, "paying@gmail.com")
    raw = make_token_for(invitation)
    c = Client()
    c.force_login(paying)
    assert c.get(f"/api/v1/invitations/{raw}/").json()["ends_personal_plan"] is True
    r = c.post(f"/api/v1/invitations/{raw}/accept/", {}, content_type="application/json")
    assert (r.status_code, r.json()["error"]) == (409, "personal_plan_consent_required")
    subscription.refresh_from_db()
    assert subscription.auto_renew is True and not Membership.objects.filter(user=paying).exists()

    r = c.post(f"/api/v1/invitations/{raw}/accept/", {"end_personal_plan": True}, content_type="application/json")
    assert r.status_code == 200 and r.json()["renewal_stopped"] is True
    subscription.refresh_from_db()
    assert subscription.auto_renew is False


@pytest.mark.parametrize("leave", ["uncover", "remove"])
def test_leaving_the_package_lets_the_personal_plan_renew_again(org, admin, leave):
    paying = make_user("paying@gmail.com")
    subscription = give_personal_plan(paying)
    invitation, _ = make_invitation(org, "paying@gmail.com")
    services.accept_invitation(make_token_for(invitation), user=paying, end_personal_plan=True)
    membership = Membership.objects.get(user=paying, organization=org)
    if leave == "uncover":
        services.uncover_membership(membership, source="portal", actor=admin.user)
    else:
        services.remove_membership(membership, source=SOURCE)
    subscription.refresh_from_db()
    assert subscription.auto_renew is True
    [entry] = audits("subscription.renewal_resumed")
    assert entry.metadata["organization_id"] == str(org.id) and entry.metadata["reason"] == "left_institution_package"
    assert renew_subscription(subscription=subscription).auto_renew is True


def test_a_stopped_subscription_can_be_resumed_or_paid_again():
    boss = make_user("boss@bdren.ai")
    PlatformRoleAssignment.objects.create(user=boss, role=PlatformRoleAssignment.Role.SUPER_ADMIN)
    c = Client()
    c.force_login(boss)
    subscription = give_personal_plan(make_user("p@gmail.com"))
    Subscription.objects.filter(pk=subscription.pk).update(auto_renew=False)
    r = c.post("/api/v1/admin/subscriptions/", {"action": "resume_renewal", "subscription_id": str(subscription.id)},
               content_type="application/json")
    assert r.status_code == 200 and r.json()["auto_renew"] is True
    assert audits("subscription.renewal_resumed")[0].actor == boss
    r = c.post("/api/v1/admin/subscriptions/", {"action": "renew", "subscription_id": str(subscription.id)},
               content_type="application/json")
    assert r.status_code == 200

    Subscription.objects.filter(pk=subscription.pk).update(auto_renew=False)
    payment = record_manual_payment(
        account=subscription.account, amount=500, reference="BK-1", subscription=subscription
    )
    r = c.post("/api/v1/admin/subscriptions/", {"action": "verify_payment", "payment_id": str(payment.id)},
               content_type="application/json")
    assert r.status_code == 200 and r.json()["status"] == "completed"
    subscription.refresh_from_db()
    assert subscription.auto_renew is True


def test_a_suspended_covered_member_cannot_be_invited_or_imported(org):
    suspended = add_member(org, make_user("s@du.ac.bd"), status=Membership.Status.SUSPENDED)
    with pytest.raises(ServiceError) as e:
        services.create_invitation(organization=org, email="s@du.ac.bd", source=SOURCE)
    assert code_of(e) == ("already_member", 409)
    for dry_run in (True, False):
        result = services.import_rows(org, [{"email": "s@du.ac.bd"}], dry_run=dry_run, source="portal")
        assert (result.rows[0]["status"], result.rows[0]["reason"]) == ("skip", "already_member")
    assert not Invitation.objects.exists()
    suspended.refresh_from_db()
    assert suspended.status == Membership.Status.SUSPENDED


def test_only_covered_members_can_be_suspended_or_made_admins(org):
    free = affiliate(org, "free@du.ac.bd")
    for change in ({"status": "suspended"}, {"role": "admin"}, {"role": "owner"}):
        with pytest.raises(ServiceError) as e:
            services.update_membership(free, source=SOURCE, **change)
        assert code_of(e) == ("not_covered", 409)
    free.refresh_from_db()
    assert (free.status, free.role) == (Membership.Status.ACTIVE, "member")
    assert services.update_membership(free, source=SOURCE, role="billing").role == "billing"

    legacy = affiliate(org, "legacy@du.ac.bd", status=Membership.Status.SUSPENDED)
    assert services.activate_membership(legacy, source=SOURCE).status == Membership.Status.ACTIVE


def test_someone_not_on_the_package_cannot_run_the_portal(org):
    legacy = affiliate(org, "legacy@du.ac.bd", role=Membership.Role.ADMIN)
    c = Client()
    c.force_login(legacy.user)
    r = portal_call(c, "get", "members/")
    assert (r.status_code, r.json()["error"]) == (403, "not_institution_admin")
    assert c.get("/api/v1/portal/institutions/").json() == []


def test_the_dry_run_marks_the_rows_over_the_cap_and_counts_held_seats(org):
    org.seat_cap = 3
    org.save()
    add_member(org)
    affiliate(org, "held@du.ac.bd")
    make_invitation(org, "held@du.ac.bd")  # already holds a seat: covering them needs no new one
    rows = [{"email": "a@gmail.com"}, {"email": "b@gmail.com"}, {"email": "held@du.ac.bd"}]
    dry = services.import_rows(org, rows, dry_run=True, source=SOURCE)
    assert [(r["status"], r["reason"], r["action"]) for r in dry.rows] == [
        ("ok", None, "invite"), ("ok", "over_cap", "invite"), ("ok", None, "cover"),
    ]
    assert dry.summary["fits"] == 2

    result = services.import_rows(org, rows, dry_run=False, source=SOURCE)
    assert [(r["status"], r["reason"]) for r in result.rows] == [("ok", None), ("error", "over_cap"), ("ok", None)]
    assert (result.created, result.covered) == (1, 1)
    assert services.seats_used(org) == 3


def test_the_superadmin_users_list_labels_personal_plan_members(org):
    boss = make_user("boss@bdren.ai")
    PlatformRoleAssignment.objects.create(user=boss, role=PlatformRoleAssignment.Role.SUPER_ADMIN)
    paying = affiliate(org, "paying@du.ac.bd")
    give_personal_plan(paying.user)
    affiliate(org, "free@du.ac.bd")
    c = Client()
    c.force_login(boss)
    rows = c.get("/api/v1/superadmin/users/").json()["results"]
    labels = {r["email"]: [m["label"] for m in r["memberships"]] for r in rows}
    assert labels["paying@du.ac.bd"] == ["personal_plan"] and labels["free@du.ac.bd"] == ["not_covered"]
    detail = c.get(f"/api/v1/superadmin/users/{paying.user_id}/").json()
    assert detail["memberships"][0]["label"] == "personal_plan"
