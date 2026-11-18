import importlib
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import pytest
from django.apps import apps as django_apps
from django.core.management import call_command
from django.db import connection, connections
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from apps.identities.services import provision_user
from apps.organizations.models import Membership
from apps.organizations.services import add_or_update_membership, create_organization
from apps.packages.models import PackageLimit
from apps.packages.services import create_package_with_version
from apps.products.models import Feature, Product
from apps.subscriptions.services import create_subscription
from apps.usage import reports
from apps.usage.models import UsageCounter, UsageDaily, UsageEvent, UsageReservation, usage_day
from apps.usage.services import (
    ReservationStateError,
    commit_reservation,
    release_reservation,
    reserve_quota,
)
from tests.conftest import ISSUER

pytestmark = pytest.mark.django_db

DHAKA = ZoneInfo("Asia/Dhaka")


def _user(sub):
    return provision_user({"iss": ISSUER, "sub": sub, "email": f"{sub}@du.ac.bd"})


def _org_setup(slug="usage-org", limit=10_000, period=PackageLimit.Period.MONTHLY):
    prod = Product.objects.create(name=f"Synapse {slug}", slug=f"synapse-{slug}")
    feat = Feature.objects.create(
        product=prod, key="tokens", name="Tokens", unit="tokens", quota_policy=Feature.QuotaPolicy.ORGANIZATION_ONLY
    )
    _, version = create_package_with_version(
        product=prod, name=f"Inst {slug}", slug=f"inst-{slug}",
        limits=[{"feature": feat, "limit_value": limit, "limit_period": period}],
    )
    org = create_organization(name=f"Org {slug}", slug=slug)
    create_subscription(account=org.account, package_version=version)
    return prod, feat, org


def _member(org, sub):
    u = _user(sub)
    add_or_update_membership(user=u, organization=org, role=Membership.Role.MEMBER)
    return u


def _reserve(user, prod, feat, org, key, quantity=10):
    return reserve_quota(
        user=user, product=prod, feature=feat, quantity=quantity, idempotency_key=key,
        organization_account=org.account,
    )


def _daily(org, feat, user):
    return UsageDaily.objects.get(account=org.account, feature=feat, user=user)


def test_user_recorded_on_reservation_and_event_and_daily_rollup():
    prod, feat, org = _org_setup()
    u = _member(org, "m-rec")

    res = _reserve(u, prod, feat, org, "k-1", quantity=40)
    assert res.user_id == u.id and res.account_id == org.account.id

    _, event = commit_reservation(reservation_id=res.id)
    assert event.user_id == u.id

    row = _daily(org, feat, u)
    assert (row.quantity, row.requests, row.product_id) == (40, 1, prod.id)
    assert row.day == usage_day(event.created_at)


def test_daily_rollup_increments_and_replayed_commit_counts_once():
    prod, feat, org = _org_setup()
    u = _member(org, "m-inc")

    first = _reserve(u, prod, feat, org, "k-1", quantity=25)
    second = _reserve(u, prod, feat, org, "k-2", quantity=15)
    commit_reservation(reservation_id=first.id)
    commit_reservation(reservation_id=second.id)
    commit_reservation(reservation_id=second.id)
    commit_reservation(reservation_id=first.id, idempotency_key="custom")

    row = _daily(org, feat, u)
    assert (row.quantity, row.requests) == (40, 2)
    assert UsageEvent.objects.filter(account=org.account).count() == 2


def _counter_used(org, feat):
    return sum(UsageCounter.objects.filter(account=org.account, feature=feat).values_list("used", flat=True))


def _daily_totals(org, feat):
    rows = UsageDaily.objects.filter(account=org.account, feature=feat)
    return sum(r.quantity for r in rows), sum(r.requests for r in rows)


def test_second_reservation_reusing_commit_key_is_rejected_and_not_charged():
    prod, feat, org = _org_setup()
    u = _member(org, "m-shared")
    first = _reserve(u, prod, feat, org, "k-a", quantity=25)
    second = _reserve(u, prod, feat, org, "k-b", quantity=15)

    commit_reservation(reservation_id=first.id, idempotency_key="shared")
    with pytest.raises(ReservationStateError):
        commit_reservation(reservation_id=second.id, idempotency_key="shared")

    assert UsageEvent.objects.filter(account=org.account).count() == 1
    assert _daily_totals(org, feat) == (25, 1)
    assert _counter_used(org, feat) == 25
    second.refresh_from_db()
    assert second.status == UsageReservation.Status.RESERVED

    _, event = commit_reservation(reservation_id=second.id)
    assert event.reservation_id == second.id
    assert _daily_totals(org, feat) == (40, 2) and _counter_used(org, feat) == 40


