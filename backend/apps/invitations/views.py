"""Public invitation endpoints used by the website's /invite/<token> page."""
from django.http import JsonResponse
from rest_framework.permissions import AllowAny
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.audit.services import client_ip

from . import services
from .errors import ContractErrors

NOT_FOUND = {"error": "not_found", "message": "This invitation link is not valid."}
NOT_SIGNED_IN = {"error": "not_authenticated", "message": "Sign in to accept this invitation."}


class _Throttled(ContractErrors, APIView):
    permission_classes = [AllowAny]  # anonymous callers get 401 (not DRF's 403) so the page can offer sign-in
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "invitations"


class InvitationPreviewView(_Throttled):
    def get(self, request, token):
        preview = services.preview_invitation(token, request.user)
        if preview is None:
            return JsonResponse(NOT_FOUND, status=404)
        return JsonResponse(preview)


class InvitationAcceptView(_Throttled):
    def post(self, request, token):
        if not request.user.is_authenticated:
            return JsonResponse(NOT_SIGNED_IN, status=401)
        result = services.accept_invitation(token, user=request.user, ip_address=client_ip(request))
        return JsonResponse(result)
