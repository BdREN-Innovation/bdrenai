"""Institution console billing (`/api/v1/portal/institutions/<slug>/billing/`, docs/BILLING_API.md "Portal API
additions" and "Portal errors and shapes"). Owners/admins of that institution only (`PortalView` access rules)."""
import uuid

from django.http import JsonResponse

from apps.audit.services import client_ip
from apps.billing import bkash, queries, quotes, shapes
from apps.billing import services as billing
from apps.billing.views import attachment_response, receipt_response
from apps.invitations.errors import ServiceError, invalid

from . import services
from .views import PortalView


def _body(request):
    data = request.data
    if not isinstance(data, dict):
        raise invalid({"non_field": "Send a JSON object."})
    return data


def _subscription_body(pk):
    return {"subscription": shapes.subscription(queries.subscription_queryset().get(pk=pk))}


def _optional_uuid(value, field):
    if value in (None, ""):
        return None
    try:
        return uuid.UUID(str(value))
    except ValueError:
        raise invalid({field: "Use an id (UUID)."}) from None


class BillingView(PortalView):
    def get(self, request, slug):
        account = billing.organization_account(self.organization)
        subscriptions, payments = queries.account_billing(account)
        return JsonResponse({
            "subscriptions": [shapes.subscription(s) for s in subscriptions],
            "payments": [shapes.payment(p, portal=True) for p in payments],
            "bkash_enabled": bkash.enabled(),
            "offers": [shapes.offer(p, q) for p, q in quotes.offers(account)],
            "downgrades": [shapes.downgrade(s, p, v) for s, p, v in quotes.downgrades(account)],
        })


class CheckoutView(PortalView):
    def post(self, request, slug):
        data = _body(request)
        kind = billing.clean_kind(data.get("kind"))
        package = billing.find_package(data.get("package"))
        if not bkash.enabled():
            raise ServiceError(
                "bkash_unavailable", "Paying with bKash is not available now. Contact BdREN to pay.", status=503,
            )
        ip = client_ip(request)
        with services.managing(request.user, slug) as org:
            payment = billing.open_checkout(org, request.user, package, kind, ip_address=ip)
        redirect_url = billing.send_to_bkash(payment, actor=request.user, ip_address=ip)
        return JsonResponse(
            {"payment": shapes.payment(billing.load_payment(payment.pk), portal=True), "redirect_url": redirect_url},
            status=201,
        )


class DowngradeView(PortalView):
    def post(self, request, slug):
        package = billing.find_package(_body(request).get("package"))
        with services.managing(request.user, slug) as org:
            pk = billing.schedule_downgrade(org, request.user, package, ip_address=client_ip(request))
        return JsonResponse(_subscription_body(pk))

    def delete(self, request, slug):
        data = request.data if isinstance(request.data, dict) else {}
        subscription_id = _optional_uuid(
            data.get("subscription") or request.GET.get("subscription"), "subscription",
        )
        with services.managing(request.user, slug) as org:
            pk = billing.cancel_downgrade(
                org, request.user, subscription_id=subscription_id, ip_address=client_ip(request),
            )
        return JsonResponse(_subscription_body(pk))


class ReceiptView(PortalView):
    def get(self, request, slug, pk):
        account = billing.organization_account(self.organization)
        return receipt_response(billing.receipt(pk, account=account))


class AttachmentView(PortalView):
    def get(self, request, slug, pk):
        account = billing.organization_account(self.organization)
        return attachment_response(*billing.attachment(pk, account=account))