def test_commit_key_matching_another_members_event_does_not_hide_usage():
    prod, feat, org = _org_setup()
    a, b = _member(org, "m-ka"), _member(org, "m-kb")
    res_a = _reserve(a, prod, feat, org, "k-a", quantity=30)
    res_b = _reserve(b, prod, feat, org, "k-b", quantity=12)
    _, event_a = commit_reservation(reservation_id=res_a.id)

    with pytest.raises(ReservationStateError):
        commit_reservation(reservation_id=res_b.id, idempotency_key=event_a.idempotency_key)

    assert _counter_used(org, feat) == 30
    assert not UsageDaily.objects.filter(account=org.account, user=b).exists()
    commit_reservation(reservation_id=res_b.id)
    assert (_daily(org, feat, b).quantity, _counter_used(org, feat)) == (12, 42)


def test_reservation_key_reused_by_another_member_is_rejected():
    prod, feat, org = _org_setup()
    a, b = _member(org, "m-ra"), _member(org, "m-rb")
    res_a = _reserve(a, prod, feat, org, "same-key", quantity=20)

    with pytest.raises(ReservationStateError):
        _reserve(b, prod, feat, org, "same-key", quantity=5)

    assert _reserve(a, prod, feat, org, "same-key").id == res_a.id
    assert UsageReservation.objects.filter(account=org.account).count() == 1
    commit_reservation(reservation_id=res_a.id)
    assert _daily(org, feat, a).quantity == 20
    assert not UsageDaily.objects.filter(account=org.account, user=b).exists()


def test_released_and_expired_reservations_are_not_counted():
    prod, feat, org = _org_setup()
    u = _member(org, "m-rel")

    released = _reserve(u, prod, feat, org, "k-rel")
    release_reservation(reservation_id=released.id)

    expired = _reserve(u, prod, feat, org, "k-exp")
    UsageReservation.objects.filter(id=expired.id).update(expires_at=timezone.now() - timedelta(minutes=1))
    with pytest.raises(ReservationStateError):
        commit_reservation(reservation_id=expired.id)

    assert not UsageDaily.objects.filter(account=org.account).exists()


def test_organization_reservation_without_user_rolls_up_to_unattributed_bucket():
    prod, feat, org = _org_setup()
    u = _member(org, "m-null")
    res = _reserve(u, prod, feat, org, "k-null", quantity=7)
    UsageReservation.objects.filter(id=res.id).update(user=None)
    commit_reservation(reservation_id=res.id)
    res2 = _reserve(u, prod, feat, org, "k-null-2", quantity=3)
    UsageReservation.objects.filter(id=res2.id).update(user=None)
    commit_reservation(reservation_id=res2.id)

    row = UsageDaily.objects.get(account=org.account, user__isnull=True)
    assert (row.quantity, row.requests) == (10, 2)


@pytest.mark.django_db(transaction=True)
def test_concurrent_commits_sum_exactly():
    prod, feat, org = _org_setup(slug="conc-org")
    members = [_member(org, f"m-conc-{i}") for i in range(2)]
    reservations = [
        _reserve(members[i % 2], prod, feat, org, f"conc-{i}", quantity=i + 1) for i in range(12)
    ]

    def commit(res_id):
        try:
            commit_reservation(reservation_id=res_id)
        finally:
            connections.close_all()

    with ThreadPoolExecutor(max_workers=8) as ex:
        list(ex.map(commit, [r.id for r in reservations] * 2))

    even, odd = (_daily(org, feat, m) for m in members)
    assert (even.quantity, even.requests) == (sum(range(1, 13, 2)), 6)
    assert (odd.quantity, odd.requests) == (sum(range(2, 13, 2)), 6)


