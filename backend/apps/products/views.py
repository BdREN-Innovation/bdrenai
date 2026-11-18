from collections import defaultdict

from django.core.exceptions import PermissionDenied
from django.db.models import Prefetch
from django.http import JsonResponse
from rest_framework.permissions import AllowAny
from rest_framework.views import APIView

from apps.accounts.services import resolve_authorized_account
from apps.billing.models import PaymentRecord
from apps.billing.services import record_manual_payment
from apps.packages import services as package_services
from apps.packages.models import Package, PackageVersion
from apps.subscriptions.services import create_subscription

from .models import Feature, Product


def _catalog_package(pkg):
    """A package as the public catalog shows it (`services.public_packages()`)."""
    ver = pkg.current_versions[0] if pkg.current_versions else None
    limits = [
        {
            "feature_key": lim.feature.key,
            "feature_name": lim.feature.name,
            "unit": lim.feature.unit,
            "limit_value": lim.limit_value,
            "limit_period": lim.limit_period,
        }
        for lim in (ver.limits.all() if ver else [])
    ]
    return {
        "id": str(pkg.id),
        "name": pkg.name,
        "slug": pkg.slug,
        "description": pkg.description,
        "price": str(pkg.price),
        "currency": pkg.currency,
        "billing_interval": pkg.billing_interval,
        "trial_days": pkg.trial_days,
        "latest_version": ver.version if ver else None,
        "package_version_id": str(ver.id) if ver else None,
        "limits": limits,
    }


def _bundle_apps(pkg):
    """The active apps of a bundle's current version (`services.public_packages()` prefetches only those)."""
    if not pkg.current_versions:
        return []
    return [{"slug": p.slug, "name": p.name} for p in pkg.current_versions[0].products.all()]


class PublicProductCatalogView(APIView):
    """GET /api/v1/catalog/products/ — Public catalog of active BDREN products with their features and public,
    unarchived single packages, plus the combined packages (`bundles`, each with its active `apps`; a bundle
    left with fewer than two active apps is not offered)."""

    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        active_features = Prefetch("features", queryset=Feature.objects.filter(status=Feature.Status.ACTIVE))
        products = (
            Product.objects.filter(status=Product.Status.ACTIVE)
            .prefetch_related(active_features)
            .order_by("sort_order", "name")
        )
        offered = list(package_services.public_packages())
        singles = defaultdict(list)
        for pkg in offered:
            if pkg.kind == Package.Kind.SINGLE:
                singles[pkg.product_id].append(_catalog_package(pkg))
        bundles = [
            {**_catalog_package(pkg), "apps": apps}
            for pkg in offered
            if pkg.kind == Package.Kind.BUNDLE and len(apps := _bundle_apps(pkg)) >= 2
        ]
        out = [
            {
                "id": str(p.id),
                "name": p.name,
                "slug": p.slug,
                "description": p.description,
                "features": [
                    {"key": f.key, "name": f.name, "unit": f.unit, "description": f.description}
                    for f in p.features.all()
                ],
                "packages": singles[p.id],
            }
            for p in products
        ]
        return JsonResponse({"products": out, "bundles": bundles})


class SubscribePackageView(APIView):
    """POST /api/v1/catalog/subscribe/ — Authenticated user subscribes their active Personal or Organization account.
    - Free or trial packages activate immediately.
    - Paid packages without trial create a pending manual/offline PaymentRecord for administrator verification.
    """

    def post(self, request):
        pkg_id = request.data.get("package_id")
        account_id = request.data.get("account_id")
        use_trial = bool(request.data.get("use_trial", False))
        payment_ref = (request.data.get("payment_reference") or "").strip()

        try:
            acct = resolve_authorized_account(request.user, account_id=account_id, session=request.session)
        except PermissionDenied:
            return JsonResponse({"error": "forbidden_account"}, status=403)

        pkg = (
            Package.objects.filter(
                id=pkg_id, status=Package.Status.ACTIVE, kind=Package.Kind.SINGLE, product__status=Product.Status.ACTIVE
            )
            .select_related("product")
            .first()
        )
        if pkg is None:
            return JsonResponse({"error": "package_not_found"}, status=404)

        ver = pkg.versions.filter(status=PackageVersion.Status.ACTIVE).order_by("-version").first()
        if ver is None:
            return JsonResponse({"error": "no_active_package_version"}, status=400)

        if pkg.price == 0 or (use_trial and pkg.trial_days > 0):
            sub = create_subscription(
                account=acct,
                package_version=ver,
                use_trial=use_trial,
                actor=request.user,
            )
            return JsonResponse({
                "status": "activated",
                "subscription_id": str(sub.id),
                "subscription_status": sub.status,
                "package_version": ver.version,
            }, status=201)

        if not payment_ref:
            return JsonResponse({"error": "payment_reference_required_for_paid_package"}, status=400)

        pmt = record_manual_payment(
            account=acct,
            amount=pkg.price,
            currency=pkg.currency,
            provider=request.data.get("payment_provider", PaymentRecord.Provider.MANUAL_OFFLINE),
            reference=payment_ref,
            notes=f"Subscription request for {pkg.product.name} - {pkg.name} (v{ver.version})",
        )
        return JsonResponse({
            "status": "pending_payment_verification",
            "payment_id": str(pmt.id),
            "reference": pmt.reference,
            "package_version_id": str(ver.id),
        }, status=202)
