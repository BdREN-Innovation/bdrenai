"""Reusable, framework-light OIDC relying-party logic (Authorization Code + PKCE S256).

No custom crypto: signatures are verified by PyJWT against the issuer's JWKS.
Validates issuer, audience, signature, expiry, nonce (and state/PKCE at the call site).
Copy this module + `services`-style provisioning to integrate other Python backends.
"""
import base64
import hashlib
import secrets
import time
from urllib.parse import urlencode, urlparse

import jwt
import requests
from django.conf import settings
from django.core.cache import cache

DISCOVERY_TTL = 3600
JWKS_TTL = 3600


class OIDCError(Exception):
    """Any failure to authenticate; message is safe to log, never to show verbatim to users."""


def _cfg():
    return settings.OIDC


def request_json(method, url, **kw):
    """HTTP helper (patched in tests). Routes via INTERNAL_BASE_URL with the public Host header if configured."""
    cfg = _cfg()
    headers = kw.pop("headers", {}) or {}
    internal = cfg["INTERNAL_BASE_URL"]
    if internal and url.startswith(cfg["ISSUER"]):
        headers["Host"] = urlparse(cfg["ISSUER"]).netloc
        url = internal.rstrip("/") + url[len(cfg["ISSUER"]):]
    try:
        r = requests.request(method, url, headers=headers, timeout=cfg["HTTP_TIMEOUT"], **kw)
    except requests.RequestException as e:
        raise OIDCError(f"HTTP error contacting identity provider: {e.__class__.__name__}") from e
    if r.status_code >= 400:
        raise OIDCError(f"Identity provider returned {r.status_code} for {urlparse(url).path}")
    try:
        return r.json()
    except ValueError as e:
        raise OIDCError("Identity provider returned non-JSON") from e


def discovery():
    cfg = _cfg()
    key = f"oidc:discovery:{cfg['ISSUER']}"
    doc = cache.get(key)
    if doc is None:
        doc = request_json("GET", cfg["ISSUER"].rstrip("/") + "/.well-known/openid-configuration")
        if doc.get("issuer") != cfg["ISSUER"]:
            raise OIDCError("Discovery issuer mismatch")
        cache.set(key, doc, DISCOVERY_TTL)
    return doc


def _jwks(force=False):
    key = f"oidc:jwks:{_cfg()['ISSUER']}"
    data = None if force else cache.get(key)
    if data is None:
        data = request_json("GET", discovery()["jwks_uri"])
        cache.set(key, data, JWKS_TTL)
    return data


def _signing_key(kid):
    """Find key by kid; refetch JWKS once if unknown (supports key rotation)."""
    for force in (False, True):
        for k in _jwks(force).get("keys", []):
            if k.get("kid") == kid and k.get("use", "sig") == "sig":
                return jwt.PyJWK.from_dict(k).key
    raise OIDCError("Unknown signing key")


def pkce_pair():
    verifier = secrets.token_urlsafe(64)  # 86 chars, within RFC 7636 43..128
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    return verifier, challenge


def start_authorization(extra=None):
    """Returns (url, state_blob). Store state_blob server-side (session); never in the URL."""
    cfg = _cfg()
    verifier, challenge = pkce_pair()
    state, nonce = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
    params = {
        "response_type": "code", "client_id": cfg["CLIENT_ID"], "redirect_uri": cfg["REDIRECT_URI"],
        "scope": cfg["SCOPES"], "state": state, "nonce": nonce,
        "code_challenge": challenge, "code_challenge_method": "S256",
    }
    params.update(extra or {})
    url = discovery()["authorization_endpoint"] + "?" + urlencode(params)
    return url, {"state": state, "nonce": nonce, "verifier": verifier, "ts": int(time.time())}


def exchange_code(code, verifier):
    cfg = _cfg()
    data = {"grant_type": "authorization_code", "code": code, "redirect_uri": cfg["REDIRECT_URI"], "code_verifier": verifier}
    auth = {}
    if cfg["CLIENT_SECRET"]:
        # client_secret_basic
        cred = base64.b64encode(f"{cfg['CLIENT_ID']}:{cfg['CLIENT_SECRET']}".encode()).decode()
        auth = {"Authorization": f"Basic {cred}"}
    else:
        data["client_id"] = cfg["CLIENT_ID"]
    return request_json("POST", discovery()["token_endpoint"], data=data, headers=auth)


def validate_id_token(id_token, nonce):
    cfg = _cfg()
    try:
        header = jwt.get_unverified_header(id_token)
    except jwt.PyJWTError as e:
        raise OIDCError("Malformed id_token") from e
    if header.get("alg") not in cfg["ALGORITHMS"]:
        raise OIDCError("Disallowed id_token algorithm")
    key = _signing_key(header.get("kid"))
    try:
        claims = jwt.decode(
            id_token, key, algorithms=cfg["ALGORITHMS"], audience=cfg["CLIENT_ID"], issuer=cfg["ISSUER"],
            leeway=cfg["CLOCK_SKEW_SECONDS"], options={"require": ["exp", "iat", "iss", "aud", "sub"]},
        )
    except jwt.PyJWTError as e:
        raise OIDCError(f"Invalid id_token: {e.__class__.__name__}") from e
    if not secrets.compare_digest(str(claims.get("nonce", "")), str(nonce)):
        raise OIDCError("Nonce mismatch")
    aud = claims["aud"]
    if isinstance(aud, list) and len(aud) > 1 and claims.get("azp") != cfg["CLIENT_ID"]:
        raise OIDCError("azp mismatch")
    if not claims["sub"]:
        raise OIDCError("Empty subject")
    return claims


def end_session_url(id_token_hint):
    cfg = _cfg()
    ep = discovery().get("end_session_endpoint")
    if not ep:
        return None
    q = {"post_logout_redirect_uri": cfg["POST_LOGOUT_REDIRECT_URI"], "client_id": cfg["CLIENT_ID"]}
    if id_token_hint:
        q["id_token_hint"] = id_token_hint
    return ep + "?" + urlencode(q)
