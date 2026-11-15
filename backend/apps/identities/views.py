import logging
import secrets
import time
from urllib.parse import urlparse

from django.conf import settings
from django.contrib.auth import login, logout
from django.http import HttpResponseRedirect, JsonResponse
from rest_framework.permissions import AllowAny
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.accounts.services import resolve_authorized_account

from . import oidc
from .models import ExternalIdentity
from .services import AccountLinkingError, UserNotAllowed, link_external_identity, provision_user

log = logging.getLogger(__name__)
SESSION_KEY = "oidc_flow"
SESSION_LINK_KEY = "oidc_link_flow"
FLOW_TTL = 600


def safe_next(value):
    """Allow only same-site relative paths or exact allow-listed origins (no open redirect)."""
    if not value:
        return "/"
    if value.startswith("/") and not value.startswith("//") and "\\" not in value:
        return value
    p = urlparse(value)
    origin = f"{p.scheme}://{p.netloc}"
    return value if origin in settings.OIDC["ALLOWED_REDIRECT_ORIGINS"] else "/"


class _Public(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"


class LoginView(_Public):
    def get(self, request):
        extra = {}
        org_id = request.GET.get("org_id")
        if org_id and org_id.isdigit():
            # Optional ZITADEL organization scope for institutional login routing
            extra["scope"] = f"{settings.OIDC['SCOPES']} urn:zitadel:iam:org:id:{org_id}"
        try:
            url, blob = oidc.start_authorization(extra=extra or None)
        except oidc.OIDCError:
            log.exception("oidc start failed")
            return JsonResponse({"error": "identity_provider_unavailable"}, status=502)
        blob["next"] = safe_next(request.GET.get("next"))
        request.session[SESSION_KEY] = blob
        return HttpResponseRedirect(url)


class CallbackView(_Public):
    def get(self, request):
        flow = request.session.pop(SESSION_KEY, None)  # single use
        if not flow or time.time() - flow["ts"] > FLOW_TTL:
            return JsonResponse({"error": "invalid_or_expired_login"}, status=400)
        if "error" in request.GET:
            log.warning("idp returned error=%s", request.GET.get("error"))
            return JsonResponse({"error": "login_failed"}, status=400)
        state, code = request.GET.get("state", ""), request.GET.get("code", "")
        if not code or not secrets.compare_digest(state, flow["state"]):
            return JsonResponse({"error": "invalid_state"}, status=400)
        try:
            tokens = oidc.exchange_code(code, flow["verifier"])
            claims = oidc.validate_id_token(tokens.get("id_token", ""), flow["nonce"])
            user = provision_user(claims)
        except UserNotAllowed:
            return JsonResponse({"error": "account_disabled"}, status=403)
        except oidc.OIDCError:
            log.exception("oidc callback failed")
            return JsonResponse({"error": "login_failed"}, status=401)
        login(request, user, backend="django.contrib.auth.backends.ModelBackend")  # rotates session key
        request.session["oidc_id_token"] = tokens["id_token"]
        return HttpResponseRedirect(flow["next"])


class LinkStartView(APIView):
    """Initiates an explicit, verified account-linking OIDC flow for an already authenticated user."""

    def post(self, request):
        provider_type = request.data.get("provider_type", ExternalIdentity.ProviderType.OIDC)
        if provider_type not in ExternalIdentity.ProviderType.values:
            return JsonResponse({"error": "invalid_provider_type"}, status=400)
        try:
            url, blob = oidc.start_authorization(extra={"prompt": "login"})
        except oidc.OIDCError:
            return JsonResponse({"error": "identity_provider_unavailable"}, status=502)
        blob["user_id"] = str(request.user.id)
        blob["provider_type"] = provider_type
        request.session[SESSION_LINK_KEY] = blob
        return JsonResponse({"authorization_url": url})


class LinkCallbackView(APIView):
    """Completes explicit account linking after validating state, PKCE, and id_token."""

    def get(self, request):
        flow = request.session.pop(SESSION_LINK_KEY, None)
        if not flow or time.time() - flow["ts"] > FLOW_TTL:
            return JsonResponse({"error": "invalid_or_expired_link_flow"}, status=400)
        if str(request.user.id) != flow.get("user_id"):
            return JsonResponse({"error": "user_mismatch"}, status=403)
        state, code = request.GET.get("state", ""), request.GET.get("code", "")
        if not code or not secrets.compare_digest(state, flow["state"]):
            return JsonResponse({"error": "invalid_state"}, status=400)
        try:
            tokens = oidc.exchange_code(code, flow["verifier"])
            claims = oidc.validate_id_token(tokens.get("id_token", ""), flow["nonce"])
            ext = link_external_identity(
                user=request.user,
                claims=claims,
                provider_type=flow.get("provider_type", ExternalIdentity.ProviderType.OIDC),
            )
        except AccountLinkingError as e:
            return JsonResponse({"error": "account_linking_denied", "detail": str(e)}, status=409)
        except UserNotAllowed:
            return JsonResponse({"error": "institutional_account_disabled"}, status=403)
        except oidc.OIDCError:
            return JsonResponse({"error": "link_validation_failed"}, status=401)
        return JsonResponse({
            "linked": True,
            "external_identity_id": str(ext.id),
            "issuer": ext.issuer,
            "subject": ext.subject,
            "provider_type": ext.provider_type,
        })


class LogoutView(APIView):
    """POST (CSRF-protected). Ends the local session; returns the IdP end-session URL for SSO logout."""

    def post(self, request):
        hint = request.session.get("oidc_id_token")
        logout(request)
        try:
            url = oidc.end_session_url(hint)
        except oidc.OIDCError:
            url = None
        return JsonResponse({"redirect": url})


class LoggedOutView(_Public):
    def get(self, request):
        return JsonResponse({"status": "logged_out"})


class MeView(APIView):
    def get(self, request):
        u = request.user
        active_acct = resolve_authorized_account(u, session=request.session)
        return JsonResponse({
            "id": str(u.id),
            "email": u.email,
            "email_verified": u.email_verified,
            "name": u.name,
            "active_account_id": str(active_acct.id),
            "accounts": [{"id": str(a.id), "type": a.account_type} for a in u.accounts.all()],
            "memberships": [
                {
                    "organization_id": str(m.organization_id),
                    "organization_slug": m.organization.slug,
                    "role": m.role,
                    "status": m.status,
                }
                for m in u.memberships.select_related("organization").all()
            ],
            "external_identities": [
                {"id": str(e.id), "issuer": e.issuer, "subject": e.subject, "provider_type": e.provider_type}
                for e in u.external_identities.all()
            ],
        })
