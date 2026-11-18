# Superadmin panel: phase 0–1 contract

Shared contract for the backend (Django) and the two frontends (admin SPA, Next.js portal) built for
phases 0–1 of `docs/SUPERADMIN_PANEL_PLAN.md`. If code and this file disagree, fix one of them; do not
improvise a third shape.

Scope of phase 0–1: admin app shell, superadmin sign-in, institutions, accounts (users), invitations,
institution-wide seats, audit, and the institution-admin portal Members page + invitation acceptance.
Billing, subscriptions, usage, configuration and provisioning to apps come in later phases.

## Conventions

- JSON in and out. Session cookie auth (`bdren_session`, Django `SessionAuthentication`), CSRF required
  on unsafe methods (`X-CSRFToken` header from the `csrftoken` cookie). Ensure `GET /api/v1/csrf/` sets
  the cookie (add it if missing: `ensure_csrf_cookie`, returns `{"ok": true}`).
- Times: ISO 8601 UTC strings (`2026-11-18T07:00:00Z`). IDs: UUID strings. Institutions are addressed by `slug`.
- Lists: `?page=N` (1-based) and `?page_size=` (default 25, max 100) →
  `{"results": [...], "count": 123, "page": 1, "page_size": 25}`. Search `?q=` (case-insensitive contains).
- Errors: `{"error": "<code>", "message": "<human text>", "fields": {"<field>": "<text>"}}` with
  400 (invalid), 401 (not signed in), 403 (forbidden), 404, 409 (conflict, e.g. `seat_cap_reached`,
  `already_member`, `slug_taken`, `invitation_not_pending`). Framework failures use the same shape on all three
  APIs: `invalid` (bad JSON), `not_authenticated`, `forbidden` (e.g. CSRF), `not_found`, `method_not_allowed`,
  `throttled`.
- Every mutation writes `AuditLog` (`apps.audit.services.record_audit`) with actor, `ip_address`
  (`apps.audit.services.client_ip`: the `X-Real-IP` header when the peer is a trusted proxy in `TRUSTED_PROXIES`,
  i.e. the bundled nginx, else `REMOTE_ADDR`), and metadata including `reason` when one is given.
- Actions that email invitations (invite, resend, resend-expired, import, create institution with an admin) share
  a per-admin rate limit `INVITATION_SEND_RATE` (default `120/hour`) across both APIs → 429 `throttled`.
- Destructive actions are soft (status changes). Nothing here hard-deletes institutions or users.
- Reads that are independent run in parallel or are combined into one query; never N+1 over lists
  (use `annotate`, `select_related`, `prefetch_related`).

## Data model changes

### `Organization` (apps.organizations) — new fields
| field | type | notes |
|---|---|---|
| `type` | choice `university`/`research`/`government`/`school`/`other`, default `other` | |
| `sector` | choice `public`/`private`/`other`, blank | ownership, from the BdREN member list when picked there |
| `timezone` | char(64), default `Asia/Dhaka` | validated against `zoneinfo.available_timezones()` |
| `contact_email` | email, blank | |
| `sign_in_domains` | JSON list of lowercase domains, default `[]` | empty = any email; validated (`example.edu`, no `@`, no scheme) |
| `seat_cap` | positive int, null | null = unlimited. Phase 2 derives the default from packages; for now it is set by the superadmin |
| `seat_cap_reason` | text, blank | reason of the last cap change |
| `updated_at` | datetime auto_now | |

`status` keeps `active`/`suspended`/`deactivated` ("Remove" = deactivated).

