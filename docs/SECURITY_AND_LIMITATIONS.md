# Security Architecture & Known Open-Source Limitations

## 1. Security Controls Implemented
- **Zero password / MFA storage in Django**: `User.set_unusable_password()` is enforced on every user; all authentication, TOTP, and Passkeys live in ZITADEL v4.
- **Strict OIDC Validation**: Authorization Code + PKCE (`S256`), single-use `state`, `nonce`, `RS256`-only algorithm allowlist (`alg: none` and `HS256` rejected), audience (`aud`/`azp`), issuer (`iss`), expiration (`exp`), and automatic JWKS key rotation.
- **Identity Mapping**: Keyed strictly by `UNIQUE(issuer, zitadel_subject)` and `ExternalIdentity` `UNIQUE(issuer, subject)`. Automatic email-based linking is prohibited everywhere (including `AUTO_LINKING_OPTION_UNSPECIFIED` on ZITADEL IdPs).
- **BFF Session Cookies**: `HttpOnly`, `SameSite=Lax`, `Secure` (in non-debug), CSRF protection on state-changing endpoints, open-redirect allowlist on `next`.
- **Database Concurrency & Least Privilege**: Separate DB roles (`zitadel` vs `bdren`, where `bdren` lacks `CREATEDB`); `SELECT ... FOR UPDATE` row locking on `UsageCounter`; idempotency keys on `UsageReservation` and `UsageEvent`.

## 2. Verified ZITADEL v4 Community / Self-Hosted Limitations & Alternatives
1. **eduGAIN Multi-Entity Federation Metadata**:
   - ZITADEL v4 OSS supports multiple SAML 2.0 and OIDC Identity Providers per organization via metadata XML or URL,
     but does not natively ingest multi-IdP `EntitiesDescriptor` aggregates (full eduGAIN feed) or MDQ discovery.
   - **Self-Hosted Solution**: Register member universities directly via `scripts/configure_institutional_idp.py`, or
     deploy a self-hosted **SATOSA / SimpleSAMLphp + pyFF** SAML proxy container upstream of ZITADEL.
