I recommend giving this to **Claude Code** from your project root directory. This prompt instructs Claude to build the complete self-hosted identity and subscription platform using **ZITADEL v4 + Django REST Framework + Next.js**, rather than attempting to implement authentication from scratch.

I've included the personal and organization account model, mixed quota management, and administrator-controlled package migration. use bdren.ai/admin , bdren.ai/api this format. but keep auth.bdren.ai 

## **Master development prompt**

# Project: BDREN Centralized Identity & SaaS Entitlement Platform

Act as a Senior Software Architect, Security Engineer, and Full-Stack Developer. Your task is to design and implement a production-oriented, self-hosted centralized identity, SSO, organization, subscription, and package entitlement platform for BDREN.

Do not just provide explanations or example snippets. Inspect the existing repository, understand its architecture, and implement the system with working code, tests, deployment configuration, and documentation.

The implementation must prioritize security, maintainability, low resource consumption, and zero mandatory paid services.

---

# 1. Project overview

I am building a centralized platform under the BDREN domain.

The platform will provide:

- Centralized authentication and SSO across multiple applications.
- User registration and account management.
- Institutional authentication and federation.
- MFA, TOTP, WebAuthn and passkeys.
- Personal and organization accounts.
- Product and package management.
- Subscription management.
- Application-specific usage quotas and entitlements.
- Centralized administration.
- Usage tracking and billing-ready architecture.

Example domains:

| Domain         | Responsibility                                                          |
| -------------- | ----------------------------------------------------------------------- |
| bdren.ai       | Main landing page, product descriptions, pricing and package purchasing |
| auth.bdren.ai  | Central identity provider using ZITADEL                                 |
| admin.bdren.ai | Administrative dashboard                                                |
| api.bdren.ai   | Django REST Framework API                                               |
| mindspear.app  | Independent SaaS application                                            |
| synapse.ai     | Independent SaaS application                                            |

More applications will be added in the future without redesigning the identity system.

# 2. Mandatory technology stack

Use the following architecture.

## Identity provider

ZITADEL v4, self-hosted.