@pytest.mark.django_db(transaction=True)
def test_concurrent_first_inserts_into_one_bucket_from_different_counters():
    """UTC counter periods differ from Asia/Dhaka day buckets, so commits holding different counter locks
    can race to create the same UsageDaily row; each reservation gets its own counter to force that race."""
    workers = 8
    prod, feat, org = _org_setup(slug="race-org", period=PackageLimit.Period.DAILY)
    u = _member(org, "m-race")
    reservations = [_reserve(u, prod, feat, org, f"race-{i}", quantity=i + 1) for i in range(workers)]
    base = UsageCounter.objects.get(account=org.account, feature=feat)
    for i, res in enumerate(reservations[1:], start=1):
        counter = UsageCounter.objects.create(
            account=org.account, product=prod, feature=feat, reserved=res.quantity,
            period_start=base.period_start - timedelta(days=i), period_end=base.period_end - timedelta(days=i),
        )
        UsageReservation.objects.filter(id=res.id).update(counter=counter)
    barrier = threading.Barrier(workers, timeout=30)

    def commit(res_id):
        try:
            barrier.wait()
            commit_reservation(reservation_id=res_id)
        finally:
            connections.close_all()

    with ThreadPoolExecutor(max_workers=workers) as ex:
        list(ex.map(commit, [r.id for r in reservations]))

    row = _daily(org, feat, u)
    assert (row.quantity, row.requests) == (sum(range(1, workers + 1)), workers)
    assert _counter_used(org, feat) == row.quantity


def test_day_bucket_follows_asia_dhaka_midnight(monkeypatch):
    prod, feat, org = _org_setup()
    u = _member(org, "m-tz")
    tomorrow = timezone.localtime(timezone.now(), DHAKA).date() + timedelta(days=1)
    midnight = datetime.combine(tomorrow, time.min, tzinfo=DHAKA)

    for key, moment in (("before", midnight - timedelta(minutes=1)), ("after", midnight + timedelta(minutes=1))):
        monkeypatch.setattr("django.utils.timezone.now", lambda moment=moment: moment)
        commit_reservation(reservation_id=_reserve(u, prod, feat, org, key, quantity=5).id)

    days = dict(UsageDaily.objects.filter(account=org.account).values_list("day", "quantity"))
    assert days == {tomorrow - timedelta(days=1): 5, tomorrow: 5}


def test_usage_day_reads_timezone_setting(settings):
    moment = datetime(2026, 1, 1, 20, 0, tzinfo=ZoneInfo("UTC"))
    assert usage_day(moment) == date(2026, 1, 2)
    settings.BDREN_USAGE_TIMEZONE = "UTC"
    assert usage_day(moment) == date(2026, 1, 1)


def test_backfill_sets_personal_users_and_rebuilds_daily_rollup():
    prod, feat, org = _org_setup()
    u = _member(org, "m-bf")
    personal = u.accounts.get(account_type="personal")
    created = datetime(2026, 3, 1, 19, 0, tzinfo=ZoneInfo("UTC"))
    for i, account in enumerate((personal, personal, org.account)):
        ev = UsageEvent.objects.create(
            account=account, product=prod, feature=feat, quantity=10 + i, idempotency_key=f"bf-{i}"
        )
        UsageEvent.objects.filter(id=ev.id).update(created_at=created)
    UsageDaily.objects.create(account=org.account, product=prod, feature=feat, day=date(2020, 1, 1), quantity=1)

    migration = importlib.import_module("apps.usage.migrations.0003_backfill_member_usage")
    with connection.schema_editor() as editor:
        migration.backfill(django_apps, editor)

    assert set(UsageEvent.objects.filter(account=personal).values_list("user_id", flat=True)) == {u.id}
    assert UsageEvent.objects.get(account=org.account).user_id is None
    rows = {(r.account_id, r.user_id): (r.day, r.quantity, r.requests) for r in UsageDaily.objects.all()}
    assert rows == {
        (personal.id, u.id): (date(2026, 3, 2), 21, 2),
        (org.account.id, None): (date(2026, 3, 2), 12, 1),
    }


def test_backfill_rebuilds_daily_rollup_in_one_statement():
    prod, feat, org = _org_setup()
    start = datetime(2020, 1, 1, 12, 0, tzinfo=ZoneInfo("UTC"))
    days = 2_500
    UsageEvent.objects.bulk_create(
        UsageEvent(account=org.account, product=prod, feature=feat, quantity=1, idempotency_key=f"bulk-{i}")
        for i in range(days)
    )
    with connection.cursor() as cursor:
        cursor.execute(
            f"UPDATE {UsageEvent._meta.db_table} SET created_at = %s + "
            "split_part(idempotency_key, '-', 2)::int * interval '1 day' WHERE account_id = %s",
            [start, org.account.id],
        )

    migration = importlib.import_module("apps.usage.migrations.0003_backfill_member_usage")
    with CaptureQueriesContext(connection) as ctx, connection.schema_editor() as editor:
        migration.backfill(django_apps, editor)

    daily_table = UsageDaily._meta.db_table
    inserts = [q for q in ctx.captured_queries if q["sql"].startswith(f'INSERT INTO "{daily_table}"')
               or q["sql"].startswith(f"INSERT INTO {daily_table}")]
    assert len(inserts) == 1
    assert UsageDaily.objects.filter(account=org.account).count() == days


