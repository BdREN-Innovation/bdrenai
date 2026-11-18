import logging
import secrets
import time
from urllib.parse import urlparse

from django.conf import settings
from django.contrib.auth import login, logout
from django.http import HttpResponse, HttpResponseRedirect, JsonResponse
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework.permissions import AllowAny
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.accounts.services import resolve_authorized_account
from apps.audit.services import client_ip
from apps.organizations.services import confirm_signup_institution

from . import oidc, profile, signup, zitadel
from .models import ExternalIdentity, User
from .services import AccountLinkingError, UserNotAllowed, link_external_identity, provision_user

log = logging.getLogger(__name__)
SESSION_KEY = "oidc_flow"
SESSION_LINK_KEY = "oidc_link_flow"
SESSION_SIGNUP_KEY = "signup_flow"
FLOW_TTL = 600
SIGNUP_TTL = 3600


def safe_next(value):
    """Allow only same-site relative paths or exact allow-listed origins (no open redirect)."""
    if not value:
        return "/"
    if value.startswith("/") and not value.startswith("//") and "\\" not in value:
        return value
    p = urlparse(value)
    origin = f"{p.scheme}://{p.netloc}"
    return value if origin in settings.OIDC["ALLOWED_REDIRECT_ORIGINS"] else "/"


def safe_login_hint(value):
    """A username or email typed on the website; anything odd is dropped rather than sent to the IdP."""
    hint = (value or "").strip()
    if not hint or len(hint) > 254 or not hint.isprintable() or any(c.isspace() for c in hint):
        return None
    return hint


class _Public(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"


@method_decorator(ensure_csrf_cookie, name="dispatch")
class CsrfView(_Public):
    """Sets the `csrftoken` cookie for single-page apps before their first unsafe request."""

    throttle_classes = []

    def get(self, request):
        return JsonResponse({"ok": True})


class LoginView(_Public):
    def get(self, request):
        extra = {}
        org_id = request.GET.get("org_id")
        if org_id and org_id.isdigit():
            # Optional ZITADEL organization scope for institutional login routing
            extra["scope"] = f"{settings.OIDC['SCOPES']} urn:zitadel:iam:org:id:{org_id}"
        hint = safe_login_hint(request.GET.get("login_hint"))
        if hint:
            # Lets ZITADEL skip its username step (and route university domains to their IdP)
            extra["login_hint"] = hint
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
    """Landing target of ZITADEL's post-logout redirect: send the browser back to the portal."""

    def get(self, request):
        return HttpResponseRedirect("/")


@method_decorator(ensure_csrf_cookie, name="dispatch")
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


class InstitutionsView(_Public):
    """Institutions a new member can ask to join (active organizations)."""

    def get(self, request):
        items = [{"id": str(o["id"]), "name": o["name"]} for o in signup.active_institutions()]
        return JsonResponse({"institutions": items, "signup_enabled": zitadel.enabled()})


class RegisterView(_Public):
    def post(self, request):
        if not zitadel.enabled():
            return JsonResponse({"error": "signup_unavailable"}, status=503)
        try:
            user, zid = signup.register(request.data, ip_address=client_ip(request))
        except signup.SignupInvalid as e:
            return JsonResponse({"error": "invalid", "fields": e.fields}, status=400)
        except zitadel.ZitadelError as e:
            log.warning("sign-up failed: %s", e)
            if e.code == "email_taken":
                return JsonResponse(
                    {"error": "email_taken", "fields": {"email": "An account with this email already exists."}},
                    status=409,
                )
            if e.code == "weak_password":
                return JsonResponse(
                    {"error": "invalid", "fields": {"password": "This password is not allowed. Choose another."}},
                    status=400,
                )
            return JsonResponse({"error": "signup_failed"}, status=502)
        request.session[SESSION_SIGNUP_KEY] = {"zid": zid, "user": str(user.id), "email": user.email, "ts": int(time.time())}
        return JsonResponse({"status": "verification_sent", "email": user.email}, status=201)


def _signup_flow(request):
    flow = request.session.get(SESSION_SIGNUP_KEY)
    if not flow or time.time() - flow["ts"] > SIGNUP_TTL:
        return None
    return flow


class RegisterVerifyView(_Public):
    def post(self, request):
        flow = _signup_flow(request)
        if flow is None:
            return JsonResponse({"error": "no_signup"}, status=400)
        code = request.data.get("code")
        if not signup.valid_code(code):
            return JsonResponse({"error": "invalid", "fields": {"code": "Enter the code from the email."}}, status=400)
        try:
            zitadel.verify_email(flow["zid"], code.strip())
        except zitadel.ZitadelError as e:
            log.warning("email verification failed: %s", e)
            if e.code in ("invalid_code", "idp_error"):
                return JsonResponse({"error": "invalid", "fields": {"code": "That code is wrong or has expired."}}, status=400)
            return JsonResponse({"error": "verify_failed"}, status=502)
        User.objects.filter(id=flow["user"]).update(email_verified=True)
        user = User.objects.filter(id=flow["user"]).first()
        if user is not None:
            confirm_signup_institution(user, ip_address=client_ip(request))
        request.session.pop(SESSION_SIGNUP_KEY, None)
        return JsonResponse({"status": "verified", "email": flow["email"]})


class RegisterResendView(_Public):
    def post(self, request):
        flow = _signup_flow(request)
        if flow is None:
            return JsonResponse({"error": "no_signup"}, status=400)
        try:
            zitadel.resend_email_code(flow["zid"])
        except zitadel.ZitadelError as e:
            log.warning("resend failed: %s", e)
            return JsonResponse({"error": "resend_failed"}, status=502)
        return JsonResponse({"status": "sent"})


@method_decorator(ensure_csrf_cookie, name="dispatch")
class ProfileView(APIView):
    def get(self, request):
        return JsonResponse(profile.serialize(request.user))

    def patch(self, request):
        if not zitadel.enabled():
            return JsonResponse({"error": "profile_editing_unavailable"}, status=503)
        try:
            user = profile.update(request.user, request.data)
        except profile.ProfileInvalid as e:
            return JsonResponse({"error": "invalid", "fields": e.fields}, status=400)
        except zitadel.ZitadelError as e:
            log.warning("profile update failed: %s", e)
            return JsonResponse({"error": "update_failed"}, status=502)
        return JsonResponse(profile.serialize(user))


class AvatarView(APIView):
    def get(self, request):
        u = request.user
        if not u.avatar:
            return JsonResponse({"error": "no_avatar"}, status=404)
        resp = HttpResponse(bytes(u.avatar), content_type=u.avatar_type)
        resp["Cache-Control"] = "private, max-age=86400"
        resp["Content-Disposition"] = "inline"
        return resp

    def post(self, request):
        try:
            user = profile.set_avatar(request.user, request.FILES.get("avatar"))
        except profile.ProfileInvalid as e:
            return JsonResponse({"error": "invalid", "fields": e.fields}, status=400)
        return JsonResponse({"avatar_url": profile.avatar_url(user)})

    def delete(self, request):
        profile.remove_avatar(request.user)
        return JsonResponse({"avatar_url": None})


class BillingView(APIView):
    def get(self, request):
        return JsonResponse(profile.billing(request.user))
