from django.db import migrations
from django.db.models import Count

LISTED = 50


def uncover_requests_and_check_duplicates(apps, schema_editor):
    """Sign-up requests (pending) are not covered; they are confirmed or dropped when the person's email is verified.

    One person may belong to one institution only (0007 adds the constraint). People who are in several are listed
    so BDREN support can remove the wrong memberships first; nothing is dropped here.
    """
    Membership = apps.get_model("organizations", "Membership")
    Membership.objects.filter(status="pending").update(coverage="none")
    duplicates = list(
        Membership.objects.exclude(status="deprovisioned")
        .values("user_id", "user__email")
        .annotate(n=Count("pk"))
        .filter(n__gt=1)
        .order_by("user__email")
    )
    if not duplicates:
        return
    lines = []
    for row in duplicates[:LISTED]:
        slugs = sorted(
            Membership.objects.filter(user_id=row["user_id"])
            .exclude(status="deprovisioned")
            .values_list("organization__slug", flat=True)
        )
        lines.append(f"  user {row['user_id']} <{row['user__email']}>: {', '.join(slugs)}")
    more = f"\n  ... and {len(duplicates) - LISTED} more" if len(duplicates) > LISTED else ""
    raise RuntimeError(
        f"{len(duplicates)} people belong to more than one institution, which is no longer allowed. Remove "
        "(deprovision) all but one of their memberships, then run the migration again:\n" + "\n".join(lines) + more
    )


class Migration(migrations.Migration):
    dependencies = [
        ("organizations", "0005_membership_coverage"),
    ]

    operations = [
        migrations.RunPython(uncover_requests_and_check_duplicates, migrations.RunPython.noop),
    ]