### `Invitation` (new app `apps.invitations`)
| field | type | notes |
|---|---|---|
| `id` | UUID pk | |
| `email` | email, stored lowercased | addressee only, never an identity |
| `name` | char(255), blank | |
| `organization` | FK Organization, **null** | null = individual (personal account) invite |
| `role` | `Membership.Role` value: `member`/`admin`/`billing`/`owner` | superadmin may use any; portal admins only `member`/`admin` |
| `token_hash` | char(64) unique | SHA-256 hex of a `secrets.token_urlsafe(32)` token; the raw token only exists in the email link |
| `status` | `pending`/`accepted`/`revoked`/`expired` | `expired` is computed: pending + `expires_at < now` is reported as `expired`; a periodic sweep may persist it |
| `source` | `superadmin`/`portal`/`import` | |
| `invited_by` | FK User, null | |
| `expires_at` | datetime | `now + INVITATION_TTL_DAYS` (setting, default 7) |
| `sent_count` | int, default 1 | |
| `last_sent_at` | datetime | |
| `email_status` | `queued`/`sending`/`sent`/`failed` | delivery of the latest email (see Email) |
| `accepted_by` | FK User, null | |
| `accepted_at` | datetime, null | |
| `created_at` | datetime | |

Constraint: at most one `pending` invitation per (`organization`, `email`) — partial unique index on
(`organization`, `email`) where `status='pending'`. Creating a second one returns 409 `already_invited`
(the UI offers Resend). Resend issues a **new token** (old link stops working), resets `expires_at`, bumps
`sent_count`. Resend applies the same rules as a new invitation (`already_member`, `domain_not_allowed`) and is
refused with 429 `resend_too_soon` (`{"retry_after": seconds}`) within `INVITATION_RESEND_COOLDOWN_MINUTES`
(default 5) of the last email.

An expired invitation is **superseded** when a new invitation to the same email in the same institution is
created, or when that person's membership becomes active (accepting, an approved sign-up request, reactivation,
institutional sign-in): it is set to `revoked` with an `invitation.revoked` audit entry whose `reason` is
`superseded` / `joined`, so it no longer counts as expired or offers Resend.

## Seats (institution-wide, across all apps)

`seats_used(org)` = active memberships (`status=active`) + pending invitations not yet expired, one seat per
person: a pending invitation to someone who is already an active member is not counted again.
Pending sign-up requests (`Membership.status=pending`) and suspended/deprovisioned memberships do **not**
count. `seat_cap=None` → unlimited. Approving the request of someone who also holds a live invitation adds no seat.

