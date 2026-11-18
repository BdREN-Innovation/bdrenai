from django.core.management.base import BaseCommand

from apps.packages.models import Package
from apps.packages.services import create_package_with_version
from apps.products.models import Feature, Product


# The website's apps (frontend/src/content/products.ts), in its order.
APPS = [
    {
        "slug": "synapse",
        "name": "Synapse",
        "description": "BdREN's AI workspace for offices, universities and research institutions, built on leading "
        "AI models with custom agents for specialised work.",
    },
    {
        "slug": "mindspear",
        "name": "Mindspear",
        "description": "AI research assistant with quests and assessments for universities and researchers.",
    },
    {
        "slug": "mail-wizard",
        "name": "AI Mail Wizard",
        "description": "Smart replies from the whole thread, formal emails from a few details, summaries and "
        "translation. Works in Roundcube and Gmail.",
    },
    {
        "slug": "quigen",
        "name": "QuiGen",
        "description": "Generates quizzes from a topic, your files or class material, ready for teachers to review "
        "and use.",
    },
]
# Descriptions earlier seeds wrote; an app still carrying one has not been edited, so it gets the website's.
OUTDATED_DESCRIPTIONS = {
    "Scientific workflow automation and data integration hub for campus labs.",
    "AI-powered academic research assistant, quest & assessment platform for universities and researchers.",
}


def ensure_apps():
    """Creates missing apps and refreshes unedited ones; superadmin edits are kept."""
    products = {}
    for order, app in enumerate(APPS):
        prod, created = Product.objects.get_or_create(
            slug=app["slug"],
            defaults={"name": app["name"], "description": app["description"], "sort_order": order},
        )
        if created:
            prod.rotate_api_key()
        elif prod.description in OUTDATED_DESCRIPTIONS:
            prod.name, prod.description, prod.sort_order = app["name"], app["description"], order
            prod.save(update_fields=["name", "description", "sort_order", "updated_at"])
        products[prod.slug] = prod
    return products


class Command(BaseCommand):
    help = "Idempotently seeds the BDREN apps (Synapse, Mindspear, AI Mail Wizard, QuiGen), features, and packages."

    def handle(self, *args, **options):
        products = ensure_apps()
        catalog = [
            {
                "slug": "mindspear",
                "features": [
                    ("ai_requests", "AI Requests", "requests", Feature.QuotaPolicy.PERSONAL_THEN_ORG),
                    ("storage_gb", "Cloud Storage", "GB", Feature.QuotaPolicy.PERSONAL_THEN_ORG),
                    ("projects", "Research Projects", "projects", Feature.QuotaPolicy.PERSONAL_THEN_ORG),
                    ("team_members", "Team Members", "seats", Feature.QuotaPolicy.ORGANIZATION_ONLY),
                ],
                "packages": [
                    ("starter", "Mindspear Starter", 0, "free", 0, {"ai_requests": 500, "storage_gb": 5, "projects": 3, "team_members": 1}),
                    ("professional", "Mindspear Professional", 1500, "monthly", 14, {"ai_requests": 5000, "storage_gb": 50, "projects": 25, "team_members": 10}),
                    ("institutional", "Mindspear Institutional", 25000, "monthly", 30, {"ai_requests": 50000, "storage_gb": 500, "projects": 500, "team_members": 250}),
                ],
            },
            {
                "slug": "synapse",
                "features": [
                    ("workflow_executions", "Workflow Executions", "runs", Feature.QuotaPolicy.ORG_THEN_PERSONAL),
                    ("api_requests", "API Calls", "calls", Feature.QuotaPolicy.PERSONAL_THEN_ORG),
                    ("integrations", "Active Integrations", "connectors", Feature.QuotaPolicy.PERSONAL_THEN_ORG),
                    ("storage_gb", "Artifact Storage", "GB", Feature.QuotaPolicy.PERSONAL_THEN_ORG),
                ],
                "packages": [
                    ("community", "Synapse Community", 0, "free", 0, {"workflow_executions": 250, "api_requests": 2500, "integrations": 3, "storage_gb": 2}),
                    ("lab-pro", "Synapse Lab Pro", 3000, "monthly", 14, {"workflow_executions": 10000, "api_requests": 100000, "integrations": 25, "storage_gb": 100}),
                ],
            },
        ]

        for p_def in catalog:
            prod = products[p_def["slug"]]
            feat_map = {}
            for f_key, f_name, f_unit, f_policy in p_def["features"]:
                f_obj, _ = Feature.objects.get_or_create(
                    product=prod,
                    key=f_key,
                    defaults={"name": f_name, "unit": f_unit, "quota_policy": f_policy},
                )
                feat_map[f_key] = f_obj
            for pkg_slug, pkg_name, price, interval, trial, lim_dict in p_def["packages"]:
                if not Package.objects.filter(product=prod, slug=pkg_slug).exists():
                    create_package_with_version(
                        product=prod,
                        name=pkg_name,
                        slug=pkg_slug,
                        price=price,
                        billing_interval=interval,
                        trial_days=trial,
                        limits=[{"feature": feat_map[k], "limit_value": v, "limit_period": "monthly"} for k, v in lim_dict.items()],
                    )
        self.stdout.write(self.style.SUCCESS("Seeded BDREN product catalog."))
