import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("products", "0002_catalog_order"),
        ("subscriptions", "0002_subscription_auto_renew"),
    ]

    operations = [
        migrations.AlterField(
            model_name="subscription",
            name="product",
            field=models.ForeignKey(
                blank=True, null=True, on_delete=django.db.models.deletion.PROTECT,
                related_name="subscriptions", to="products.product",
            ),
        ),
        migrations.AddField(
            model_name="subscription",
            name="expiry_reminder_sent_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