Every operation that adds seats (invite, import, approve a pending request, reactivate a suspended member,
sign-in through the institution's own IdP) locks the org row (`select_for_update`) and checks the cap inside the
same transaction. Institutional sign-in over the cap leaves (or creates) a pending sign-up request instead. Over the cap →
409 `seat_cap_reached` with `{"seats_used": n, "seat_cap": m}` in the body.

Shape used everywhere: `"seats": {"used": 15, "cap": 100}` (`cap` null = unlimited).

## Email

Django email settings from env: `EMAIL_BACKEND` (default console backend when `DEBUG`, SMTP otherwise),
`EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`, `EMAIL_USE_TLS`,
`DEFAULT_FROM_EMAIL` (default `BDREN AI <no-reply@bdren.ai>`). Links use `PLATFORM_PUBLIC_URL`
(default `http://bdren.localhost:8080`). Invitation email: plain text + simple HTML, subject
`You're invited to <Institution> on BDREN AI` (individual: `You're invited to BDREN AI`), body names the
inviter (only when the name reads as a plain name, else "BDREN AI"; the invitee's name is not in the email, so no
inviter-supplied text reaches it), the role, the expiry date, and the link `<PLATFORM_PUBLIC_URL>/invite/<token>`.
A request sends at most `INVITATION_INLINE_EMAILS` (default 5) emails itself, after the transaction commits
(`transaction.on_commit`); bulk actions leave the rest `queued` for the `mailer` service
(`manage.py send_invitation_emails --loop`), which issues each a fresh token and sends it. A send failure is
logged, recorded as `email_status: "failed"` and reported in the response as `"email_sent": false` /
`"email_failures"`; the invitation stays pending so Resend works. Bulk responses also carry `"email_queued"`.

## Sign-in for the admin app

- `/api/v1/auth/login/?next=<url>` already exists. `next` may be an absolute URL whose origin is in
  `OIDC_ALLOWED_REDIRECT_ORIGINS`. The admin SPA sends the browser to
  `/api/v1/auth/login/?next=<current admin URL>` when the session endpoint answers 401.
- Management command `grant_platform_role --email <email> | --user <uuid> [--role platform_super_admin] [--revoke]`
  so the first superadmin can be created from the shell (the user must have signed in once; `--email` matches
  only accounts whose email is verified).

## Superadmin API — `/api/v1/superadmin/` (new app `apps.superadmin`)

Permission: authenticated, active, and holds `PlatformRoleAssignment.Role.SUPER_ADMIN`. Otherwise 401/403.

### Session
`GET session/` → `{"user": {"id","email","name","initials"}, "roles": ["platform_super_admin"]}`
(401 if not signed in, 403 `not_superadmin` if signed in without the role — the SPA shows an access-denied
page with a sign-out button).

### Dashboard
`GET dashboard/` →
```json
{
  "counts": {"institutions": 5, "active_institutions": 5, "users": 194, "active_users": 180,
             "pending_invitations": 12, "expired_invitations": 3, "pending_requests": 2},
  "attention": [
    {"kind": "seats_near_cap", "institution": {"slug","name"}, "seats": {"used": 95, "cap": 100}},
    {"kind": "expired_invitations", "count": 3},
    {"kind": "pending_requests", "institution": {"slug","name"}, "count": 2}
  ],
  "recent_institutions": [{"slug","name","created_at","seats": {...}}],
  "recent_activity": [AuditEntry]   // latest 10
}
```
`seats_near_cap` = used ≥ 90% of cap.

### Institutions
`GET institutions/?q=&status=active|suspended|deactivated&page=` → results of
```json
{"id","slug","name","type","sector","status","seats": {"used","cap"},
 "admins": [{"id","name","email"}],          // first 3 active admins/owners
 "members_count": 15, "pending_invitations": 2, "pending_requests": 0, "created_at"}
```
Default excludes `deactivated` unless `status=deactivated` is asked.

`GET institutions/directory/?q=` → `{"results": [{"name","short_name","sector","suggested_slug","offices"}]}` (max 20):
BdREN full members (`apps/organizations/data/bdren_members.json`, 120 institutions from bdren.net.bd, retrieved
2026-11-18) matching `q` by name (contains) or short name (prefix), excluding any already created (same slug or name).
The Create institution form and the invite dialog's "create new institution" step use it as name suggestions;
picking one fills name, slug, type `university` and sector. Free text is still allowed.

`GET institutions/options/?q=` → `{"results": [{"slug","name","status","seats"}]}` (max 20, for pickers).

`POST institutions/` body:
```json
{"name": "Example University", "slug": "example-university", "type": "university", "sector": "public",
 "timezone": "Asia/Dhaka", "contact_email": "", "sign_in_domains": ["example.edu"],
 "seat_cap": 200,
 "admin": {"email": "admin@example.edu", "name": "Admin Name"}}   // optional; when present also invites
```
→ 201 `{"institution": InstitutionDetail, "invitation": Invitation|null, "email_sent": true|false}`.
Org + `Account(type=organization)` + optional invitation in one transaction (`create_organization`).
Slug: `[a-z0-9-]{2,64}`, unique (409 `slug_taken`). No ZITADEL org is created in this phase.

`GET institutions/<slug>/` → `InstitutionDetail`:
```json
{"id","slug","name","type","status","timezone","contact_email","sign_in_domains",
 "seats": {"used","cap"}, "seat_cap_reason",
 "counts": {"members": 15, "active": 14, "suspended": 1, "pending_invitations": 2,
            "expired_invitations": 0, "pending_requests": 1},
 "admins": [{"membership_id","user_id","name","email","role"}],   // all active owner/admin
 "created_at","updated_at"}
```

`PATCH institutions/<slug>/` — any of `name`, `type`, `timezone`, `contact_email`, `sign_in_domains`,
`seat_cap` (null allowed), `reason` (**required when `seat_cap` changes**; 400 otherwise). Lowering the cap
below `seats.used` is allowed but returns `"warning": "over_cap"` in the response.

`POST institutions/<slug>/suspend/` `{"reason"}` · `POST institutions/<slug>/reactivate/` `{"reason"}` ·
`POST institutions/<slug>/deactivate/` `{"reason", "confirm": "<exact institution name>"}` (400
`confirm_mismatch` otherwise). Deactivate also revokes pending invitations.

`GET institutions/<slug>/members/?q=&status=active|suspended|pending|deprovisioned&role=&page=` → results of
`Member`:
```json
{"membership_id","user": {"id","name","email","status"},"role","status","joined_at"}
```

`GET institutions/<slug>/history/?page=` → `AuditEntry` list where target is the institution or one of its
memberships/invitations (store `metadata.organization_id` on those entries so this is one indexed query).

`POST institutions/<slug>/import/` body `{"rows": [{"email","name","role"}], "dry_run": true}` (max 1000 rows) →
```json
{"rows": [{"index": 0, "email": "a@x.edu", "status": "ok|error|skip", "reason": "invalid_email|duplicate_in_file|already_member|already_invited|bad_role|over_cap|domain_not_allowed"}],
 "summary": {"ok": 120, "error": 3, "skip": 5, "fits": 120, "seats": {"used","cap"}},
 "created": 0, "email_failures": 0, "email_queued": 0}
```
`dry_run=false` creates the `ok` rows that fit (all or nothing per row, in file order, stopping at the cap;
rows past the cap get `over_cap`) and sends emails after commit (beyond `INVITATION_INLINE_EMAILS` they are
queued for the mailer). Role defaults to `member`. `duplicate_in_file` marks a repeat of an email an earlier row
already invites (`ok`); a repeat of a rejected row is judged on its own.
`domain_not_allowed` applies when `sign_in_domains` is non-empty and the email domain is not in it.

### Memberships
`PATCH memberships/<id>/` `{"role"?, "status"?: "active"|"suspended", "reason"?}` — activating
(from pending or suspended) is seat-checked. 409 `last_admin` if it would leave an active institution
with no active owner/admin (superadmin can still do it with `"force": true`).
`POST memberships/<id>/remove/` `{"reason"}` → status `deprovisioned` (frees the seat).

### Users
`GET users/?q=&status=active|suspended|deactivated&institution=<slug>&role=&page=` → results of
```json
{"id","name","email","email_verified","status","created_at","last_login_at",
 "memberships": [{"membership_id","institution": {"slug","name"},"role","status"}],
 "is_superadmin": false}
```
`q` matches name or email. `last_login_at` = `last_login_sync_at`.

`GET users/<id>/` → the same plus `"zitadel_subject"`, `"issuer"`, `"external_identities"`,
`"recent_activity": [AuditEntry]` (actor or target = this user, latest 20).

`PATCH users/<id>/` `{"status": "active"|"suspended", "reason"}` — a suspended user cannot sign in
(existing `is_active` check) and their sessions are ended (the `UserSession` rows written at sign-in name them,
so only that user's sessions are read and deleted).
A superadmin cannot suspend themself (409 `cannot_suspend_self`).

### Invitations
`Invitation` shape:
```json
{"id","email","name","institution": {"slug","name"}|null,"role" /* null for individual invites */,"status","source",
 "invited_by": {"id","name","email"}|null,"expires_at","created_at","last_sent_at","sent_count","email_status",
 "accepted_by": {"id","name","email"}|null,"accepted_at"}
```
`GET invitations/?q=&status=pending|accepted|revoked|expired&institution=<slug>&page=`

`POST invitations/` — one of:
```json
{"institution": "<slug>", "email", "name", "role": "admin"}
{"new_institution": {<same body as POST institutions/ minus "admin">}, "email", "name", "role": "admin"}
{"institution": null, "email", "name"}            // individual user, no institution; role ignored
```
→ 201 `{"invitation": Invitation, "institution": InstitutionDetail|null, "email_sent": bool}`.
`new_institution` creates the institution and the invitation in one transaction (no half-made institution).
Inviting into a `suspended` institution is allowed (response includes `"warning": "institution_suspended"`);
`deactivated` → 409 `institution_inactive`. Already an active member → 409 `already_member`. Seat-checked.

`POST invitations/<id>/resend/` · `POST invitations/<id>/revoke/` `{"reason"?}` (only `pending`/`expired`,
else 409 `invitation_not_pending`) ·
`POST invitations/resend-expired/` `{"institution"?: "<slug>"}` → `{"resent": n, "email_failures": m, "email_queued": q}`
(skips rows whose person is now an active member or whose domain is no longer allowed).

### Admins & roles
`GET admins/` → `{"results": [{"user": {"id","name","email","status"}, "granted_at"}]}` (superadmins).
`POST admins/` `{"user_id"}` or `{"email"}` (must match exactly one existing user with that **verified** email,
else 404/409 `ambiguous_email`; unverified accounts never match, use the user id) · `DELETE admins/<user_id>/` — cannot remove yourself or the last superadmin (409).

### Audit
`AuditEntry`:
```json
{"id","action","target_type","target_id","actor": {"id","name","email"}|null,"metadata": {},"ip_address","created_at"}
```
`GET audit/?q=&action=&actor=<user_id>&target_type=&target_id=&from=&to=&page=`

## Portal API (institution admins) — `/api/v1/portal/`

Permission: signed in, and for `<slug>` routes an **active** membership in that institution with role
`owner` or `admin`, and the institution is `active` (suspended → 403 `institution_suspended`). Superadmins
do **not** get implicit access here.

`GET institutions/` → institutions where the user is an active owner/admin: `[{"slug","name","status","seats","role"}]`.
Suspended institutions are included (`status: "suspended"`) so the profile menu can lead to the page that explains
the suspension; deactivated ones are not.
`GET institutions/<slug>/` → `{"slug","name","seats","counts","sign_in_domains"}`.
`GET institutions/<slug>/members/` — same filters/shape as the superadmin members list.
`GET institutions/<slug>/invitations/?status=` — same `Invitation` shape (without `invited_by.email`).
`POST institutions/<slug>/invitations/` `{"email","name","role": "member"|"admin"}` (owner/billing → 400 `bad_role`).
`POST institutions/<slug>/invitations/<id>/resend/` · `.../revoke/`.
`POST institutions/<slug>/import/` — same as superadmin import, roles limited to member/admin.
`PATCH institutions/<slug>/members/<membership_id>/` `{"role": "member"|"admin", "status": "active"|"suspended"}` —
cannot change an `owner`, cannot change yourself, cannot leave zero active owner/admin; activation is seat-checked.
`POST institutions/<slug>/members/<membership_id>/remove/`.
They cannot change `seat_cap`, sign-in domains, or anything else on the institution.
All actions audited with `metadata.source = "portal"` and `metadata.organization_id`.

## Invitation acceptance — `/api/v1/invitations/`

`GET <token>/` (public, throttled) → `{"status": "pending|accepted|revoked|expired", "email_masked": "a***@example.edu",
"email": "<full, only if the signed-in user's email matches, else null>", "institution": {"name"}|null, "role", "invited_by_name", "expires_at",
"signed_in": bool, "email_matches": bool}`. Unknown token → 404 (same body shape as expired is fine; do not leak which).

`POST <token>/accept/` (signed in) → requires `status=pending`, not expired, and the signed-in user's
**verified** email equal (case-insensitive) to the invitation email (403 `email_mismatch` /
`email_unverified`). Identity stays `(iss, sub)`; the email check only proves the invite reached this person.
Creates or updates the `Membership` (role from the invite, `status=active`; an existing pending sign-up
request is upgraded; a deprovisioned one is reactivated; an already active member gets the invited role only when
it ranks higher, member < billing < admin < owner, so an invitation never demotes) under the seat check, or for
individual invites ensures the personal `Account` exists. Marks the invitation `accepted`. →
`{"institution": {"slug","name"}|null,"role","redirect": "/profile" | "/portal/<slug>/members"}`, where `role` and
`redirect` follow the membership's resulting role.

## Frontends

### Admin SPA (`admin/`)
Vite + React 19 + TypeScript + TanStack Router + TanStack Query + Tailwind CSS 4 + Radix Dialog +
cmdk + lucide-react. Served at `/admin/` on the platform domain (`base: '/admin/'`), so it shares the
session cookie with the Django BFF. Dev: `vite` on `:5174` with a proxy for `/api` to `http://localhost:8000`.

Look: the Synapse admin panel (`~/Projects/synapse-admin-kb/DESIGN.md` tokens: teal `#186569`, orange
`#f5871f`, Inter, dark ground `#06161a`, 6–12px radii), light/dark/system theme, grouped collapsible sidebar,
⌘K command menu, KPI tiles, tables with search/filters/pagination, right-hand detail drawer, dialogs,
status chips. Rebuilt with small local primitives (no ClickHouse UI kit, no styled-components).

Sidebar (phase 0–1 pages live; later-phase pages shown with a "Soon" tag and an explanatory empty state):
```
OVERVIEW   Dashboard · Usage(soon)
CUSTOMERS  Institutions · Users · Invitations
BILLING    Billing(soon) · Subscriptions(soon)
PLATFORM   Configuration(soon) · Admins & roles · Audit log
SUPPORT    Help
```

### Next.js website (`frontend/`)
- `/invite/[token]`: shows the invitation (institution, role, inviter, expiry). Not signed in → "Sign in"
  (`/api/v1/auth/login/?next=/invite/<token>`) and "Create account" (`/register?next=/invite/<token>`; the full
  email is never shown to an anonymous visitor, so `email=<email>` is added only when the preview carries it).
  Signed in with a matching email → "Accept invitation". Mismatch → explains which email the invite was sent to and offers sign-out.
  Expired/revoked/accepted → clear message.
- `/portal/[slug]/members`: the institution-admin Members page (seat meter, members table with filters,
  invitations tab, Invite member dialog, Import CSV with preview, row actions per the portal API).
- Profile menu / profile page: a link to each institution's Members page when the user administers one;
  the "admin console" link points to `/admin/` and shows only for superadmins (profile `is_superadmin`).
- The old Next.js admin page (`app/admin`, `components/AdminDashboard.tsx`) is removed; nginx routes `/admin/`
  to the SPA.

---

# Phase 2a: Configuration → Packages (and Apps & features)

Configuration becomes a real page with tabs **Packages** and **Apps & features** (Billing, Invitations,
Email and Defaults tabs come later). Packages are the catalog BdREN AI sells: a **single** package
belongs to one app; a **combined** package (bundle) includes several or all apps under one price.

## Data model changes

### `Product` (apps.products) — the apps
Seed (`seed_bdren_catalog`, idempotent) ensures four apps with the website's slugs and names:
`synapse` Synapse, `mindspear` Mindspear, `mail-wizard` AI Mail Wizard, `quigen` QuiGen (descriptions from
`frontend/src/content/products.ts`; fix Synapse's wrong description). New fields: `sort_order` int (default 0),
`updated_at`. Existing features stay; new apps start without features.

### `Feature` — what a limit measures
Unchanged fields. Superadmins add/edit features per app (key `[a-z0-9_]{2,64}` unique per app, name, unit,
description, quota_policy, status). A feature in use by any package version cannot change `key` or `unit`
(409 `feature_in_use`); it can be set inactive.

### `Package`
| field | change |
|---|---|
| `kind` | new: `single` / `bundle`, default `single` |
| `product` | becomes **nullable**: required for `single`, null for `bundle` |
| `slug` | unique per product for singles; unique among bundles (partial unique index where product is null) |
| `audience` | new char(255), blank — "who it is for" line shown on pricing |
| `price_unit` | new: `per_seat` / `per_institution` / `flat`, default `per_seat` |
| `is_public` | new bool default true — shown on the public pricing page |
| `highlight` | new bool default false — "recommended" badge |
| `sort_order` | new int default 0 |
| `updated_at` | new |
| `price`, `currency`, `billing_interval`, `trial_days` | kept as the **current published values** (denormalised from the latest version, updated on publish) so existing catalog/subscription code keeps working |
| `status` | `active` / `inactive` / `archived` (archive = no new subscribers; never delete) |

### `PackageVersion` — immutable commercial snapshot
New fields: `price` decimal, `currency`, `billing_interval`, `price_unit`, `trial_days`, `seat_limit`
(positive int, null = unlimited; feeds the institution seat cap default in a later phase),
`change_reason` text (required for v2+), `created_by` FK User null, and `products` M2M Product
(the apps included in this version; exactly `[package.product]` for singles, ≥ 2 apps for bundles).
Data migration fills these for existing versions from their package.

### `PackageLimit`
`limit_period` gains `weekly`. A limit's feature must belong to one of the version's included apps
(400 `feature_not_in_package`). New field `on_limit`: `block` / `warn`, default `block`.

`Subscription.product` stays as is in this phase (bundle subscriptions are wired in the Subscriptions phase);
nothing here creates subscriptions.

## Superadmin API additions (`/api/v1/superadmin/config/`)

All superadmin-only, same conventions and error shapes as above, every mutation audited
(`metadata.package_id` / `metadata.product_id`).

### Apps & features
`GET config/apps/` → `{"results": [{"id","slug","name","description","status","sort_order",
"features": [Feature], "packages": {"single": n, "bundle": n}}]}`
`Feature` = `{"id","key","name","unit","description","quota_policy","status","in_use": bool}`
`PATCH config/apps/<slug>/` `{"name"?, "description"?, "status"?, "sort_order"?}`
`POST config/apps/<slug>/features/` `{"key","name","unit","description"?,"quota_policy"?}` → 201 Feature (409 `key_taken`)
`PATCH config/features/<id>/` `{"name"?,"unit"?,"description"?,"quota_policy"?,"status"?,"key"?}` (409 `feature_in_use` for key/unit)

### Packages
`PackageRow`:
```json
{"id","kind","name","slug","status","audience","is_public","highlight","sort_order",
 "apps": [{"slug","name"}], "price": "1500.00", "currency": "BDT", "billing_interval": "monthly",
 "price_unit": "per_seat", "trial_days": 14, "seat_limit": 100|null,
 "current_version": 3, "subscribers": 12, "updated_at"}
```
`GET config/packages/?kind=single|bundle&app=<slug>&status=&q=&page=` → paginated `PackageRow` (ordered by kind
bundle first, then app sort_order, then sort_order, name). `app` matches singles of that app and bundles including it.
Without `status` the list leaves out archived packages (like institutions leave out removed ones); `status=archived` shows them.

`POST config/packages/` body = `PackageDraft`:
```json
{"kind": "bundle", "app": "<slug>" (single only), "apps": ["synapse","mindspear","mail-wizard","quigen"] (bundle only),
 "name","slug","description","audience","is_public","highlight","sort_order",
 "price": "4500.00","currency": "BDT","billing_interval": "monthly|yearly|free","price_unit","trial_days","seat_limit",
 "limits": [{"feature_id","limit_value","limit_period": "daily|weekly|monthly|yearly|lifetime","on_limit": "block|warn"}]}
```
→ 201 `PackageDetail` (creates v1). Validation: free ⇒ price 0; paid ⇒ price > 0; bundle needs ≥ 2 active apps (a new version may keep an
included app that has since become inactive, but cannot add one);
duplicate feature in limits → 400; slug rules as above (409 `slug_taken`).

`GET config/packages/<id>/` → `PackageDetail` = `PackageRow` + `"description"`, `"limits": [Limit]` (current version,
each with `"feature": {"id","key","name","unit","app": {"slug","name"}}`), and
`"versions": [{"version","created_at","created_by": {"id","name","email"}|null,"change_reason","migration_policy",
"price","billing_interval","price_unit","trial_days","seat_limit","apps": [...],"limits": [Limit],"subscribers": n}]` (newest first).

`PATCH config/packages/<id>/` — presentation only, no new version: `name, description, audience, is_public,
highlight, sort_order`. Anything commercial (price, interval, price_unit, trial, seat_limit, apps, limits) → 400
`use_new_version`.

`POST config/packages/<id>/preview/` body = the commercial part of `PackageDraft` → no writes;
`{"changes": [{"field": "price", "from": "1500.00", "to": "1800.00"} | {"field": "limit", "feature": {...}, "from": {...}|null, "to": {...}|null} | {"field": "apps", "added": [...], "removed": [...]}],
"affected": {"subscriptions": n, "institutions": [{"slug","name","subscription_id","status"}]}}`
(affected = active/trial subscriptions on any version of this package; a personal account's subscription has
`"slug": null` and its owner's name). Empty `changes` → the UI says nothing changed. Commercial fields left out of a
preview or version body keep the current version's values.

`POST config/packages/<id>/versions/` body = commercial `PackageDraft` + `"change_reason"` (required, 400 otherwise)
+ `"migration_policy": "new_only|immediate|on_renewal|selected_only"` (required) + `"selected_subscriptions": [ids]` (selected_only)
→ 201 `{"package": PackageDetail, "migrated": n, "scheduled": n}`. Reuses `publish_new_package_version`
(extend it for the snapshot fields; keep its behaviour and tests). No changes → 400 `no_changes`.

`POST config/packages/<id>/archive/` `{"reason"}` · `POST config/packages/<id>/restore/` `{"reason"}` → `PackageDetail`.
The reason is required (400); archiving an archived package is 409 `already_archived`, restoring one that is not
archived is 409 `not_archived`.
Archived packages are hidden from the public catalog and cannot get new subscribers; existing ones keep running.

`GET /api/v1/catalog/products/` (public) keeps its shape for singles and excludes archived/non-public packages;
add a top-level `"bundles": [...]` list with the same package shape plus `"apps"`. Only active apps are offered: a
bundle lists its active apps and their limits, and is left out when fewer than two are active; single packages of an
app that is not active are neither listed nor subscribable (`catalog/subscribe/` → 404 `package_not_found`).

## Admin SPA
`/configuration` replaces the Soon page: tabs **Packages** (default) and **Apps & features**.
- **Packages**: segmented filter All / Combined / Single, app filter, status filter, search; table grouped
  "Combined packages" then one group per app; columns name (+ audience, Public/Hidden and Recommended chips),
  apps (chips; "All apps" when a bundle includes every active app), price (৳ formatted, "per seat / month"),
  trial, seat limit, version, subscribers, status; row → detail. Buttons "New combined package" and "New package".
- **Package editor** (create and new-version, one component): kind (fixed when editing), app (single) or app
  checklist with "All apps" shortcut (bundle), name, slug (auto from name, editable only at create), audience,
  description, price + unit + interval, trial days, seat limit, public/recommended toggles, **limits table**
  grouped by app: feature (only features of included apps), value, period, on limit; add/remove rows.
  On save of an existing package: **Review changes** step showing the preview diff and affected institutions,
  migration timing radio (with a plain sentence for each), selected institutions when "Selected", required reason, then Publish.
- **Package detail** page `/configuration/packages/$id`: summary card, current limits by app, version history
  (expandable, with what changed per version), actions Edit details (presentation PATCH), New version, Archive/Restore.
- **Apps & features**: one card per app with its features table (key, name, unit, quota policy, status, in use),
  add/edit feature dialog; app name/description/order edit.
