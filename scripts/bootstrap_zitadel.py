#!/usr/bin/env python3
"""Idempotently provision ZITADEL: project + OIDC clients (code + PKCE, exact redirect URIs).

Usage:
  scripts/bootstrap_zitadel.py --issuer http://auth.bdren.localhost:8080 \
      --pat-file <path or '-' for docker volume> --config deploy/zitadel/clients.json

Uses only the stdlib. Admin PAT is read from a file / stdin and never printed.
Outputs client IDs (public) to stdout; confidential client secrets go to --secrets-out (0600).
"""
import argparse, json, os, subprocess, sys, urllib.request, urllib.error, urllib.parse


def call(issuer, pat, method, path, body=None, host=None):
    url = issuer.rstrip("/") + path
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None)
    req.add_header("Authorization", "Bearer " + pat)
    req.add_header("Content-Type", "application/json")
    if host:
        req.add_header("Host", host)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        err_text = e.read().decode()
        if e.code == 400 and "COMMAND-1m88i" in err_text:
            return {}
        raise SystemExit(f"{method} {path} -> {e.code}: {err_text[:400]}")


SIGNUP_USER = "bdren-signup"


def ensure_signup_service_user(c, secrets):
    """Machine user the website backend uses to create accounts (ORG_USER_MANAGER only).
    Its PAT goes to the secrets file as ZITADEL_SERVICE_TOKEN; it is never printed."""
    found = c("POST", "/management/v1/users/_search", {
        "queries": [{"userNameQuery": {"userName": SIGNUP_USER, "method": "TEXT_QUERY_METHOD_EQUALS"}}],
    }).get("result", [])
    uid = found[0]["id"] if found else c("POST", "/management/v1/users/machine", {
        "userName": SIGNUP_USER,
        "name": "BdREN website sign-up",
        "description": "Creates accounts from the website sign-up form",
        "accessTokenType": "ACCESS_TOKEN_TYPE_BEARER",
    })["userId"]
    try:
        c("POST", "/management/v1/orgs/me/members", {"userId": uid, "roles": ["ORG_USER_MANAGER"]})
    except SystemExit as e:
        if "409" not in str(e) and "AlreadyExists" not in str(e):
            raise
    if secrets.get(SIGNUP_USER, {}).get("token"):
        print(f"service user {SIGNUP_USER}: exists, token kept")
        return
    token = c("POST", f"/management/v1/users/{uid}/pats", {"expirationDate": "2099-01-01T00:00:00Z"})["token"]
    secrets[SIGNUP_USER] = {"user_id": uid, "token": token}
    print(f"service user {SIGNUP_USER}: token written to secrets (set it as ZITADEL_SERVICE_TOKEN)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--issuer", required=True)
    ap.add_argument("--connect", help="actual URL to connect to if different from issuer (Host header = issuer host)")
    ap.add_argument("--pat-file", required=True)
    ap.add_argument("--config", default="deploy/zitadel/clients.json")
    ap.add_argument("--secrets-out", default=".zitadel-secrets.json")
    a = ap.parse_args()

    pat = (sys.stdin.read() if a.pat_file == "-" else open(a.pat_file).read()).strip()
    cfg = json.load(open(a.config))
    base = a.connect or a.issuer
    host = urllib.parse.urlparse(a.issuer).netloc if a.connect else None
    c = lambda m, p, b=None: call(base, pat, m, p, b, host)

    # Project (roles are NOT used for business entitlements; those live in Django)
    pname = cfg["project"]["name"]
    found = c("POST", "/management/v1/projects/_search",
              {"queries": [{"nameQuery": {"name": pname, "method": "TEXT_QUERY_METHOD_EQUALS"}}]}).get("result", [])
    if found:
        pid = found[0]["id"]
    else:
        pid = c("POST", "/management/v1/projects", {
            "name": pname, "projectRoleAssertion": False, "projectRoleCheck": False, "hasProjectCheck": False,
        })["id"]
    print(f"project {pname}: {pid}")

    existing = {x["name"]: x for x in c("POST", f"/management/v1/projects/{pid}/apps/_search", {}).get("result", [])}
    secrets = json.load(open(a.secrets_out)) if os.path.exists(a.secrets_out) else {}
    for app in cfg["clients"]:
        for uri in app["redirect_uris"] + app.get("post_logout_redirect_uris", []):
            if "*" in uri:
                raise SystemExit(f"wildcard URI refused: {uri}")
        body = {
            "name": app["name"],
            "redirectUris": app["redirect_uris"],
            "postLogoutRedirectUris": app.get("post_logout_redirect_uris", []),
            "responseTypes": ["OIDC_RESPONSE_TYPE_CODE"],
            "grantTypes": ["OIDC_GRANT_TYPE_AUTHORIZATION_CODE", "OIDC_GRANT_TYPE_REFRESH_TOKEN"],
            "appType": "OIDC_APP_TYPE_WEB",
            # confidential BFF client: secret + PKCE. ("BASIC" = client_secret_basic)
            "authMethodType": "OIDC_AUTH_METHOD_TYPE_BASIC",
            "version": "OIDC_VERSION_1_0",
            "devMode": app.get("dev_mode", False),  # allows http redirect URIs in dev only
            "accessTokenType": "OIDC_TOKEN_TYPE_JWT",
            "idTokenRoleAssertion": False, "idTokenUserinfoAssertion": True,
            "clockSkew": "1s",
        }
        if app["name"] in existing:
            ex = existing[app["name"]]
            c("PUT", f"/management/v1/projects/{pid}/apps/{ex['id']}/oidc_config", body)
            cid = ex["oidcConfig"]["clientId"]
            print(f"client {app['name']}: updated, client_id={cid}")
        else:
            r = c("POST", f"/management/v1/projects/{pid}/apps/oidc", body)
            cid = r["clientId"]
            secrets[app["name"]] = {"client_id": cid, "client_secret": r.get("clientSecret")}
            print(f"client {app['name']}: created, client_id={cid}")
    ensure_signup_service_user(c, secrets)
    fd = os.open(a.secrets_out, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(secrets, f, indent=2)
    print(f"secrets written to {a.secrets_out} (0600, gitignored)")


if __name__ == "__main__":
    main()
