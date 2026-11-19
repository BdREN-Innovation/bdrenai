"""Public bKash callback (`GET /api/v1/payments/bkash/callback/`): bKash sends the payer's browser here."""
from urllib.parse import urlencode

from django.conf import settings
from django.http import HttpResponse, HttpResponseRedirect
from rest_framework.permissions import AllowAny
from rest_framework.throttling import SimpleRateThrottle
from rest_framework.views import APIView

from . import services

OUTCOMES = frozenset({"success", "failure", "cancel"})


def attachment_response(content, content_type, name):
    response = HttpResponse(content, content_type=content_type)
    response["Content-Disposition"] = f'attachment; filename="{name}"'
    response["X-Content-Type-Options"] = "nosniff"
    response["Cache-Control"] = "private, no-store"
    return response


def receipt_response(html):
    response = HttpResponse(html, content_type="text/html; charset=utf-8")
    response["Cache-Control"] = "private, no-store"
    response["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'"
    return response


class BkashCallbackThrottle(SimpleRateThrottle):
    """`BKASH_CALLBACK_RATE` per client address."""

    scope = "bkash_callback"

    def get_rate(self):
        return settings.BKASH_CALLBACK_RATE

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}


def result_url(payment):
    org = payment.account.organization
    if org is None:
        return f"{settings.ADMIN_PUBLIC_URL}/"
    query = urlencode({"payment": str(payment.id), "result": services.callback_result(payment)})
    return f"{settings.ADMIN_PUBLIC_URL}/portal/{org.slug}/billing?{query}"


class BkashCallbackView(APIView):
    """Completes (only after our own execute/status says Completed), fails or cancels the payment, then sends the
    browser to the institution console's billing page. An unknown payment goes to the console's start page."""

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [BkashCallbackThrottle]

    def get(self, request):
        outcome = request.GET.get("status", "")
        payment = services.handle_callback(request.GET.get("paymentID", ""), outcome if outcome in OUTCOMES else "")
        if payment is None:
            return HttpResponseRedirect(f"{settings.ADMIN_PUBLIC_URL}/")
        return HttpResponseRedirect(result_url(payment))
