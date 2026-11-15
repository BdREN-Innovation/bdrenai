# Institutional SAML 2.0 & OIDC Federation Guide (BDREN)

BDREN uses **ZITADEL v4** (`auth.bdren.ai`) as the central identity broker. Downstream SaaS applications
(`mindspear.app`, `synapse.ai`, etc.) speak **only OIDC** to `auth.bdren.ai` regardless of whether a university uses
SAML 2.0, Shibboleth, or OIDC.

## 1. Upstream Protocol Support in ZITADEL v4 (Community / Self-Hosted)
Verified against ZITADEL v4 Management & Admin v2 APIs:
- **Generic OIDC Identity Provider**: Supported (`POST /v2/idps/generic_oidc` or org-level `/management/v1/idps/oidc`).
- **SAML 2.0 Identity Provider**: Supported (`POST /v2/idps/saml` or org-level `/management/v1/idps/saml`) using either
  raw SAML metadata XML or a metadata URL.
- **Organization-scoped Login Policy**: Each institution is provisioned as a ZITADEL Organization (`zitadel_organization_id`)
  with its own Login Policy (`allowExternalIdp: true`) and restricted to that institution's IdP(s).

## 2. Important Verification: eduGAIN & Shibboleth Federation
- ZITADEL v4 natively consumes **single-entity** SAML 2.0 `EntityDescriptor` metadata XML/URLs.
- **Limitation identified**: ZITADEL v4 does **not** natively parse multi-entity `EntitiesDescriptor` federation
  aggregates (such as the full eduGAIN metadata feed), perform MDQ (Metadata Query Protocol), or enforce SAML Entity
  Categories (`http://refeds.org/category/research-and-scholarship`) on its own.
- **Self-hosted architecture for eduGAIN / BdREN Federation**:
  1. For individual universities (University A SAML, University B OIDC, University C Shibboleth IdP), register each
     university's individual IdP metadata URL or OIDC issuer directly in its ZITADEL Organization using
     `scripts/configure_institutional_idp.py`.
  2. For full eduGAIN / multi-IdP discovery, run a self-hosted SAML-to-OIDC proxy (such as **SimpleSAMLphp** or
     **osa/SATOSA** with `pyFF` for MDQ) on an internal container and register it as an upstream IdP in ZITADEL.

## 3. Mapping & Security Rules in Django
- Each institutional `Organization` in Django stores `zitadel_organization_id` and has an `Account(account_type="organization")`.
- Upstream IdPs are recorded in `InstitutionalIdentityProvider` (`protocol` = `oidc` | `saml`, `zitadel_idp_id`).
- When a user logs in under an institutional ZITADEL organization (`urn:zitadel:iam:org:id` claim):
  - If the Django `Organization` is `suspended` or `deactivated`, login is rejected (`403 account_disabled`).
  - If the user's `Membership` is `suspended` or `deprovisioned`, login is rejected (`403 account_disabled`).
  - Otherwise an active `Membership` is provisioned automatically with the configured `auto_join_role`.
- **No unsafe automatic email linking**: A federated login with the same email address as an existing personal account
  is never merged automatically. Users link identities explicitly via `POST /api/v1/auth/link/start/` +
  `GET /api/v1/auth/link/callback/` after authenticating both sides.
