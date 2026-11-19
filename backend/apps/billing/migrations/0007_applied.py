from django.db import migrations, models
import django.db.models.deletion

PAID = ("completed", "partially_refunded", "refunded")
NOT_APPLIED_NOTE = "Paid after a newer purchase of the same apps; no subscription was changed. BdREN refunds it."


def backfill(apps, schema_editor):
    """Paid rows linked to a subscription were applied; paid rows carrying the not-applied note were not; legacy rows
    without either stay unknown (None). Renewals and upgrades target the subscription they were bought for."""
    Payment = apps.get_model("billing", "PaymentRecord")
    paid = Payment.objects.filter(status__in=PAID)
    paid.filter(subscription__isnull=False).update(applied=True)
    paid.filter(subscription__isnull=True, notes__contains=NOT_APPLIED_NOTE).update(applied=False)
    renewals = Payment.objects.filter(kind__in=("renew", "upgrade"), subscription__isnull=False)
    for row in renewals.only("id", "subscription_id"):
        Payment.objects.filter(pk=row.pk).update(target_subscription_id=row.subscription_id)


class Migration(migrations.Migration):
    dependencies = [
        ("billing", "0006_checkout_url"),
        ("subscriptions", "0003_bundle_subscriptions"),
    ]

    operations = [
        migrations.AddField(
            model_name="paymentrecord",
            name="target_subscription",
            field=models.ForeignKey(
                blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="+",
                to="subscriptions.subscription",
            ),
        ),
        migrations.AddField(
            model_name="paymentrecord",
            name="applied",
            field=models.BooleanField(blank=True, null=True),
        ),
        migrations.RunPython(backfill, migrations.RunPython.noop),
    ]
