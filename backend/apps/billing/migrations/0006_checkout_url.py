from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("billing", "0005_drop_provider")]

    operations = [
        migrations.AddField(
            model_name="paymentrecord",
            name="bkash_checkout_url",
            field=models.CharField(blank=True, max_length=1000),
        ),
    ]
