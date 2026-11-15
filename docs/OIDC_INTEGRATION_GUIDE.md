# Integrating an application with BDREN SSO

Each app is a **confidential OIDC client** (Backend-for-Frontend) of ZITADEL at `auth.bdren.ai`.

1. Add the client to `deploy/zitadel/clients.json` (exact redirect URIs, **no wildcards**) and run
   `scripts/bootstrap_zitadel.py` (admin PAT from the bootstrap volume; delete it afterwards).
2. In your backend implement Authorization Code + **PKCE S256**:
   store `state`, `nonce`, `code_verifier` server-side → redirect → on callback verify `state` (single-use),
   exchange the code at the token endpoint, and validate the `id_token`: signature (JWKS, refetch on unknown `kid`),
   `iss`, `aud` (= your client id), `exp`, `nonce`; allow only `RS256`.
3. Identify the user by **(`iss`, `sub`)** — never by email. Create your own session cookie
   (`Secure; HttpOnly; SameSite=Lax`). Do not put tokens in localStorage. Do not share cookies across domains.
4. Ask the platform API server-to-server for entitlements (Phase 5).

Reference implementation (Python): `backend/apps/identities/oidc.py` (protocol) + `services.py` (provisioning).
SSO: the second app redirects to ZITADEL, which reuses the central session, so no credential prompt.
