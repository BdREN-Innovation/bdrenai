from django.db import migrations

PAID = ("completed", "partially_refunded", "refunded")


def clear_unpaid(apps, schema_editor):
    """Before 0008, checkout stored a renewal's target in `subscription` up front. `subscription` now means what a
    completed payment created or extended, so unpaid billing-era rows keep their target only in
    `target_subscription`."""
    Payment = apps.get_model("billing", "PaymentRecord")
    unpaid = Payment.objects.exclude(status__in=PAID).exclude(kind="legacy").filter(subscription__isnull=False)
    for row in unpaid.filter(target_subscription__isnull=True).only("id", "subscription_id"):
        Payment.objects.filter(pk=row.pk).update(target_subscription_id=row.subscription_id)
    unpaid.update(subscription=None)


class Migration(migrations.Migration):
    dependencies = [("billing", "0007_applied")]

    operations = [migrations.RunPython(clear_unpaid, migrations.RunPython.noop)]
