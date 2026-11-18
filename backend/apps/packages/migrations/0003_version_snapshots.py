from django.db import migrations


def fill_snapshots(apps, schema_editor):
    """Existing versions predate the snapshot fields: copy their package's current terms and app."""
    PackageVersion = apps.get_model("packages", "PackageVersion")
    Included = PackageVersion.products.through
    versions = list(PackageVersion.objects.select_related("package"))
    for version in versions:
        package = version.package
        version.price = package.price
        version.currency = package.currency
        version.billing_interval = package.billing_interval
        version.price_unit = package.price_unit
        version.trial_days = package.trial_days
    PackageVersion.objects.bulk_update(
        versions, ["price", "currency", "billing_interval", "price_unit", "trial_days"]
    )
    Included.objects.bulk_create(
        [
            Included(packageversion_id=v.id, product_id=v.package.product_id)
            for v in versions
            if v.package.product_id
        ],
        ignore_conflicts=True,
    )


class Migration(migrations.Migration):

    dependencies = [
        ("packages", "0002_catalog_kinds"),
    ]

    operations = [
        migrations.RunPython(fill_snapshots, migrations.RunPython.noop),
    ]