def test_usage_models_match_migrations():
    call_command("makemigrations", "usage", check=True, dry_run=True, verbosity=0)


@pytest.mark.parametrize("model", [UsageEvent, UsageReservation])
def test_hot_ledger_tables_have_no_unused_member_indexes(model):
    with connection.cursor() as cursor:
        cursor.execute("SELECT indexname, indexdef FROM pg_indexes WHERE tablename = %s", [model._meta.db_table])
        indexes = cursor.fetchall()
    assert [name for name, definition in indexes if "user_id" in definition or "created_at" in definition] == []


@pytest.mark.django_db(transaction=True)
def test_member_usage_migrations_reverse_and_reapply():
    prod, feat, org = _org_setup(slug="mig-org")
    u = _member(org, "m-mig")
    personal = u.accounts.get(account_type="personal")
    UsageEvent.objects.create(account=personal, product=prod, feature=feat, quantity=9, idempotency_key="mig-1")

    call_command("migrate", "usage", "0001", verbosity=0)
    call_command("migrate", "usage", verbosity=0)

    row = UsageDaily.objects.get(account=personal)
    assert (row.user_id, row.quantity, row.requests) == (u.id, 9, 1)
    with connection.cursor() as cursor:
        cursor.execute("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'uniq_usage_daily_bucket'")
        assert "NULLS NOT DISTINCT" in cursor.fetchone()[0]

@pytest.fixture
def report_data():
    """Two products on one institution account, plus another institution's usage on the same days."""
    synapse, tokens, org = _org_setup(slug="rep-org")
    mindspear = Product.objects.create(name="Mindspear", slug="mindspear-rep")
    quizzes = Feature.objects.create(product=mindspear, key="quizzes", name="Quizzes", unit="count")
    images = Feature.objects.create(product=synapse, key="images", name="Images", unit="count")
    _, other_feat, other_org = _org_setup(slug="rep-other")
    u1, u2, u3 = (_member(org, f"m-rep-{i}") for i in range(3))
    outsider = _member(other_org, "m-rep-out")
    personal = u1.accounts.get(account_type="personal")

    start, end = date(2026, 5, 8), date(2026, 5, 14)

    def add(account, product, feature, user, day, quantity, requests=1):
        UsageDaily.objects.create(
            account=account, product=product, feature=feature, user=user, day=day,
            quantity=quantity, requests=requests,
        )

    acct = org.account
    add(acct, synapse, tokens, u1, start, 100, 2)
    add(acct, synapse, tokens, u1, date(2026, 5, 10), 300, 3)
    add(acct, synapse, images, u2, date(2026, 5, 10), 50)
    add(acct, mindspear, quizzes, u2, end, 30, 3)
    add(acct, synapse, tokens, None, end, 20)
    add(acct, synapse, tokens, u3, date(2026, 5, 3), 200, 4)
    add(acct, synapse, tokens, u1, date(2026, 5, 1), 70)
    add(acct, synapse, tokens, u1, date(2026, 5, 15), 999)
    add(other_org.account, other_feat.product, other_feat, outsider, start, 5000, 50)
    add(personal, synapse, tokens, u1, start, 7000, 70)
    add(personal, mindspear, quizzes, u1, date(2026, 5, 3), 8000, 80)
    return {
        "account": acct, "start": start, "end": end, "synapse": synapse, "mindspear": mindspear,
        "tokens": tokens, "images": images, "quizzes": quizzes, "users": (u1, u2, u3), "outsider": outsider,
        "personal": personal,
    }


def test_summary_compares_with_previous_period(report_data):
    d = report_data
    result = reports.summary(d["account"], d["start"], d["end"])

    assert (result["quantity"], result["requests"], result["members_with_usage"], result["features_used"]) == (
        500, 10, 2, 3
    )
    previous = result["previous"]
    assert (previous["start_day"], previous["end_day"]) == (date(2026, 5, 1), date(2026, 5, 7))
    assert (previous["quantity"], previous["requests"], previous["members_with_usage"]) == (270, 5, 2)
    assert previous["features_used"] == 1
    assert result["change"] == {
        "quantity": 85.2, "requests": 100.0, "members_with_usage": 0.0, "features_used": 200.0
    }


def test_summary_change_is_none_without_previous_usage(report_data):
    d = report_data
    result = reports.summary(d["account"], d["start"], d["end"], product=d["mindspear"])
    assert (result["quantity"], result["previous"]["quantity"]) == (30, 0)
    assert result["change"]["quantity"] is None


