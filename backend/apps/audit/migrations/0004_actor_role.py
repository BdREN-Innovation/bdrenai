from django.db import migrations, models
from django.db.models import Exists, OuterRef, Q

ROLES = [
    ("superadmin", "Superadmin"),
    ("institution_admin", "Institution admin"),
    ("user", "User"),
    ("system", "System"),
]


def backfill(apps, schema_editor):
    """Existing entries get the role their actor holds now (the best available guess for the past)."""
    AuditLog = apps.get_model("audit", "AuditLog")
    PlatformRoleAssignment = apps.get_model("administration", "PlatformRoleAssignment")
    superadmin = PlatformRoleAssignment.objects.filter(user_id=OuterRef("actor_id"), role="platform_super_admin")
    pending = AuditLog.objects.filter(actor_role="")
    pending.filter(actor__isnull=True).update(actor_role="system")
    pending.annotate(is_superadmin=Exists(superadmin)).filter(is_superadmin=True).update(actor_role="superadmin")
    pending.filter(Q(metadata__source="portal")).update(actor_role="institution_admin")
    pending.update(actor_role="user")


class Migration(migrations.Migration):
    dependencies = [
        ("audit", "0003_target_index"),
        ("administration", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="auditlog",
            name="actor_role",
            field=models.CharField(choices=ROLES, db_index=True, default="", max_length=32),
            preserve_default=False,
        ),
        migrations.RunPython(backfill, migrations.RunPython.noop),
    ]
