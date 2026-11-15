#!/usr/bin/env python3
"""Minimal independent SaaS demo application (represents Mindspear / Synapse).

Runs as a standalone HTTP server with its own isolated cookie session (`<app_name>_session`),
implementing OIDC Authorization Code + PKCE S256 against ZITADEL (`auth.bdren.ai`).
Does not share cookies with other apps or Django.
"""
import argparse
import base64
import hashlib
import http.cookies
import json
import os
import secrets
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer

import jwt

SESSIONS = {}  # sid -> {"user": claims, "id_token": str}
FLOWS = {}     # state -> {"verifier": str, "nonce": str, "ts": int}
JWKS_CACHE = {"keys": None, "ts": 0}


def make_handler(cfg):
    cookie_name = f"{cfg['name']}_sid"

    def idp_req(method, url, data=None, headers=None):
        headers = dict(headers or {})
        if cfg.get("internal_base") and url.startswith(cfg["issuer"]):
            headers["Host"] = urllib.parse.urlparse(cfg["issuer"]).netloc
            url = cfg["internal_base"].rstrip("/") + url[len(cfg["issuer"]):]
        body = urllib.parse.urlencode(data).encode() if isinstance(data, dict) else data
        req = urllib.request.Request(url, data=body, headers=headers, method=method)
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read().decode())

    def discovery():
        return idp_req("GET", cfg["issuer"].rstrip("/") + "/.well-known/openid-configuration")

    def signing_key(kid):
        now = time.time()
        if not JWKS_CACHE["keys"] or now - JWKS_CACHE["ts"] > 300:
            JWKS_CACHE["keys"] = idp_req("GET", discovery()["jwks_uri"])["keys"]
            JWKS_CACHE["ts"] = now
        for k in JWKS_CACHE["keys"]:
            if k.get("kid") == kid:
                return jwt.PyJWK.from_dict(k).key
        raise ValueError("Unknown kid")

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):
            pass

        def _session(self):
            raw = self.headers.get("Cookie", "")
            c = http.cookies.SimpleCookie(raw)
            if cookie_name in c and c[cookie_name].value in SESSIONS:
                return c[cookie_name].value, SESSIONS[c[cookie_name].value]
            return None, None

        def _json(self, code, payload, set_cookie=None):
            body = json.dumps(payload).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            if set_cookie:
                self.send_header("Set-Cookie", set_cookie)
            self.end_headers()
            self.wfile.write(body)

        def _redirect(self, loc, set_cookie=None):
            self.send_response(302)
            self.send_header("Location", loc)
            if set_cookie:
                self.send_header("Set-Cookie", set_cookie)
            self.end_headers()

        def do_GET(self):
            parsed = urllib.parse.urlparse(self.path)
            if parsed.path == "/health":
                return self._json(200, {"status": "ok", "app": cfg["name"]})

            if parsed.path == "/":
                _, sess = self._session()
                if not sess:
                    return self._redirect("/auth/login")
                return self._json(200, {
                    "app": cfg["name"],
                    "authenticated": True,
                    "sub": sess["user"]["sub"],
                    "iss": sess["user"]["iss"],
                    "email": sess["user"].get("email"),
                })

            if parsed.path == "/auth/login":
                verifier = secrets.token_urlsafe(48)
                challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
                state = secrets.token_urlsafe(24)
                nonce = secrets.token_urlsafe(24)
                FLOWS[state] = {"verifier": verifier, "nonce": nonce, "ts": time.time()}
                q = urllib.parse.urlencode({
                    "response_type": "code",
                    "client_id": cfg["client_id"],
                    "redirect_uri": cfg["redirect_uri"],
                    "scope": "openid profile email",
                    "state": state,
                    "nonce": nonce,
                    "code_challenge": challenge,
                    "code_challenge_method": "S256",
                })
                return self._redirect(discovery()["authorization_endpoint"] + "?" + q)

            if parsed.path == "/auth/callback":
                qs = urllib.parse.parse_qs(parsed.query)
                state = qs.get("state", [""])[0]
                code = qs.get("code", [""])[0]
                flow = FLOWS.pop(state, None)
                if not flow or not code or time.time() - flow["ts"] > 600:
                    return self._json(400, {"error": "invalid_state_or_code"})
                basic = base64.b64encode(f"{cfg['client_id']}:{cfg['client_secret']}".encode()).decode()
                tok = idp_req(
                    "POST",
                    discovery()["token_endpoint"],
                    data={
                        "grant_type": "authorization_code",
                        "code": code,
                        "redirect_uri": cfg["redirect_uri"],
                        "code_verifier": flow["verifier"],
                    },
                    headers={
                        "Authorization": f"Basic {basic}",
                        "Content-Type": "application/x-www-form-urlencoded",
                    },
                )
                id_token = tok["id_token"]
                hdr = jwt.get_unverified_header(id_token)
                claims = jwt.decode(
                    id_token,
                    signing_key(hdr["kid"]),
                    algorithms=["RS256"],
                    audience=cfg["client_id"],
                    issuer=cfg["issuer"],
                    leeway=30,
                )
                if not secrets.compare_digest(claims.get("nonce", ""), flow["nonce"]):
                    return self._json(401, {"error": "nonce_mismatch"})
                sid = secrets.token_urlsafe(32)
                SESSIONS[sid] = {"user": claims, "id_token": id_token}
                cookie = f"{cookie_name}={sid}; Path=/; HttpOnly; SameSite=Lax"
                return self._redirect("/", set_cookie=cookie)

            return self._json(404, {"error": "not_found"})

    return Handler


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", required=True)
    ap.add_argument("--port", type=int, required=True)
    ap.add_argument("--issuer", required=True)
    ap.add_argument("--internal-base", default="")
    ap.add_argument("--client-id", required=True)
    ap.add_argument("--client-secret", required=True)
    ap.add_argument("--redirect-uri", required=True)
    args = ap.parse_args()
    srv = HTTPServer(("127.0.0.1", args.port), make_handler(vars(args)))
    srv.serve_forever()


if __name__ == "__main__":
    main()
