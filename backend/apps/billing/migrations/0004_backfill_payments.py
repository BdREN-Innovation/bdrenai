"""Existing payments become `kind = legacy`, with `method` from the old `provider`, and completed ones get
`completed_at` (their verification time) and `payment_date`. Statuses keep their values (pending, completed,
rejected exist in both)."""
from django.db import migrations

METHODS = {"manual_offline": "other", "bank_transfer": "bank_transfer", "institutional_invoice": "other"}


def forwards(apps, schema_editor):
    PaymentRecord = apps.get_model("billing", "PaymentRecord")
    rows = list(PaymentRecord.objects.all())
    for row in rows:
        row.kind = "legacy"
        row.method = METHODS.get(row.provider, "other")
        row.payment_date = row.created_at.date()
        if row.status == "completed":
            row.completed_at = row.verified_at or row.created_at
    PaymentRecord.objects.bulk_update(rows, ["kind", "method", "payment_date", "completed_at"], batch_size=500)


def backwards(apps, schema_editor):
    PaymentRecord = apps.get_model("billing", "PaymentRecord")
    providers = {"bank_transfer": "bank_transfer"}
    rows = list(PaymentRecord.objects.all())
    for row in rows:
        row.provider = providers.get(row.method, "manual_offline")
    PaymentRecord.objects.bulk_update(rows, ["provider"], batch_size=500)


class Migration(migrations.Migration):

    dependencies = [("billing", "0003_payments")]

    operations = [migrations.RunPython(forwards, backwards)]
