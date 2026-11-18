from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("organizations", "0006_membership_coverage_backfill"),
    ]

    operations = [
        migrations.AddConstraint(
            model_name="membership",
            constraint=models.UniqueConstraint(
                condition=models.Q(("status", "deprovisioned"), _negated=True),
                fields=("user",),
                name="uniq_membership_one_institution",
            ),
        ),
    ]
