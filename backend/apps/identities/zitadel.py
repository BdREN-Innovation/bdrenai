"""Minimal ZITADEL user-management client (API v2), authenticated with the sign-up service token."""
from urllib.parse import urlparse

import requests
from django.conf import settings


class ZitadelError(Exception):
    """A failed management call. `code` is a short machine reason safe to return to the website."""

    def __init__(self, code, status=None, detail=""):
        super().__init__(f"{code} ({status}): {detail[:200]}")
        self.code = code
        self.status = status


def enabled():
    return bool(settings.ZITADEL_SERVICE_TOKEN)


def _call(method, path, body=None):
    cfg = settings.OIDC
    url = cfg["ISSUER"].rstrip("/") + path
    headers = {"Authorization": f"Bearer {settings.ZITADEL_SERVICE_TOKEN}", "Content-Type": "application/json"}
    internal = cfg["INTERNAL_BASE_URL"]
    if internal:
        headers["Host"] = urlparse(cfg["ISSUER"]).netloc
        url = internal.rstrip("/") + path
    try:
        r = requests.request(method, url, json=body, headers=headers, timeout=cfg["HTTP_TIMEOUT"])
    except requests.RequestException as e:
        raise ZitadelError("idp_unavailable", detail=e.__class__.__name__) from e
    if r.status_code < 400:
        return r.json() if r.content else {}
    text = r.text
    if r.status_code == 409 or "AlreadyExists" in text or "ALREADY_EXISTS" in text:
        raise ZitadelError("email_taken", r.status_code, text)
    if "Password" in text and "Policy" in text:
        raise ZitadelError("weak_password", r.status_code, text)
    if "Code" in text and r.status_code in (400, 412):
        raise ZitadelError("invalid_code", r.status_code, text)
    raise ZitadelError("idp_error", r.status_code, text)


def create_human_user(*, first_name, last_name, email, password):
    """Creates the user with an unverified email; ZITADEL emails the verification code."""
    body = {
        "username": email,
        "profile": {"givenName": first_name, "familyName": last_name},
        "email": {"email": email, "sendCode": {}},
        "password": {"password": password, "changeRequired": False},
    }
    return _call("POST", "/v2/users/human", body)["userId"]


def update_profile(user_id, *, first_name, last_name):
    _call("PUT", f"/v2/users/human/{user_id}", {
        "profile": {"givenName": first_name, "familyName": last_name, "displayName": f"{first_name} {last_name}"},
    })


def verify_email(user_id, code):
    _call("POST", f"/v2/users/{user_id}/email/verify", {"verificationCode": code})


def resend_email_code(user_id):
    _call("POST", f"/v2/users/{user_id}/email/resend", {"sendCode": {}})


def find_user_id(email):
    """The ZITADEL user id whose email is `email`, or None."""
    body = {"queries": [{"emailQuery": {"emailAddress": email, "method": "TEXT_QUERY_METHOD_EQUALS_IGNORE_CASE"}}]}
    result = _call("POST", "/v2/users", body).get("result") or []
    return result[0]["userId"] if result else None


def create_verified_user(*, first_name, last_name, email, password):
    """A user with a verified email and a password that need not be changed: for local test accounts only."""
    body = {
        "username": email,
        "profile": {"givenName": first_name, "familyName": last_name},
        "email": {"email": email, "isVerified": True},
        "password": {"password": password, "changeRequired": False},
    }
    return _call("POST", "/v2/users/human", body)["userId"]


def set_password(user_id, password):
    _call("POST", f"/v2/users/{user_id}/password", {"newPassword": {"password": password, "changeRequired": False}})