def test_by_member_orders_pages_and_filters(report_data):
    d = report_data
    u1, u2, u3 = d["users"]
    rows = reports.by_member(d["account"], d["start"], d["end"])
    assert rows == [
        {"user_id": u1.id, "quantity": 400, "requests": 5, "last_used": date(2026, 5, 10)},
        {"user_id": u2.id, "quantity": 80, "requests": 4, "last_used": d["end"]},
    ]
    assert [r["user_id"] for r in reports.by_member(d["account"], d["start"], d["end"], limit=1, offset=1)] == [u2.id]
    assert reports.by_member(d["account"], d["start"], d["end"], user_ids=[u2.id, u3.id]) == [rows[1]]
    assert reports.by_member(d["account"], d["start"], d["end"], user_ids=[]) == []


def test_by_feature_reports_share(report_data):
    d = report_data
    rows = reports.by_feature(d["account"], d["start"], d["end"])
    assert [(r["product_slug"], r["feature_key"], r["quantity"], r["share"]) for r in rows] == [
        (d["synapse"].slug, "tokens", 420, 0.84),
        (d["synapse"].slug, "images", 50, 0.1),
        ("mindspear-rep", "quizzes", 30, 0.06),
    ]
    only_u2 = reports.by_feature(d["account"], d["start"], d["end"], user_ids=[d["users"][1].id])
    assert {r["feature_key"]: r["share"] for r in only_u2} == {"images": 0.625, "quizzes": 0.375}


def test_by_day_zero_fills_with_trailing_average(report_data):
    d = report_data
    rows = reports.by_day(d["account"], d["start"], d["end"], product=d["synapse"])
    assert [r["day"] for r in rows] == [d["start"] + timedelta(days=i) for i in range(7)]
    assert [r["quantity"] for r in rows] == [100, 0, 350, 0, 0, 0, 20]
    assert rows[1] == {"day": date(2026, 5, 9), "quantity": 0, "requests": 0, "quantity_avg_7d": round(300 / 7, 2)}
    assert rows[0]["quantity_avg_7d"] == round(300 / 7, 2)
    assert rows[-1]["quantity_avg_7d"] == round(470 / 7, 2)


def test_by_product_totals(report_data):
    d = report_data
    rows = reports.by_product(d["account"], d["start"], d["end"])
    assert [(r["product_slug"], r["quantity"], r["requests"]) for r in rows] == [
        (d["synapse"].slug, 470, 7),
        ("mindspear-rep", 30, 3),
    ]


def test_reports_never_include_another_account(report_data):
    d = report_data
    outsider = d["outsider"]
    args = (d["account"], d["start"], d["end"])
    assert outsider.id not in {r["user_id"] for r in reports.by_member(*args)}
    assert reports.by_member(*args, user_ids=[outsider.id]) == []
    assert reports.summary(*args, user_ids=[outsider.id])["quantity"] == 0
    assert all(r["quantity"] < 5000 for r in reports.by_feature(*args) + reports.by_product(*args))
    assert sum(r["quantity"] for r in reports.by_day(*args)) == 500


def test_reports_reject_raw_ids_and_reversed_ranges(report_data):
    d = report_data
    with pytest.raises(TypeError):
        reports.summary(d["account"].id, d["start"], d["end"])
    with pytest.raises(ValueError):
        reports.by_day(d["account"], d["end"], d["start"])


def test_reports_exclude_members_personal_plan_usage(report_data):
    d = report_data
    u1 = d["users"][0]
    args = (d["account"], d["start"], d["end"])
    assert UsageDaily.objects.filter(account=d["personal"], day__range=(d["start"], d["end"])).exists()
    for user_ids in (None, [u1.id]):
        result = reports.summary(*args, user_ids=user_ids)
        expected = (500, 10) if user_ids is None else (400, 5)
        assert (result["quantity"], result["requests"]) == expected
        assert result["previous"]["quantity"] == (270 if user_ids is None else 70)
        member = {r["user_id"]: r["quantity"] for r in reports.by_member(*args, user_ids=user_ids)}
        assert member[u1.id] == 400
        assert sum(r["quantity"] for r in reports.by_feature(*args, user_ids=user_ids)) == expected[0]
        assert sum(r["quantity"] for r in reports.by_day(*args, user_ids=user_ids)) == expected[0]
        assert sum(r["quantity"] for r in reports.by_product(*args, user_ids=user_ids)) == expected[0]
