from django.core.exceptions import PermissionDenied
from django.http import JsonResponse
from rest_framework.permissions import AllowAny
from rest_framework.views import APIView

from apps.accounts.services import accessible_accounts_for_user
from apps.entitlements.auth import resolve_caller_and_product
from apps.products.models import Feature

from .models import UsageCounter, UsageReservation
from .services import (
    QuotaExceededError,
    ReservationStateError,
    commit_reservation,
    release_reservation,
    reserve_quota,
)


class UsageReservationCreateView(APIView):
    """POST /api/v1/usage/reservations/"""

    permission_classes = [AllowAny]

    def post(self, request):
        try:
            user, org_acct, product = resolve_caller_and_product(request, request.data.get("product"))
        except PermissionDenied as e:
            return JsonResponse({"error": "forbidden", "detail": str(e)}, status=403)
        if product is None:
            return JsonResponse({"error": "product_required"}, status=400)

        feature_key = request.data.get("feature")
        idempotency_key = (request.data.get("idempotency_key") or "").strip()
        if not feature_key or not idempotency_key:
            return JsonResponse({"error": "feature_and_idempotency_key_required"}, status=400)

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
            res = reserve_quota(
                user=user,
                product=product,
                feature=feature,
                quantity=qty,
                idempotency_key=idempotency_key,
                organization_account=org_acct,
                metadata=request.data.get("metadata") or {},
            )
        except QuotaExceededError as e:
            return JsonResponse({"allowed": False, "error": "quota_exceeded", "detail": str(e)}, status=429)
        except ReservationStateError as e:
            return JsonResponse({"error": "idempotency_key_conflict", "detail": str(e)}, status=409)
        except PermissionError as e:
            return JsonResponse({"error": "forbidden", "detail": str(e)}, status=403)

        return JsonResponse({
            "reservation_id": str(res.id),
            "account_id": str(res.account_id),
            "product": product.slug,
            "feature": feature.key,
            "quantity": res.quantity,
            "status": res.status,
            "idempotency_key": res.idempotency_key,
            "expires_at": res.expires_at.strftime("%Y-%m-%dT%H:%M:%SZ"),
        }, status=201)


def _authorize_reservation_action(request, reservation: UsageReservation):
    raw_key = request.headers.get("X-Product-Api-Key", "").strip()
    if raw_key:
        _, _, product = resolve_caller_and_product(request, reservation.product.slug)
        if product.id != reservation.product_id:
            raise PermissionDenied("Product mismatch")
        return
    if not request.user or not request.user.is_authenticated:
        raise PermissionDenied("Authentication required")
    if not accessible_accounts_for_user(request.user).filter(id=reservation.account_id).exists():
        raise PermissionDenied("Not authorized for this reservation's account")


class UsageReservationCommitView(APIView):
    """POST /api/v1/usage/reservations/{id}/commit/"""

    permission_classes = [AllowAny]

    def post(self, request, reservation_id):
        res = UsageReservation.objects.select_related("product", "feature").filter(id=reservation_id).first()
        if res is None:
            return JsonResponse({"error": "reservation_not_found"}, status=404)
        try:
            if not request.headers.get("X-Product-Api-Key"):
                _authorize_reservation_action(request, res)
            else:
                from apps.products.models import hash_api_key
                if res.product.api_key_hash != hash_api_key(request.headers["X-Product-Api-Key"].strip()):
                    raise PermissionDenied("Invalid product API key")
        except PermissionDenied as e:
            return JsonResponse({"error": "forbidden", "detail": str(e)}, status=403)

        try:
            res, event = commit_reservation(
                reservation_id=res.id,
                idempotency_key=request.data.get("idempotency_key") if isinstance(request.data, dict) else None,
            )
        except ReservationStateError as e:
            return JsonResponse({"error": "invalid_reservation_state", "detail": str(e)}, status=409)

        return JsonResponse({
            "reservation_id": str(res.id),
            "status": res.status,
            "usage_event_id": str(event.id),
            "quantity": event.quantity,
        })


class UsageReservationReleaseView(APIView):
    """POST /api/v1/usage/reservations/{id}/release/"""

    permission_classes = [AllowAny]

    def post(self, request, reservation_id):
        res = UsageReservation.objects.select_related("product", "feature").filter(id=reservation_id).first()
        if res is None:
            return JsonResponse({"error": "reservation_not_found"}, status=404)
        try:
            if not request.headers.get("X-Product-Api-Key"):
                _authorize_reservation_action(request, res)
            else:
                from apps.products.models import hash_api_key
                if res.product.api_key_hash != hash_api_key(request.headers["X-Product-Api-Key"].strip()):
                    raise PermissionDenied("Invalid product API key")
        except PermissionDenied as e:
            return JsonResponse({"error": "forbidden", "detail": str(e)}, status=403)

        try:
            res = release_reservation(reservation_id=res.id)
        except ReservationStateError as e:
            return JsonResponse({"error": "invalid_reservation_state", "detail": str(e)}, status=409)

        return JsonResponse({"reservation_id": str(res.id), "status": res.status})


class UsageSummaryView(APIView):
    """GET /api/v1/usage/summary/"""

    def get(self, request):
        accounts = accessible_accounts_for_user(request.user)
        counters = (
            UsageCounter.objects.filter(account__in=accounts)
            .select_related("account", "product", "feature")
            .order_by("-period_start")
        )
        items = []
        for c in counters:
            items.append({
                "account_id": str(c.account_id),
                "account_type": c.account.account_type,
                "product": c.product.slug,
                "feature": c.feature.key,
                "used": c.used,
                "reserved": c.reserved,
                "period_start": c.period_start.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "period_end": c.period_end.strftime("%Y-%m-%dT%H:%M:%SZ"),
            })
        return JsonResponse({"usage": items})
