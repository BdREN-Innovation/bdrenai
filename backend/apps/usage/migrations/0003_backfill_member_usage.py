from django.conf import settings
from django.db import migrations
from django.db.models import OuterRef, Subquery

PERSONAL = "personal"


def _owner_of_account(Account):
    return Subquery(Account.objects.filter(pk=OuterRef("account_id")).values("owner_user_id")[:1])


def _rebuild_daily_sql(UsageEvent, UsageDaily) -> str:
    """One set-based INSERT ... SELECT, so no bucket is ever loaded into Python."""
    return (
        f"INSERT INTO {UsageDaily._meta.db_table} "
        "(id, account_id, product_id, feature_id, user_id, day, quantity, requests) "
        "SELECT gen_random_uuid(), account_id, product_id, feature_id, user_id, "
        "(created_at AT TIME ZONE %s)::date, SUM(quantity), COUNT(*) "
        f"FROM {UsageEvent._meta.db_table} "
        "GROUP BY account_id, product_id, feature_id, user_id, (created_at AT TIME ZONE %s)::date"
    )


def backfill(apps, schema_editor):
    Account = apps.get_model("accounts", "Account")
    UsageReservation = apps.get_model("usage", "UsageReservation")
    UsageEvent = apps.get_model("usage", "UsageEvent")
    UsageDaily = apps.get_model("usage", "UsageDaily")

    for model in (UsageReservation, UsageEvent):
        model.objects.filter(user__isnull=True, account__account_type=PERSONAL).update(
            user_id=_owner_of_account(Account)
        )

    UsageDaily.objects.all().delete()
    zone = getattr(settings, "BDREN_USAGE_TIMEZONE", "Asia/Dhaka") or "Asia/Dhaka"
    schema_editor.execute(_rebuild_daily_sql(UsageEvent, UsageDaily), (zone, zone))


class Migration(migrations.Migration):

    dependencies = [
        ("usage", "0002_member_usage"),
    ]

    operations = [
        migrations.RunPython(backfill, migrations.RunPython.noop),
    ]
