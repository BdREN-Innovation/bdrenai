#!/usr/bin/env python3
"""Provision an institutional Organization + upstream OIDC or SAML 2.0 IdP in ZITADEL v4.

Example (OIDC university):
  scripts/configure_institutional_idp.py --issuer http://auth.bdren.localhost:8080 \
    --connect http://127.0.0.1:8080 --pat-file - \
    --org-name "University of Dhaka" --protocol oidc \
    --idp-name "DU OIDC" --oidc-issuer https://idp.du.ac.bd \
    --oidc-client-id bdren-client --oidc-client-secret SECRET

Example (SAML 2.0 / Shibboleth university):
  scripts/configure_institutional_idp.py --issuer http://auth.bdren.localhost:8080 \
    --connect http://127.0.0.1:8080 --pat-file - \
    --org-name "BUET" --protocol saml \
    --idp-name "BUET Shibboleth" --saml-metadata-file deploy/zitadel/sample_univ_saml_metadata.xml
"""
import argparse
import base64
import json
import sys
import urllib.error
import urllib.parse
import urllib.request


def call(base, pat, method, path, body=None, host=None, org_id=None):
    req = urllib.request.Request(
        base.rstrip("/") + path,
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
    )
    req.add_header("Authorization", "Bearer " + pat)
    req.add_header("Content-Type", "application/json")
    if host:
        req.add_header("Host", host)
    if org_id:
        req.add_header("x-zitadel-orgid", org_id)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        raise SystemExit(f"{method} {path} -> {e.code}: {e.read().decode()[:400]}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--issuer", required=True)
    ap.add_argument("--connect", default="")
    ap.add_argument("--pat-file", required=True)
    ap.add_argument("--org-name", required=True)
    ap.add_argument("--protocol", choices=["oidc", "saml"], required=True)
    ap.add_argument("--idp-name", required=True)
    ap.add_argument("--oidc-issuer", default="")
    ap.add_argument("--oidc-client-id", default="")
    ap.add_argument("--oidc-client-secret", default="")
    ap.add_argument("--saml-metadata-file", default="")
    a = ap.parse_args()

    pat = (sys.stdin.read() if a.pat_file == "-" else open(a.pat_file).read()).strip()
    base = a.connect or a.issuer
    host = urllib.parse.urlparse(a.issuer).netloc if a.connect else None

    # 1. Find or create ZITADEL Organization
    orgs = call(base, pat, "POST", "/v2/organizations/_search", {
        "queries": [{"nameQuery": {"name": a.org_name, "method": "TEXT_QUERY_METHOD_EQUALS"}}]
    }, host).get("result", [])
    if orgs:
        org_id = orgs[0]["id"]
    else:
        org_id = call(base, pat, "POST", "/v2/organizations", {"name": a.org_name}, host)["organizationId"]

    # 2. Create OIDC or SAML IdP template in the organization
    # Note: autoLinking is disabled (IDP_AUTO_LINKING_OPTION_UNSPECIFIED) to prevent unsafe email auto-linking.
    provider_cfg = {
        "options": {
            "isLinkingAllowed": True,
            "isCreationAllowed": True,
            "isAutoCreation": False,
            "isAutoUpdate": True,
            "autoLinking": "AUTO_LINKING_OPTION_UNSPECIFIED",
        }
    }
    if a.protocol == "oidc":
        res = call(base, pat, "POST", "/management/v1/idps/oidc", {
            "name": a.idp_name,
            "issuer": a.oidc_issuer,
            "clientId": a.oidc_client_id,
            "clientSecret": a.oidc_client_secret,
            "scopes": ["openid", "profile", "email"],
            **provider_cfg,
        }, host, org_id=org_id)
    else:
        xml_b64 = base64.b64encode(open(a.saml_metadata_file, "rb").read()).decode()
        res = call(base, pat, "POST", "/management/v1/idps/saml", {
            "name": a.idp_name,
            "metadataXml": xml_b64,
            **provider_cfg,
        }, host, org_id=org_id)

    print(json.dumps({"zitadel_organization_id": org_id, "zitadel_idp_id": (res.get("id") or res.get("idpId") or (res.get("idp") or {}).get("id")), "protocol": a.protocol}))


if __name__ == "__main__":
    main()
