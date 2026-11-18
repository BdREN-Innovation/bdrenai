from django.db import migrations, models


class Migration(migrations.Migration):
    """Every existing membership starts as `institution`; 0006 moves the sign-up requests to `none`."""

    dependencies = [
        ("organizations", "0004_organization_sector"),
    ]

    operations = [
        migrations.AddField(
            model_name="membership",
            name="coverage",
            field=models.CharField(
                choices=[("institution", "Institution"), ("none", "None")], default="institution", max_length=16
            ),
        ),
    ]