Official documentation:\
[https://zitadel.com/docs](https://zitadel.com/docs)

Important requirements:

- Use the stable v4 release.
- Do not use experimental or preview versions.
- Pin exact Docker image versions.
- Do not build a custom authentication server.
- Do not store user passwords in Django.
- Do not duplicate ZITADEL authentication functionality.
- Use ZITADEL for identity, authentication, SSO and federation.
- Use only functionality available without mandatory paid services or enterprise subscriptions.

ZITADEL responsibilities:

- User registration.
- Login and logout.
- Password management.
- Email verification.
- Password reset.
- OIDC/OAuth 2.0.
- SAML identity-provider integration.
- Institutional identity federation.
- TOTP MFA.
- WebAuthn and passkeys.
- Session management.
- User identity management.
- Identity provider brokering.
- Account linking.

Before implementing features, verify their availability in the self-hosted ZITADEL v4 edition using its official documentation. Do not assume every commercial feature is available in the community deployment.

## Backend

- Python
- Django
- Django REST Framework
- PostgreSQL
- Redis
- Celery when asynchronous background jobs are needed.

## Frontend

- Next.js
- TypeScript
- Tailwind CSS
- A maintainable component architecture.
- Responsive UI.

## Infrastructure

- Ubuntu Server
- Docker
- Docker Compose
- Nginx
- HTTPS
- PostgreSQL
- Redis

Avoid Kubernetes, Kafka, microservices and other unnecessary infrastructure in the initial implementation.

Start with a modular monolithic Django backend.

# 3. Architecture principles

Strictly separate authentication from business authorization.

ZITADEL is responsible for answering:

"Who is this user?"

Django is responsible for answering:

"What can this user access, and how much can they use?"

The platform must not depend on ZITADEL to manage:

- Products.
- Packages.
- Subscription prices.
- Usage quotas.
- Billing.
- Product-specific permissions.
- Subscription entitlements.

These belong to Django.

Django must identify users using their validated ZITADEL issuer and subject.

Use an external identity mapping with a unique constraint:

UNIQUE(issuer, subject)

Never identify users solely by email.

Never automatically link two accounts only because their email addresses match.

Account linking must be handled through a secure, explicitly verified process.

# 4. SSO requirements

The central authentication URL will be:

[https://auth.bdren.ai](https://auth.bdren.ai)

Each application will have its own OIDC client configuration.

Example:

- Mindspear OIDC client.
- Synapse OIDC client.
- Future application OIDC clients.

Implement Authorization Code Flow with PKCE (S256).

The expected login flow:

1. A user opens mindspear.app.
2. The application checks whether the user has an application session.
3. If not authenticated, redirect the browser to ZITADEL.
4. ZITADEL displays the central login page.
5. The user can register or log in.
6. The user can authenticate using an institutional identity provider where configured.
7. ZITADEL authenticates the user.
8. ZITADEL redirects to the registered callback URL.
9. The application's backend exchanges the authorization code.
10. The backend validates the identity and creates its own session.
11. The user can access the application.

When the same user opens synapse.ai:

1. Synapse redirects to ZITADEL.
2. ZITADEL recognizes the existing central SSO session.
3. The user is not asked for credentials again, unless authentication policy requires it.
4. ZITADEL redirects to Synapse.
5. Synapse creates its own local application session.

Do not share authentication cookies between unrelated application domains.

Each application maintains its own secure session.

Implement a reusable OIDC integration pattern and documentation so future application backends, including Django, Node.js or other frameworks, can integrate without duplicating security logic.

Prefer a Backend-for-Frontend (BFF) architecture where practical.

Browser sessions must use Secure, HttpOnly cookies. Do not store long-lived authentication tokens in localStorage.

Implement proper validation of:

- Issuer.
- Audience.
- Signature.
- Expiration.
- State.
- Nonce.
- PKCE.
- Registered redirect URI.

Support signing-key rotation through the issuer's JWKS endpoint.

# 5. Institutional federation

Institutional login is a mandatory requirement.

Universities may use different identity providers.

Examples:

- University A: SAML 2.0.
- University B: OIDC.
- University C: Shibboleth-based SAML identity provider.

ZITADEL should act as the identity broker.

Applications should use only BDREN's OIDC identity provider, regardless of the institution's upstream protocol.

Requirements:

- Configure external SAML identity providers.
- Configure external OIDC identity providers.
- Allow institution-specific identity-provider configuration.
- Support organization-specific login policies where available.
- Implement external identity mapping.
- Support account linking.
- Map institutional email, display name and verified attributes.
- Map institutional users to the corresponding BDREN organization.
- Handle disabled or deprovisioned institutional accounts.
- Prevent unsafe automatic account linking.

Design the Django organization model to connect an institution's business organization with its corresponding ZITADEL organization ID.

Important: Verify whether the required academic federation integration, including eduGAIN where applicable, is supported directly or requires additional federation metadata and trust configuration. Do not assume generic SAML support automatically provides eduGAIN compatibility.

# 6. MFA and passkeys

Authentication security must be implemented through ZITADEL.

Required capabilities:

- Password authentication.
- Email verification.
- TOTP authentication.
- WebAuthn.
- Passkeys.
- Passwordless login.
- Secure account recovery.
- Recovery mechanisms.
- Configurable MFA policies.

Administrators must use strong authentication.

Never store passwords, MFA secrets or passkey credentials in Django.

Do not implement custom cryptographic authentication mechanisms.

Document how an administrator enables and enforces MFA policies.

# 7. Account and organization model

The system must support both personal and organization-owned accounts.

An individual user may:

- Own a personal account.
- Belong to multiple organizations.
- Have different roles in different organizations.
- Switch between personal and organizational account contexts.

Examples:

User A:

- Personal account.
- University A membership.
- Organization B membership.

Use a database model conceptually similar to:

## User

id\
zitadel_subject\
issuer\
email\
name\
status\
created_at

## Account

id\
account_type              # PERSONAL / ORGANIZATION\
owner_user_id\
organization_id\
status\
created_at

## Organization

id\
name\
slug\
zitadel_organization_id\
status\
created_at

## Membership

id\
user_id\
organization_id\
role\
status\
created_at

## ExternalIdentity

id\
user_id\
issuer\
subject\
provider_type\
created_at

Apply appropriate unique constraints and foreign keys.

The ZITADEL user ID must be the stable external identity reference.

# 8. Product management

BDREN will offer multiple independent SaaS applications.

Examples:

- Mindspear.
- Synapse.
- Mailwizard.
- Future products.

Implement a reusable product management system.

Suggested models:

## Product

id\
name\
slug\
description\
status\
created_at

## Feature

id\
key\
name\
description\
unit\
status

## Package

id\
product_id\
name\
description\
price\
billing_interval\
status

## PackageVersion

id\
package_id\
version\
status\
created_at

## PackageLimit

id\
package_version_id\
feature_id\
limit_value\
limit_period

A feature should be defined independently of a particular package.

Examples:

Mindspear features:

- ai_requests
- storage_gb
- team_members
- projects
- advanced_models

Synapse features:

- workflow_executions
- api_requests
- integrations
- storage_gb

Each product has independent packages and limits.

Do not hardcode package names, product identifiers or quota limits in application code.

Administrators must be able to configure these from the dashboard.

# 9. Subscription management

Implement a subscription system supporting both personal and organization accounts.

Suggested model:

## Subscription

id\
account_id\
product_id\
package_version_id\
status\
starts_at\
expires_at\
billing_interval\
created_at

## SubscriptionHistory

id\
subscription_id\
old_package_version_id\
new_package_version_id\
change_type\
changed_by\
changed_at

Support:

- Free packages.
- Paid packages.
- Trial subscriptions.
- Active subscriptions.
- Expired subscriptions.
- Cancelled subscriptions.
- Renewals.
- Upgrades.
- Downgrades.
- Manual administrator adjustments.

IMPORTANT PACKAGE VERSIONING:

When an administrator edits a package, existing subscribers must not automatically receive changed limits.

Retain package versions.

Allow an administrator to choose whether a package update:

- Applies only to new subscribers.
- Migrates existing subscribers immediately.
- Migrates existing subscribers at renewal.
- Applies only to explicitly selected subscriptions.

Preserve subscription history and audit records.

Design a payment-provider abstraction. Do not require a paid payment provider. Support manual/offline payments initially and keep future payment integrations modular.

# 10. Entitlement and quota engine

This is one of the most important parts of the system.

Quotas must support:

1. Personal account quotas.
2. Organization account quotas.
3. Mixed quota policies.

Example:

Mindspear Professional:

Personal AI requests: 5,000/month.

Organization AI requests: 50,000/month.

A feature must be configurable to consume:

- Personal quota.
- Organization quota.
- Both.
- An administrator-defined allocation or priority policy.

Do not hardcode these policies.

Suggested models:

## Entitlement

id\
account_id\
product_id\
feature_id\
limit\
period\
effective_from\
effective_until

## UsageEvent

id\
account_id\
product_id\
feature_id\
quantity\
idempotency_key\
metadata\
created_at

## UsageCounter

id\
account_id\
product_id\
feature_id\
period_start\
period_end\
used\
reserved\
updated_at

## UsageReservation

id\
account_id\
product_id\
feature_id\
quantity\
status\
idempotency_key\
expires_at\
created_at

Build a central entitlement service.

Example API:

POST /api/v1/entitlements/check/

POST /api/v1/usage/reservations/

POST /api/v1/usage/reservations/{id}/commit/

POST /api/v1/usage/reservations/{id}/release/

GET /api/v1/entitlements/current/

GET /api/v1/usage/summary/

An example entitlement response:

{\
"allowed": true,\
"product": "mindspear",\
"feature": "ai_requests",\
"limit": 10000,\
"used": 450,\
"reserved": 10,\
"remaining": 9540,\
"reset_at": "2026-12-01T00:00:00Z"\
}

SECURITY AND CONSISTENCY:

- Never trust account IDs provided directly by an untrusted frontend.
- Validate the authenticated user and their membership.
- Verify that the requesting application has permission to access the relevant product.
- Use database transactions and atomic operations.
- Prevent concurrent requests from exceeding limits.
- Implement idempotency keys.
- Prevent duplicate usage consumption.
- Support reservation, commit and release.
- Handle failed operations and expired reservations.
- Store durable usage records in PostgreSQL.
- Use Redis for caching and temporary coordination, not as the only source of truth.

Design the entitlement engine so that applications can integrate through secure server-to-server APIs.

# 11. Django backend structure

Build a modular Django project.

Suggested structure:

backend/\
config/\
apps/\
accounts/\
organizations/\
identities/\
products/\
packages/\
subscriptions/\
entitlements/\
usage/\
billing/\
administration/\
audit/\
integrations/\
requirements/\
tests/

Use:

- Django REST Framework.
- Proper serializers.
- Service layer for business logic.
- Selectors/query services where appropriate.
- Model constraints.
- Database transactions.
- Permission classes.
- Pagination.
- Versioned APIs.
- Structured logging.
- Automated tests.

Keep authentication-provider integration code separate from business logic.

# 12. Admin dashboard

Build admin.bdren.ai using Next.js and TypeScript.

Create a professional, responsive administrative interface.

Required sections:

Dashboard:

- Total users.
- Active organizations.
- Active subscriptions.
- Product usage.
- Revenue/payment summary.
- Recent events.

User management:

- Search users.
- View profiles.
- View linked identities.
- View account memberships.
- Activate/deactivate business profiles.
- View subscriptions.

Organization management:

- Create organizations.
- Manage memberships.
- Assign roles.
- Associate ZITADEL organization IDs.
- Configure institutional identity-provider relationships.

Product management:

- Create/edit products.
- Define features.
- Configure product status.

Package management:

- Create packages.
- Define limits.
- Version packages.
- Preview changes.
- Select migration policy.

Subscription management:

- Assign packages.
- Upgrade/downgrade.
- Extend expiry.
- Cancel subscriptions.
- Apply authorized manual adjustments.

Usage management:

- Usage reports.
- Quota consumption.
- Entitlement overrides.
- Usage history.

Administration:

- Admin roles.
- Permissions.
- Audit logs.
- System settings.

Implement role-based access control.

Suggested administrative roles:

- Platform Super Admin.
- Identity Administrator.
- Organization Administrator.
- Product Manager.
- Billing Administrator.
- Support Administrator.

Do not expose ZITADEL administrative credentials to the browser.

# 13. Public landing page

Build bdren.ai as the public BDREN platform landing page.

Sections:

- Hero section.
- About BDREN.
- Product catalog.
- Product descriptions.
- Pricing and packages.
- Features comparison.
- Registration/login entry point.
- Contact/support.
- Documentation.

Users should be able to view product pricing and package information without logging in.

When the user selects a product package, redirect them through the appropriate secure registration/login and subscription process.

Do not implement a fake purchase flow. Support manual payment records initially and design payment integration as a separate module.

# 14. ZITADEL integration

Integrate Django with ZITADEL using supported administrative and OIDC interfaces.

Requirements:

- Configure issuer URL.
- Configure OIDC clients.
- Configure service accounts or machine authentication.
- Implement secure access to ZITADEL management APIs.
- Map ZITADEL user IDs to Django profiles.
- Synchronize relevant identity information.
- Handle first-login user provisioning.
- Handle identity changes.
- Handle account deactivation and revocation where possible.
- Avoid direct access to the ZITADEL database.
- Never give Django unrestricted ZITADEL administrative permissions.

Use minimum required service-account permissions.

Keep all secrets in environment variables or a proper secrets-management mechanism.

Verify the exact supported API and scopes against the selected ZITADEL v4 documentation.

# 15. Deployment architecture

Use Docker Compose initially.

Required services:

- ZITADEL v4.
- ZITADEL Login application if required by the selected deployment mode.
- PostgreSQL.
- Django.
- Redis.
- Next.js dashboard.
- Next.js landing page.
- Nginx.

Domains:

auth.bdren.ai\
admin.bdren.ai\
api.bdren.ai\
bdren.ai

Applications:

mindspear.app\
synapse.ai

Requirements:

- Production Dockerfiles.
- Multi-stage builds where useful.
- Health checks.
- Restart policies.
- Persistent database volumes.
- Separate database roles and databases.
- Private Docker networks.
- No public PostgreSQL/Redis ports.
- HTTPS reverse proxy.
- Correct forwarded headers.
- Secure cookie configuration.
- Database backups.
- Migration strategy.
- Environment configuration.
- Centralized logs.
- Production-ready process management.

Use a pinned ZITADEL v4 release and verify its official Docker Compose deployment instructions.

Never blindly copy obsolete Compose examples from old releases.

Create:

docker-compose.yml\
docker-compose.prod.yml\
.env.example\
backend/Dockerfile\
frontend/Dockerfile\
deploy/nginx/\
scripts/\
docs/

Do not place real passwords or private credentials in the repository.

# 16. Security requirements

Treat this as a security-critical production identity platform.

Implement:

- HTTPS everywhere.
- Secure session cookies.
- CSRF protection.
- CORS allowlisting.
- Secure token validation.
- Strict audience validation.
- OAuth state and nonce verification.
- PKCE S256.
- Exact redirect URI configuration.
- Rate limiting.
- Login abuse protection.
- Admin MFA.
- RBAC.
- Input validation.
- SQL injection protection.
- Audit trails.
- Secure secret handling.
- Database backup and recovery.
- Dependency vulnerability checks.

Do not store identity-provider passwords or MFA secrets in Django.

Do not implement authentication using insecure custom JWT handling.

Do not trust an application merely because it sends a user ID in an API request.

All sensitive operations must be authorized server-side.

# 17. Testing

Write meaningful automated tests.

Backend:

- Unit tests.
- API tests.
- Permission tests.
- Subscription tests.
- Entitlement tests.
- Quota concurrency tests.
- Idempotency tests.
- Organization membership tests.
- Identity mapping tests.

Integration:

- OIDC login.
- First-login provisioning.
- SSO across two applications.
- Session expiration.
- Token validation.
- Institutional SAML login.
- Institutional OIDC login.
- MFA enrollment.
- Passkey login.
- Account linking.

Frontend:

- Component tests.
- Form validation.
- Authentication state.
- Admin RBAC.
- Product management.
- Package management.

Infrastructure:

- Container health checks.
- HTTPS configuration.
- Database persistence.
- Backup restoration.
- Service restart behavior.

Add end-to-end tests using Playwright where practical.

Do not claim tests passed without executing them.

# 18. Development approach

Work incrementally.

PHASE 0: Repository audit and architecture.

- Inspect the existing repository.
- Identify existing code, frameworks, dependencies and conventions.
- Identify reusable modules.
- Avoid overwriting existing functionality.
- Produce an architecture document.
- Identify missing requirements and implementation risks.

PHASE 1: Infrastructure and ZITADEL.

- Deploy self-hosted ZITADEL v4.
- Configure auth.bdren.ai.
- Configure PostgreSQL.
- Configure OIDC projects and application clients.
- Configure hosted login.
- Configure registration and email verification.

PHASE 2: Authentication integration.

- Implement OIDC integration.
- Implement secure sessions.
- Implement first-login provisioning.
- Implement user identity mapping.
- Integrate two demo applications.

PHASE 3: Organization and federation.

- Implement personal and organization accounts.
- Implement memberships.
- Configure external OIDC providers.
- Configure external SAML providers.
- Implement account-linking workflows.

PHASE 4: Product and package management.

- Implement products.
- Implement features.
- Implement packages.
- Implement package versioning.
- Implement subscriptions.

PHASE 5: Entitlement engine.

- Implement account-level entitlements.
- Implement mixed quota allocation.
- Implement usage reservations.
- Implement atomic consumption.
- Implement quota reporting.

PHASE 6: Admin and public interfaces.

- Implement admin dashboard.
- Implement public landing page.
- Implement product catalog.
- Implement package management.
- Implement subscription management.

PHASE 7: Security and production deployment.

- Complete security review.
- Add tests.
- Configure monitoring.
- Configure backups.
- Configure production deployment.
- Write operational documentation.

# 19. Important development rules

1. Do not attempt to rebuild ZITADEL.
2. Do not implement a custom password database.
3. Do not duplicate the identity provider's session or MFA logic.
4. Do not put business entitlement logic inside ZITADEL.
5. Do not create microservices prematurely.
6. Do not introduce unnecessary dependencies.
7. Do not use paid SaaS dependencies.
8. Do not implement fake integrations.
9. Do not assume features are available without checking documentation.
10. Do not use wildcard redirect URIs.
11. Never trust frontend authorization checks.
12. Never use localStorage for long-lived authentication tokens.
13. Never expose secrets in frontend code.
14. Never expose administrative service credentials.
15. Keep code modular, documented and testable.

Before implementing any integration, verify the relevant official API and configuration documentation.

When a requirement cannot be implemented using the selected open-source edition, clearly identify the limitation and propose a self-hosted alternative. Never silently substitute a paid feature.

# 20. Expected deliverables

At the end of development, provide:

1. Complete working source code.
2. ZITADEL self-hosted configuration.
3. Django REST API.
4. Next.js admin dashboard.
5. Next.js public landing page.
6. Docker Compose deployment.
7. Nginx configuration.
8. PostgreSQL schemas and migrations.
9. API documentation.
10. OIDC integration guide for future applications.
11. Institutional SAML/OIDC integration guide.
12. MFA and passkey configuration guide.
13. Security documentation.
14. Environment variable reference.
15. Backup and restore procedures.
16. Automated tests.
17. Production deployment guide.
18. Architecture diagrams.
19. Known limitations and outstanding security considerations.

Maintain a DEVELOPMENT_PROGRESS.md file and update it after each phase.

For each implementation phase, report:

- What was implemented.
- Files created or modified.
- Commands to run.
- Tests executed and their results.
- Remaining issues.
- Security considerations.

# FINAL INSTRUCTION

Start by auditing the existing repository and preparing a detailed implementation plan.

Then proceed with implementation phase by phase.

Do not dump the entire project into a single response.

Work directly in the repository, create actual files, execute tests and fix errors.

Preserve existing functionality and conventions.

Prefer simple, secure and production-maintainable solutions over unnecessary architectural complexity.

The result should be a self-hosted centralized identity and SaaS management platform that BDREN can use to integrate multiple applications and institutional users for years to come.
