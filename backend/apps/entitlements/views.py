from django.core.exceptions import PermissionDenied
from django.http import JsonResponse
from django.utils import timezone
from rest_framework.permissions import AllowAny
from rest_framework.views import APIView

from apps.accounts.services import accessible_accounts_for_user
from apps.products.models import Feature
from apps.usage.services import check_entitlement_status

from .auth import resolve_caller_and_product
from .models import Entitlement
from .services import current_period_bounds


class EntitlementCheckView(APIView):
    """POST /api/v1/entitlements/check/"""

    permission_classes = [AllowAny]  # Auth handled strictly by resolve_caller_and_product

    def post(self, request):
        try:
            user, org_acct, product = resolve_caller_and_product(request, request.data.get("product"))
        except PermissionDenied as e:
            return JsonResponse({"error": "forbidden", "detail": str(e)}, status=403)
        if product is None:
            return JsonResponse({"error": "product_required"}, status=400)

        feature_key = request.data.get("feature")
        feature = Feature.objects.filter(product=product, key=feature_key, status=Feature.Status.ACTIVE).first()
        if feature is None:
            return JsonResponse({"error": "feature_not_found"}, status=404)

        try:
            qty = int(request.data.get("quantity", 1))
            if qty <= 0:
                raise ValueError
        except (TypeError, ValueError):
            return JsonResponse({"error": "invalid_quantity"}, status=400)

        try:
            report = check_entitlement_status(
                user=user,
                product=product,
                feature=feature,
                quantity=qty,
                organization_account=org_acct,
            )
        except PermissionError as e:
            return JsonResponse({"error": "forbidden", "detail": str(e)}, status=403)
        return JsonResponse(report)


class CurrentEntitlementsView(APIView):
    """GET /api/v1/entitlements/current/"""

    def get(self, request):
        now = timezone.now()
        accounts = accessible_accounts_for_user(request.user)
        ents = (
            Entitlement.objects.filter(account__in=accounts, effective_from__lte=now)
            .select_related("account", "product", "feature")
            .order_by("product__slug", "feature__key")
        )
        items = []
        for e in ents:
            if e.effective_until and e.effective_until <= now:
                continue
            _, p_end = current_period_bounds(e.period, now)
            items.append({
                "id": str(e.id),
                "account_id": str(e.account_id),
                "account_type": e.account.account_type,
                "product": e.product.slug,
                "feature": e.feature.key,
                "limit": e.limit,
                "period": e.period,
                "is_override": e.is_override,
                "reset_at": p_end.strftime("%Y-%m-%dT%H:%M:%SZ"),
            })
        return JsonResponse({"entitlements": items})
