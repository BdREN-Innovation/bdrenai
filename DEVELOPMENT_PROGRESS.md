# BDREN Centralized Identity & SaaS Entitlement Platform — Development Progress

## Phase 0 — Repository Audit & Architecture: COMPLETED
- **Files**: `docs/ARCHITECTURE.md`, `.gitignore`
- **Summary**: Audited greenfield workspace, established strict separation between ZITADEL v4.20.3 (authentication, MFA/Passkeys, OIDC/SAML federation) and Django 5.2 DRF (business organizations, products, versioned packages, subscriptions, mixed-quota entitlements, and atomic usage reservations).

## Phase 1 — Infrastructure & ZITADEL v4: COMPLETED
- **Files**: `docker-compose.yml`, `docker-compose.override.yml`, `.env.example`, `deploy/nginx/nginx.conf`, `deploy/nginx/conf.d/auth.conf.template`, `deploy/postgres/init-bdren-db.sh`, `scripts/bootstrap_zitadel.py`, `deploy/zitadel/clients.json`
- **Verified**:
  - ZITADEL v4.20.3 (`zitadel-api` + `zitadel-login` Login v2), PostgreSQL 17, Redis 7, and Nginx reverse proxy (HTTP + gRPC) running and healthy.
  - Separate PostgreSQL roles & databases (`zitadel` and `bdren`; `bdren` role has no `CREATEDB` privilege).
  - Idempotent OIDC client provisioning (`bdren-platform-api`, `demo-app-a`, `demo-app-b`) with PKCE S256 and exact redirect URIs (wildcards rejected).

## Phase 2 — Authentication Integration & Demo Applications: COMPLETED
- **Files**: `backend/apps/identities/{models.py,oidc.py,services.py,views.py,urls.py}`, `backend/Dockerfile`, `demo_apps/app.py`, `docs/OIDC_INTEGRATION_GUIDE.md`, `backend/tests/{test_oidc_validation.py,test_login_flow.py,test_live_sso_two_apps.py}`
- **Verified**:
  - Authorization Code + PKCE S256, `state`, `nonce`, `iss`, `aud`, `exp`, `RS256`-only signature validation, JWKS key rotation.
  - First-login user provisioning keyed strictly by `UNIQUE(issuer, zitadel_subject)` with unusable Django password hash and automatic Personal `Account` creation.
  - Live end-to-end SSO test across `demo-app-a` (port 9001), `demo-app-b` (port 9002), and Django's BFF against the running ZITADEL v4 instance reusing a single central ZITADEL v2 session without sharing cookies across applications.

## Phase 3 — Organization Model, Institutional Federation & Account Linking: COMPLETED
- **Files**: `backend/apps/organizations/{models.py,services.py}`, `backend/apps/accounts/{models.py,services.py,views.py,urls.py}`, `scripts/configure_institutional_idp.py`, `docs/INSTITUTIONAL_FEDERATION_GUIDE.md`, `backend/tests/test_organizations_and_federation.py`
- **Verified**:
  - Personal and Organization `Account` model with DB check constraints (`chk_account_owner_or_organization`).
  - Multi-organization `Membership` with distinct roles (`owner`, `admin`, `billing`, `member`) and server-verified context switching (`GET /api/v1/accounts/contexts/`, `POST /api/v1/accounts/switch-context/`).
  - Upstream SAML 2.0 and OIDC institutional federation mapping (`urn:zitadel:iam:org:id` -> `Organization.zitadel_organization_id`), deprovisioned/suspended account enforcement, and live ZITADEL v4 Organization + IdP provisioning test.
  - Explicit, cryptographically verified account linking (`POST /api/v1/auth/link/start/` + `GET /api/v1/auth/link/callback/`); zero automatic email-based linking.

## Phase 4 — Product, Package Versioning, Subscription & Billing Management: COMPLETED
- **Files**: `backend/apps/products/`, `backend/apps/packages/`, `backend/apps/subscriptions/`, `backend/apps/billing/`, `backend/apps/audit/`
- **Verified**:
  - Reusable `Product`, `Feature`, `Package`, `PackageVersion`, `PackageLimit`, `Subscription`, `SubscriptionHistory`, and `PaymentRecord` models.
  - All 4 administrator-controlled package version migration policies tested (`new_only`, `immediate`, `on_renewal`, `selected_only`).
  - Manual/offline payment recording and administrator verification activating/renewing subscriptions (`seed_bdren_catalog` seeds Mindspear and Synapse).

## Phase 5 — Entitlement & Atomic Quota Engine: COMPLETED
- **Files**: `backend/apps/entitlements/`, `backend/apps/usage/`, `backend/tests/test_packages_subscriptions_entitlements.py`
- **Verified**:
  - Personal, Organization, and Mixed quota policies (`personal_only`, `organization_only`, `personal_then_org`, `org_then_personal`, `both`).
  - Two-phase quota reservation (`POST /api/v1/usage/reservations/`), commit (`/commit/`), release (`/release/`), entitlement check (`/api/v1/entitlements/check/`), current entitlements (`/api/v1/entitlements/current/`), and usage summary (`/api/v1/usage/summary/`).
  - `SELECT ... FOR UPDATE` row locking in PostgreSQL verified with multi-threaded concurrency test (8 concurrent threads reserving 30 units against a 100-unit limit -> exactly 3 succeed, 5 rejected).
  - Idempotency keys and expired reservation reclamation verified.
  - Server-to-server `X-Product-Api-Key` authentication and cross-product isolation verified.

## Phase 6 — Next.js Admin Dashboard & Public Landing Page: COMPLETED
- **Files**: `frontend/src/components/{LandingPortal.tsx,AdminDashboard.tsx}`, `frontend/src/app/{page.tsx,admin/page.tsx}`, `frontend/src/lib/api.ts`, `frontend/src/__tests__/frontend.test.tsx`, `frontend/Dockerfile`
- **Verified**:
  - Public landing portal (`bdren.ai/`) with Hero, About BDREN, Product & Package catalog, pricing comparison, account context switcher, and subscription checkout modal.
  - Admin dashboard (`bdren.ai/admin` & `admin.bdren.ai`) with RBAC role enforcement (`platform_super_admin`, `identity_administrator`, `organization_administrator`, `product_manager`, `billing_administrator`, `support_administrator`), metrics overview, user/org/product/package version migration/subscription/payment/usage/audit management.
  - Vitest + React Testing Library suite (**4/4 passed**) and production Next.js standalone build (`npm run build`) succeeded.

## Phase 7 — Security, Backups, Production Overlay & Documentation: COMPLETED
- **Files**: `docker-compose.prod.yml`, `deploy/nginx/conf.d/platform.conf.template`, `deploy/nginx/prod-https.conf.template`, `scripts/backup_restore.sh`, `docs/{API_REFERENCE.md,MFA_AND_PASSKEYS_GUIDE.md,SECURITY_AND_LIMITATIONS.md,ENV_REFERENCE.md,BACKUP_AND_RESTORE.md,PRODUCTION_DEPLOYMENT_GUIDE.md}`, `backend/tests/test_infrastructure_and_security.py`
- **Verified**:
  - **42/42 backend & live integration tests passed** (`scripts/test_backend.sh`).
  - **4/4 frontend component tests passed** (`cd frontend && npm test`).
  - Database backup and automated restore verification (`scripts/backup_restore.sh backup` and `scripts/backup_restore.sh verify-restore`) executed and verified against PostgreSQL 17.
