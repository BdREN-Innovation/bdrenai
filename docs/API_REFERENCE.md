# BDREN Platform REST API Reference (`/api/v1/`)

All endpoints are served by Django REST Framework at `https://bdren.ai/api/v1/` (and `https://api.bdren.ai/api/v1/`).

## 1. Health & Public Catalog
- `GET /api/v1/health/` -> `{"status": "ok"}`
- `GET /api/v1/catalog/products/` -> Public list of active products, features, and latest active package versions.
- `POST /api/v1/catalog/subscribe/` -> Authenticated checkout (`package_id`, `account_id?`, `use_trial?`, `payment_reference?`).

## 2. Authentication & Explicit Account Linking (BFF OIDC + PKCE S256)
- `GET /api/v1/auth/login/?next=/path&org_id=<zitadel_org_id>` -> Starts OIDC Authorization Code + PKCE S256 flow.
- `GET /api/v1/auth/callback/` -> Validates `state`, exchanges code, validates `id_token` (`RS256`, `iss`, `aud`, `exp`, `nonce`), provisions `User` by unique `(issuer, zitadel_subject)` and sets `HttpOnly` session cookie.
- `POST /api/v1/auth/link/start/` -> Starts explicit verified account-linking OIDC flow (`prompt=login`).
- `GET /api/v1/auth/link/callback/` -> Links verified `(issuer, subject)` as an `ExternalIdentity` on the current user.
- `POST /api/v1/auth/logout/` -> CSRF-protected local session termination + returns ZITADEL `end_session_endpoint`.
- `GET /api/v1/auth/me/` -> Returns current user profile, active account context, memberships, and linked identities.

## 3. Account Contexts (Personal & Organization)
- `GET /api/v1/accounts/contexts/` -> Lists all accessible Personal and Organization accounts with roles.
- `POST /api/v1/accounts/switch-context/` -> Body: `{"account_id": "<uuid>"}`. Verifies active membership before switching.

## 4. Entitlements & Atomic Usage Reservations
Supports both BFF session authentication and Server-to-Server `X-Product-Api-Key` header.
- `POST /api/v1/entitlements/check/`
  - Request: `{"product": "mindspear", "feature": "ai_requests", "quantity": 1, "issuer": "...", "zitadel_subject": "...", "organization_account_id": "..."}`
  - Response:
    ```json
    {
      "allowed": true,
      "product": "mindspear",
      "feature": "ai_requests",
      "limit": 10000,
      "used": 450,
      "reserved": 10,
      "remaining": 9540,
      "reset_at": "2026-12-01T00:00:00Z"
    }
    ```
- `POST /api/v1/usage/reservations/` -> Atomically reserves quota with `idempotency_key` and TTL.
- `POST /api/v1/usage/reservations/{id}/commit/` -> Converts reserved units into durable `used` count and `UsageEvent`.
- `POST /api/v1/usage/reservations/{id}/release/` -> Releases uncommitted reservation back to the pool.
- `GET /api/v1/entitlements/current/` -> Lists active entitlements for the user's accessible accounts.
- `GET /api/v1/usage/summary/` -> Lists current period usage counters (`used`, `reserved`, `period_start`, `period_end`).

## 5. Administration (`HasPlatformRole` RBAC)
- `GET /api/v1/admin/summary/` -> Dashboard metrics and recent `AuditLog` entries.
- `GET|PATCH /api/v1/admin/users/` -> Search users and activate/suspend/deactivate business profiles.
- `GET|POST /api/v1/admin/organizations/` -> Create organizations, manage memberships, register institutional SAML/OIDC IdPs.
- `POST /api/v1/admin/catalog/` -> Create products, features, packages, and publish new package versions with migration policy (`new_only`, `immediate`, `on_renewal`, `selected_only`).
- `GET|POST /api/v1/admin/subscriptions/` -> Assign/upgrade/downgrade/renew/cancel subscriptions, verify manual payments, and set manual entitlement overrides.
- `GET /api/v1/admin/usage-audit/` -> Inspect usage counters and immutable audit logs.
