# Superadmin panel: phase 0–1 contract

Shared contract for the backend (Django) and the two frontends (admin SPA with the platform and institution
consoles, Next.js website) built for
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
  `already_member`, `slug_taken`, `invitation_not_pending`, `member_of_other_institution`, `domain_taken`,
  `already_covered`, `needs_consent_invitation`, `not_covered`, `personal_plan_consent_required`). Framework failures use the same shape on all three
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
| `sign_in_domains` | JSON list of lowercase domains, default `[]` | validated (`example.edu`, no `@`, no scheme). A verified email on one of them (exact or a subdomain: `cse.du.ac.bd` matches `du.ac.bd`) confirms a sign-up's choice of this institution; empty = no sign-up is confirmed. **Unique across institutions**: a domain another institution lists → 409 `domain_taken` (create and PATCH). Invitations accept any email domain |
| `seat_cap` | positive int, null | null = unlimited. Phase 2 derives the default from packages; for now it is set by the superadmin |
| `seat_cap_reason` | text, blank | reason of the last cap change |
| `updated_at` | datetime auto_now | |

`status` keeps `active`/`suspended`/`deactivated` ("Remove" = deactivated).

### `Membership` (apps.organizations) — coverage and one institution per person
| field | type | notes |
|---|---|---|
| `coverage` | `institution`/`none`, default `institution` | `institution` = **covered**: on the institution's package, holds a seat while `active` or `suspended`. `none` = **affiliated** only: free tier (the product's BDREN free package) or a personal plan |
| `status` | `active`/`pending`/`suspended`/`deprovisioned` | `pending` = chose this institution at sign-up, awaiting a verified email on its domains (grants nothing, not shown in the portal). `deprovisioned` = taken out of the institution (superadmin removal) |

Constraint `uniq_membership_one_institution`: at most one membership per user whose status is not
`deprovisioned` (one person, one institution). Services check it first and answer 409
`member_of_other_institution` (the other institution is not named); a concurrent join that loses the race gets
the same code. Only BDREN AI staff (superadmin API) are told before anything is sent: the portal never learns that
an email belongs to another institution (its invitations and import rows go ahead as `invite`), and accepting such
an invitation is refused with that code. A pending sign-up request elsewhere does not block anything: joining through an invitation or an
institution's own sign-in drops it (`membership.request_dropped`, `reason: "joined_other_institution"`).
Migrations: `0005` adds `coverage` (`institution` for every existing row), `0006` sets pending rows to `none` and
**fails with a list of users** who are in more than one institution (deprovision the extra memberships, then
migrate again), `0007` adds the constraint.

Labels (`apps.invitations.services.membership_label`, shown as `Member.label`) for active/suspended memberships:
`covered` (coverage `institution`), `invited` (coverage `none` with a live invitation to their email here),
`personal_plan` (coverage `none` and a paid personal plan: a personal-account subscription that is active or
trial, not on a free package, not expired — `apps.subscriptions.plans.has_personal_plan`), `not_covered` (coverage
`none`, the free tier). Pending and deprovisioned memberships have `label: null`.

### `Subscription.auto_renew` (apps.subscriptions)
Boolean, default `true`. `false` = runs to `expires_at` and is not renewed: `renew_subscription` raises
`RenewalStopped` (the admin billing API answers 409 `renewal_stopped` for `renew`). Set by `stop_renewal(...)` when a
personal-plan user accepts an institution invitation with their consent (D1); writes a `SubscriptionHistory` row
(`manual_adjustment`) and a `subscription.renewal_stopped` audit entry (`metadata.organization_id`). No refund.
`resume_renewal(...)` sets it back to `true` (history row + `subscription.renewal_resumed` audit entry). It runs:
when that person leaves the institution's package before the plan expires (portal removal / uncover, or superadmin
removal: only the plans stopped by joining that institution); when BDREN verifies a payment for the subscription
(`verify_payment`, which then renews it); and on the admin billing API's
`{"action": "resume_renewal", "subscription_id"}` → `{"subscription_id", "auto_renew": true}`. The billing API's
subscription list carries `auto_renew`.

### `Notice` (apps.invitations)
One-off informational email (`kind: "covered"` = "<Institution> added you to its BDREN AI package"), stored
rendered and sent by the same outbox and mail worker as invitations (`email_status` queued/sending/sent/failed).

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
`sent_count`. Resend applies the same rules as a new invitation (`already_member`, `member_of_other_institution`)
and is refused with 429 `resend_too_soon` (`{"retry_after": seconds}`) within `INVITATION_RESEND_COOLDOWN_MINUTES`
(default 5) of the last email. Any email domain may be invited (a Gmail user joins by invitation).

An expired invitation is **superseded** when a new invitation to the same email in the same institution is
created, or when that person's membership becomes active (accepting, an approved sign-up request, reactivation,
institutional sign-in): it is set to `revoked` with an `invitation.revoked` audit entry whose `reason` is
`superseded` / `joined`, so it no longer counts as expired or offers Resend. When a member is covered directly
(invite/import of a free-tier member, "Add to package"), their live invitations are revoked as `joined` too.

## Coverage rules (institution admin plan, rules R0–R5 and D1)

- **R0 sign-up.** The sign-up form's institution choice creates a `pending`, `coverage: none` membership
  (`apps.organizations.services.request_institution`; nothing for someone already in an institution). When the
  email becomes verified (`/auth/register/verify/`, or any sign-in whose ID token says `email_verified`),
  `confirm_signup_institution(user)` runs: email on the institution's `sign_in_domains` (exact or subdomain) →
  `active`, `coverage: none` (audit `membership.confirmed`); otherwise the pending membership is deleted (audit
  `membership.request_dropped`, `reason: "domain_mismatch"` or `"institution_inactive"`) and the person belongs to
  no institution. People who chose no institution get nothing.
- **Institution IdP sign-in** (`urn:zitadel:iam:org:id` mapped to an organization) confirms affiliation the same
  way: the pending request (or a new membership) becomes `active`, `coverage: none`, role `member`, no seat. The
  IdP's `auto_join_role` is not applied: someone not on the package never gets an admin role. Someone in another
  institution signs in without joining (logged, no error).
- **Admin rights need coverage.** Only covered members can be owners/admins or be suspended: `update_membership`
  (both APIs) answers 409 `not_covered` for making an affiliated member owner/admin or suspending them, and the
  portal (`access`, `GET /portal/institutions/`) only admits active, covered owners/admins. A suspended affiliated
  membership (from before this rule) can still be reactivated.
- **R1 covered members** use the institution package and seats; the portal can change their role, suspend,
  reactivate and remove them.
- **R2 personal-plan members** (affiliated + paid personal plan) are read-only in the portal and shown only as
  name, email, joined date and label; no usage.
- **R3** affiliated free-tier members are listed as `not_covered`.
- **R4 upgrade.** Inviting or importing the email of an affiliated free-tier member (exactly one verified user
  with that email, active, `coverage: none`, no personal plan), or the portal's "Add to package", covers **the
  same membership** at once: seat-checked under the organization lock, role raised to the invited role when higher
  (never lowered), audit `membership.covered` (`metadata.via`: `invitation` / `import` / `add_to_package`), and a
  `covered` notice email. No invitation and no second account.
- **R5 removal.** Portal removal **uncovers**: `coverage: none`, `status: active`, `role: member`; the seat is
  freed, account and data stay, they are listed as `not_covered` again (audit `membership.uncovered`; last-admin
  rule applies). Superadmin removal still sets `deprovisioned`, which takes the person out of the institution
  (how BDREN support fixes a wrong institution). Either way, a personal plan that stopped renewing when they joined
  renews again (see `Subscription.auto_renew`).
- **D1 consent.** A personal-plan member is never covered directly (409 `needs_consent_invitation`); they get
  a normal invitation. The acceptance page tells them their plan will not renew, and the accept must carry
  `{"end_personal_plan": true}` (409 `personal_plan_consent_required` without it). Accepting covers them and sets
  each paid personal subscription `auto_renew: false` (it runs to its expiry, no refund).
- **D3** import over the cap: the dry run marks each `ok` row that will not fit with `reason: "over_cap"` (its
  `summary.fits` counts those that will), and the real run turns them into `error`/`over_cap` rows; nothing is cut
  silently.
- **Plan per app.** A covered member uses the institution's account for an app only when that account has a
  current subscription or entitlement for it; for any other app they are treated like an affiliated member
  (personal plan, else the app's BDREN free package), and `plan_source` says `personal`/`free` for that app.

## Seats (institution-wide, across all apps)

`seats_used(org)` = **covered** memberships (`coverage=institution`) that are `active` or `suspended` + pending
invitations not yet expired, one seat per person: a pending invitation to someone who already holds a seat is not
counted again. A suspended member keeps their seat. Affiliated (`coverage=none`) members, pending sign-up requests
and deprovisioned memberships do **not** count. `seat_cap=None` → unlimited. Covering someone who also holds a live
invitation adds no seat. (After the coverage migration, institutions with suspended members may show more seats in
use than before, possibly over their cap: `over_cap`.)

Every operation that adds seats (invite, import, cover/"Add to package", activating a covered membership from
pending or deprovisioned) locks the org row (`select_for_update`) and checks the cap inside the same transaction;
reactivating a suspended member needs no new seat. Over the cap → 409 `seat_cap_reached` with
`{"seats_used": n, "seat_cap": m}` in the body.

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
Coverage notices (`Notice`, subject `<Institution> added you to its BDREN AI package`, a link to
`<PLATFORM_PUBLIC_URL>/profile`) share the same inline limit, counters and mail worker.

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
`seats_near_cap` = used ≥ 90% of cap. `pending_requests` = sign-up requests still awaiting a verified email.

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
            "expired_invitations": 0, "pending_requests": 1, "not_covered": 3, "personal_plan": 1},
 "admins": [{"membership_id","user_id","name","email","role"}],   // all active owner/admin
 "created_at","updated_at"}
```

`PATCH institutions/<slug>/` — any of `name`, `type`, `timezone`, `contact_email`, `sign_in_domains`,
`seat_cap` (null allowed), `reason` (**required when `seat_cap` changes**; 400 otherwise). Lowering the cap
below `seats.used` is allowed but returns `"warning": "over_cap"` in the response. A sign-in domain that another
institution lists → 409 `domain_taken` with `fields.sign_in_domains` and
`"conflicts": [{"domain", "institution": {"slug","name"}}]` (also on `POST institutions/` and `new_institution`,
where the field is `new_institution.sign_in_domains`).

`POST institutions/<slug>/suspend/` `{"reason"}` · `POST institutions/<slug>/reactivate/` `{"reason"}` ·
`POST institutions/<slug>/deactivate/` `{"reason", "confirm": "<exact institution name>"}` (400
`confirm_mismatch` otherwise). Deactivate also revokes pending invitations.

`counts.members`/`active`/`suspended` (and `members_count` in the list) count covered members; `not_covered` and
`personal_plan` count active affiliated ones.

`GET institutions/<slug>/members/?q=&status=active|suspended|pending|deprovisioned&role=&coverage=institution|none&label=covered|invited|not_covered|personal_plan&page=` → results of
`Member`:
```json
{"membership_id","user": {"id","name","email","status"},"role","status",
 "coverage": "institution|none","label": "covered|invited|not_covered|personal_plan|null","joined_at"}
```

`GET institutions/<slug>/history/?page=` → `AuditEntry` list where target is the institution or one of its
memberships/invitations (store `metadata.organization_id` on those entries so this is one indexed query).

`POST institutions/<slug>/import/` body `{"rows": [{"email","name","role"}], "dry_run": true}` (max 1000 rows) →
```json
{"rows": [{"index": 0, "email": "a@x.edu", "status": "ok|error|skip",
           "reason": "invalid_email|duplicate_in_file|already_member|already_invited|member_of_other_institution|bad_role|over_cap",
           "action": "invite|cover|consent_invite|null"}],
 "summary": {"ok": 120, "error": 3, "skip": 5, "fits": 120, "actions": {"invite": 110, "cover": 8, "consent_invite": 2},
             "seats": {"used","cap"}},
 "created": 0, "covered": 0, "email_failures": 0, "email_queued": 0}
```
Each `ok` row says what the real run does: `invite` (new invitation), `cover` (an affiliated free-tier member,
covered at once and sent a notice, rule R4) or `consent_invite` (a personal-plan member, invited so they can
consent, D1). Each row adds one seat, except a `cover` row whose live invitation already holds one (none). The
dry run marks the `ok` rows that will not fit with `reason: "over_cap"` (they stay `ok`; `fits` counts the rest).
`dry_run=false` handles the `ok` rows that fit (in file order; rows past the cap get `error`/`over_cap` and
`action: null`), `created` = invitations, `covered` = memberships covered, and
sends emails after commit (beyond `INVITATION_INLINE_EMAILS` they are queued for the mailer). Role defaults to
`member`. `duplicate_in_file` marks a repeat of an email an earlier row already handles (`ok`); a repeat of a
rejected row is judged on its own. Any email domain is accepted; `member_of_other_institution` rows are skipped.
`already_member` covers covered members who are active or suspended.

### Memberships
`PATCH memberships/<id>/` `{"role"?, "status"?: "active"|"suspended", "reason"?}` → `Member`. Coverage is not
changed here. A covered membership that starts holding a seat again (from `pending` or `deprovisioned`) is
seat-checked; activating a `coverage: none` pending sign-up request confirms the affiliation only (no seat);
suspending keeps the seat and reactivating a suspended member needs none. Only covered members can be suspended or
made `owner`/`admin` (409 `not_covered`). Reviving a `deprovisioned` membership
while the person belongs to another institution → 409 `member_of_other_institution`. 409 `last_admin` if it would
leave an active institution with no active owner/admin (superadmin can still do it with `"force": true`).
`POST memberships/<id>/remove/` `{"reason"}` → status `deprovisioned`: takes the person **out of the institution**
(frees any seat; they can then join another institution). This is how BDREN support fixes a wrong institution.

### Users
`GET users/?q=&status=active|suspended|deactivated&institution=<slug>&role=&page=` → results of
```json
{"id","name","email","email_verified","status","created_at","last_login_at",
 "memberships": [{"membership_id","institution": {"slug","name"},"role","status","coverage",
                  "label": "covered|invited|not_covered|personal_plan|null"}],
 "is_superadmin": false}
```
`label` is `Member.label` (the institution Members tab shows the same). `q` matches name or email. `last_login_at` = `last_login_sync_at`.

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
→ 201 `{"outcome": "invited"|"covered", "invitation": Invitation|null, "member": Member|null,
"institution": InstitutionDetail|null, "email_sent": bool}`. `outcome: "covered"` = the email belongs to an
affiliated free-tier member of that institution, who was covered at once (R4): `invitation` is null, `member` is
their membership and `email_sent` refers to the notice. A personal-plan member gets an invitation (consent, D1).
`new_institution` creates the institution and the invitation in one transaction (no half-made institution).
Inviting into a `suspended` institution is allowed (response includes `"warning": "institution_suspended"`);
`deactivated` → 409 `institution_inactive`. Already an active covered member → 409 `already_member`; a member of
another institution (verified email) → 409 `member_of_other_institution`. Any email domain. Seat-checked.

`POST invitations/<id>/resend/` · `POST invitations/<id>/revoke/` `{"reason"?}` (only `pending`/`expired`,
else 409 `invitation_not_pending`) ·
`POST invitations/resend-expired/` `{"institution"?: "<slug>"}` → `{"resent": n, "email_failures": m, "email_queued": q}`
(skips rows whose person is now an active covered member there or belongs to another institution).

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

Permission: signed in (401 `not_authenticated`), and for `<slug>` routes an **active** membership in that institution
with role `owner` or `admin`, and the institution is `active`. Anyone without a membership there — another
institution's admin, a superadmin, an unknown slug — gets 404 `not_found`; a member there without an admin role gets
403 `not_institution_admin`; suspended institution → 403 `institution_suspended`, deactivated → 403
`institution_inactive`. Superadmins do **not** get implicit access here. Writes re-check access with the
organization row locked. Every write (and the usage CSV export) is audited with `metadata.source = "portal"` and
`metadata.organization_id`. Portal admins cannot change `seat_cap`, sign-in domains, or anything else on the
institution.

Paths below are relative to `/api/v1/portal/`. `<slug>` is the institution slug, `<id>` a membership UUID.

### Institutions

`GET institutions/` → institutions where the user is an active owner/admin:
`[{"slug","name","status","seats": {"used","cap"},"role"}]`. Suspended institutions are included
(`status: "suspended"`) so the profile menu can lead to the page that explains the suspension; deactivated ones
are not.

`GET institutions/<slug>/` → `{"slug","name","seats","counts","sign_in_domains"}` (`counts` as in
InstitutionDetail, with `not_covered` and `personal_plan`).

### Dashboard

`GET institutions/<slug>/dashboard/?product=<product slug>` — everything the Dashboard page needs in one call.
`product` (optional) narrows the usage panel to one app; unknown slug → 400 `invalid` (`fields.product`).
```json
{
  "slug": "du", "name": "University of Dhaka",
  "seats": {"used": 42, "cap": 100},
  "counts": {"covered_active": 38, "covered_suspended": 1, "not_covered": 12, "personal_plan": 3,
             "pending_invitations": 3, "expired_invitations": 1},
  "product": {"slug": "synapse", "name": "Synapse"},          // null = all apps
  "usage": {                                                  // null if the institution has no organization account
    "range": {"start": "2026-11-12", "end": "2026-11-18", "days": 7, "timezone": "Asia/Dhaka"},
    "summary": UsageSummary,                                  // vs the 7 days before
    "by_day": [UsageDay],                                     // 7 rows
    "top_members": [UsageMember]                              // at most 5, most quantity first
  },
  "packages": [{
    "subscription_id": "uuid",
    "product": {"slug","name"}, "package": {"name": "Campus", "version": 2},
    "status": "active|trial|past_due", "billing_interval": "monthly|yearly|free",
    "starts_at": "2026-01-01T00:00:00Z", "expires_at": "2026-12-31T00:00:00Z",   // expires_at may be null
    "auto_renew": true,
    "days_left": 43,                                          // whole days to expires_at (negative once past), null without expiry
    "expires_soon": false                                     // days_left <= 30
  }]
}
```
"This week" is the last 7 calendar days including today, in `BDREN_USAGE_TIMEZONE`; `summary.previous` is the 7
days before. `counts`: `covered_active`/`covered_suspended` are covered members (seat holders), `not_covered` are
active affiliated free-tier members (invited or not), `personal_plan` active affiliated members with a paid personal
plan. `packages` lists the institution account's subscriptions with status active, trial or past due, soonest
expiry first (`[]` if none). Personal-plan members never appear in `usage`.

### Members

`GET institutions/<slug>/members/?tab=&q=&status=&role=&label=&page=&page_size=`

| Query | Values |
|---|---|
| `tab` | `covered` (coverage `institution`, active or suspended), `not_covered` (coverage `none`, no paid personal plan; labels `not_covered` and `invited`), `personal_plan` (coverage `none`, paid personal plan). Omitted = all three. |
| `q` | name or email contains |
| `status` | `active`, `suspended` |
| `role` | `owner`, `admin`, `billing`, `member` |
| `label` | `covered`, `invited`, `not_covered`, `personal_plan` |

→ 200
```json
{"results": [Member | PersonalPlanMember], "count": 12, "page": 1, "page_size": 25,
 "tabs": {"covered": 40, "not_covered": 12, "personal_plan": 3}}
```
`tabs` counts each tab's members matching `q` only (not `status`/`role`/`label`/`tab`), so the tab badges follow
the search box. Removed (`deprovisioned`) members and pending sign-up requests are never listed or counted.
Newest first. `role` and `status` are not shown for personal-plan members, so those filters never match them, and
`tab=personal_plan` with `status` or `role` → 400 `invalid` (`fields.tab`). Any other value outside the lists above
→ 400 `invalid` with the parameter in `fields`.

`Member` (covered and not covered rows) as in the superadmin API:
`{"membership_id","user": {"id","name","email","status"},"role","status","coverage": "institution|none","label","joined_at"}`.

`PersonalPlanMember` (any row whose person is not covered and holds a paid personal plan, R2) carries **only**:
```json
{"membership_id": "uuid", "user": {"name": "Rahim", "email": "rahim@du.ac.bd"},
 "label": "personal_plan", "joined_at": "2026-11-18T07:00:00Z"}
```
(`label` is `invited` while they hold a pending consent invitation.) No user id, role, status, coverage or usage.

`PATCH institutions/<slug>/members/<id>/` `{"role"?: "member"|"admin", "status"?: "active"|"suspended", "reason"?}`
→ 200 `Member`. Covered members only. Errors: 400 `invalid` (neither role nor status, bad status), 400 `bad_role`
(owner/billing), 404 `not_found` (unknown, another institution's, or a pending sign-up request), 403
`personal_plan_member`, 409 `not_covered` (a not covered member: nothing to change), 409 `membership_removed`, 403
`cannot_change_self`, 403 `cannot_change_owner`, 409 `last_admin`. Suspending keeps the seat; reactivating a
suspended member needs none. Audit `membership.updated`.

`POST institutions/<slug>/members/<id>/remove/` `{"reason"?}` → 200 `Member` — **uncovers** a covered member (R5):
`coverage: none`, `status: active`, `role: member`, seat freed, `label: not_covered` (a `PersonalPlanMember` if
they pay for a personal plan). They keep their account and data and stay affiliated. Errors: 404 `not_found`, 403 `personal_plan_member`,
409 `not_covered`, 403 `cannot_change_self`, 403 `cannot_change_owner`, 409 `last_admin`. Audit
`membership.uncovered`.

`POST institutions/<slug>/members/<id>/cover/` `{"role"?: "member"|"admin", "reason"?}` — "Add to package" (R4)
for an active, not covered, free-tier member: the same account becomes covered, the role rises to `role` when
higher (never lower), open invitations to their email are revoked as `joined`, a "covered" notice is emailed.
→ 200 `{"member": Member, "email_sent": bool}` (`email_sent` false when the notice was queued for the mail
worker). Shares the invitation send rate limit (429 `throttled`). Errors:

| Status | `error` | When |
|---|---|---|
| 400 | `bad_role` | `role` is not member/admin |
| 404 | `not_found` | unknown, another institution's, pending sign-up request or removed |
| 409 | `already_covered` | the member is already covered (active or suspended) |
| 409 | `needs_consent_invitation` | the member pays for a personal plan: send an invitation (D1) |
| 409 | `seat_cap_reached` | no free seat; body adds `"seats_used": n, "seat_cap": m` |
| 409 | `not_coverable` | their membership changed meanwhile (no longer active and not covered) |

Audit `membership.covered` (`metadata.via: "add_to_package"`, `reason`, `role`, `previous_role` when raised).

### Invitations and import

`GET institutions/<slug>/invitations/?status=pending|accepted|revoked|expired&q=&page=` — same `Invitation` shape
(without `invited_by.email`).
`POST institutions/<slug>/invitations/` `{"email","name","role": "member"|"admin"}` (owner/billing → 400 `bad_role`)
→ 201 `{"outcome": "invited"|"covered", "invitation": Invitation|null, "member": Member|null, "email_sent"}`
(see superadmin `POST invitations/`).
`POST institutions/<slug>/invitations/<id>/resend/` · `.../revoke/`.
`POST institutions/<slug>/import/` — same as superadmin import, roles limited to member/admin.
The portal is never told that an email belongs to another institution: such invitations are created and import
rows come back `ok`/`invite` (no `member_of_other_institution` here); accepting is what refuses them.

### Usage

Usage is read from the daily rollup (`UsageDaily`) of the institution's organization account: only usage the
institution package paid for. Days are calendar days in `BDREN_USAGE_TIMEZONE` (default `Asia/Dhaka`), the zone
UsageDaily buckets by. Anyone who now holds a paid personal plan and is not a covered member of this institution
is left out of **every** figure (totals, days, features, apps, members), so their usage can't be read off by
subtraction. Usage with no recorded member (older events) stays in the totals but has no member row. People who
have since left the institution still appear in member rows, with `membership_id`, `coverage` and `label` null.

`GET institutions/<slug>/usage/?start=&end=&product=&limit=&offset=`

| Query | Default | Rule |
|---|---|---|
| `start` | `end` − 29 days | `YYYY-MM-DD`, inclusive |
| `end` | today | `YYYY-MM-DD`, inclusive; `start` ≤ `end`; at most 366 days in all |
| `product` | all apps | a product slug |
| `limit` | 50 | member rows per page, 1–200 |
| `offset` | 0 | member rows to skip, ≥ 0 |

→ 200
```json
{
  "range": {"start": "2026-10-20", "end": "2026-11-18", "days": 30, "timezone": "Asia/Dhaka"},
  "product": {"slug": "synapse", "name": "Synapse"},           // null = all apps
  "summary": {
    "start_day": "2026-10-20", "end_day": "2026-11-18",
    "quantity": 460, "requests": 7, "members_with_usage": 2, "features_used": 2,
    "previous": {"start_day": "2026-09-20", "end_day": "2026-10-19",
                 "quantity": 50, "requests": 1, "members_with_usage": 1, "features_used": 1},
    "change": {"quantity": 820.0, "requests": 600.0, "members_with_usage": 100.0, "features_used": 100.0}
  },
  "by_product": [{"product_id": "uuid", "product_slug": "synapse", "product_name": "Synapse",
                  "quantity": 440, "requests": 5}],
  "by_day": [{"day": "2026-10-20", "quantity": 0, "requests": 0, "quantity_avg_7d": 0.0}],
  "by_feature": [{"product_id": "uuid", "feature_id": "uuid", "product_slug": "synapse",
                  "feature_key": "tokens", "feature_name": "Tokens", "unit": "tokens",
                  "quantity": 440, "requests": 5, "share": 0.9565}],
  "members": {
    "results": [{"user": {"id": "uuid", "name": "Rahim", "email": "rahim@du.ac.bd"},
                 "membership_id": "uuid", "coverage": "institution", "label": "covered",
                 "quantity": 320, "requests": 5, "last_used": "2026-11-18"}],
    "total": 2, "limit": 50, "offset": 0
  }
}
```
- `summary` (`UsageSummary`): totals for the range and for the equally long range just before it; `change` is the
  percent change (one decimal), null when the previous value is 0.
- `by_product`: every app, most quantity first, **ignoring `product`** (it feeds the app switcher).
- `by_day` (`UsageDay`): one row per day of the range, zero-filled; `quantity_avg_7d` is the trailing 7-day average.
- `by_feature`: per app + feature, most quantity first; `share` of the range's total quantity (0..1).
- `members.results` (`UsageMember`): per person, most quantity first; `label` is their current label here
  (`covered`, `invited`, `not_covered`) or null if they left. `members.total` = people with usage in the range.
- Quantities are in each feature's own unit (tokens, requests, count), summed as stored.

Errors: 400 `invalid` with `fields.start` (bad date, or after `end`), `fields.end` (bad date, or range over 366
days), `fields.product` (unknown slug), `fields.limit`, `fields.offset`; 404 `no_usage_account` when the institution
has no organization account.

`GET institutions/<slug>/usage/export.csv?start=&end=&product=` — same range, product and rules as `usage/`, no
paging: every `UsageMember` row, streamed as `text/csv; charset=utf-8` with
`Content-Disposition: attachment; filename="<slug>-usage-<start>-<end>.csv"` and `Cache-Control: no-store`.
Columns: `name,email,label,quantity,requests,last_used` (a cell starting with `=`, `+`, `-`, `@`, tab or CR is
prefixed with `'`). Same errors as `usage/` (as JSON). Audited `usage.exported` (`target_type: "Organization"`,
`metadata.start`, `metadata.end`, `metadata.product`).

### Email domains

`GET institutions/<slug>/domains/` → 200 (read-only; BDREN platform admins change domains)
```json
{"domains": [{"domain": "du.ac.bd", "confirmed_members": 7}, {"domain": "bracu.ac.bd", "confirmed_members": 0}],
 "confirmed_members": 8, "other_domains": 1}
```
`confirmed_members` per domain = active or suspended members (covered or not, personal plan included; counts only)
whose email is on that domain or a subdomain of it (`x@cse.du.ac.bd` counts for `du.ac.bd`); a person whose email
fits two listed domains counts under each. The top-level `confirmed_members` is all active or suspended members;
`other_domains` those on none of the listed domains (people invited from another domain). Pending sign-up requests,
removed members and invitations are not counted. Domains are listed in the institution's order.

## Invitation acceptance — `/api/v1/invitations/`

`GET <token>/` (public, throttled) → `{"status": "pending|accepted|revoked|expired", "email_masked": "a***@example.edu",
"email": "<full, only if the signed-in user's email matches, else null>", "institution": {"name"}|null, "role", "invited_by_name", "expires_at",
"signed_in": bool, "email_matches": bool, "ends_personal_plan": bool, "personal_plan_ends_at": "<iso>"|null}`.
`ends_personal_plan` is true only for the matching signed-in user who holds a paid personal plan (into an
institution): the page asks for their consent (their plan will not renew; it runs to `personal_plan_ends_at`, the
latest expiry of their paid personal plans, null when one never expires or `ends_personal_plan` is false; no refund). Unknown token → 404 (same body shape as expired is fine; do not leak which).

`POST <token>/accept/` (signed in) → requires `status=pending`, not expired, and the signed-in user's
**verified** email equal (case-insensitive) to the invitation email (403 `email_mismatch` /
`email_unverified`). Identity stays `(iss, sub)`; the email check only proves the invite reached this person.
Creates or updates the `Membership` (role from the invite, `status=active`, `coverage=institution`; an existing
pending sign-up request or affiliated membership is upgraded; a deprovisioned one is reactivated; an already active
member gets the invited role only when it ranks higher, member < billing < admin < owner, so an invitation never
demotes), or for individual invites ensures the personal `Account` exists. A member of another institution → 409
`member_of_other_institution` (a pending sign-up request elsewhere is dropped instead). Body
`{"end_personal_plan": true}` is the consent of D1: a user who holds a paid personal plan must send it (409
`personal_plan_consent_required` otherwise, nothing changes), and each paid personal subscription is then set
`auto_renew: false`. Marks the invitation `accepted`. →
`{"institution": {"slug","name"}|null,"role","redirect": "/profile" | "/admin/portal/<slug>/members", "renewal_stopped": bool}`,
where `role` and `redirect` follow the membership's resulting role (an owner or admin is sent to Members in the
institution console of the admin app).

## Entitlements: which plan a person uses — `/api/v1/entitlements/`

One resolver (`apps.entitlements.services`): covered (active membership, `coverage=institution`, institution
`active`) → the institution's organization account; else a current personal subscription → the personal account;
else the product's BDREN free package (`Package.billing_interval = free`, active, oldest; latest active version's
limit for the feature) applied to the personal account. Apps need not send `organization_account_id`: the covering
institution's account is used automatically. An explicit `organization_account_id` must be an account the user
may use (only the covering institution's): otherwise 403. At service level an organization account whose
membership is not covered is simply not a candidate (no error); the free fallback applies only when no institution
covers the user for that product, so covered members never spend the free tier first. Coverage is per product: an
institution account with no current subscription or entitlement for the product does not cover it, so a covered
member uses their personal plan, else the free package, for that app (`plan_source` `personal`/`free` when
`product` is given; without a product, `institution` whenever covered).

`plan` object (also returned alone by `plan/`):
```json
{"institution": {"slug","name"}|null, "coverage": "institution"|"none"|null,
 "membership_status": "active"|"suspended"|null, "plan_source": "institution"|"personal"|"free"}
```
`institution` is the person's one institution (active or suspended membership, institution not removed). Apps gate
institution-only content (for example Synapse's knowledge base) on `plan_source == "institution"`.

- `POST check/` → the existing report plus `"plan"` (for the checked product).
- `GET current/` (session) → `{"entitlements": [...], "plan"}`; institution entitlements are listed only while covered.
- `GET plan/` / `POST plan/` (new) → `plan`. Browser session, or `X-Product-Api-Key` with `user_id` or
  `issuer` + `zitadel_subject` (query string for GET, JSON body for POST); optional `product` narrows
  `personal` to that product. 403 `forbidden` without valid credentials.

Profile (`GET /api/v1/auth/profile/`) memberships carry `coverage`; billing subscriptions carry `auto_renew`.

## Frontends

### Admin SPA (`admin/`)
Vite + React 19 + TypeScript + TanStack Router + TanStack Query + Tailwind CSS 4 + Radix Dialog +
cmdk + lucide-react. Served at `/admin/` on the platform domain (`base: '/admin/'`), so it shares the
session cookie with the Django BFF. Dev: `vite` on `:5174` with a proxy for `/api` to `http://localhost:8000`
(override with `ADMIN_DEV_PORT` and `ADMIN_DEV_API`; `VITE_WEBSITE_URL` sets where "BDREN AI website" links go,
default `/`).

It holds two consoles, chosen on load (navigation only: every API call is still checked on the server):

1. `GET /api/v1/superadmin/session/` (in parallel with `GET /api/v1/portal/institutions/` and
   `GET /api/v1/auth/profile/`). 200 → the **platform console** below.
2. 403 → the **institution console** if `portal/institutions/` lists at least one institution, else a no-access
   page with a link back to the website and Sign out.
3. 401 from any of them → `/api/v1/auth/login/?next=<current URL>`.

An institution admin who opens a platform route is sent to `/admin/portal/`. A superadmin who also administers an
institution gets an "Institution console" link beside their name in the sidebar (and a "Platform console" link
back from the institution console).

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

**Institution console** (`/admin/portal/…`, `admin/src/pages/portal/`, `admin/src/features/portal/`; reads and writes
only the Portal API above). Same frame as the platform console (collapsible sidebar, ⌘K, theme), its own sidebar
with the institution's name, and the user's links (Switch institution when they manage several, Platform console for
superadmins, BDREN AI website, Sign out):
```
OVERVIEW     Dashboard · Usage
PEOPLE       Members
INSTITUTION  Email domains
SUPPORT      Help
```
- `/admin/portal/` → the dashboard of the one institution the user manages, or a picker when there are several.
- `/admin/portal/<slug>/` → `dashboard`. The institution (`GET institutions/<slug>/`) loads once in the frame;
  403/404 explain a suspended or closed institution, a non-admin, or an unknown slug.
- `dashboard`: app switcher; KPI cards (seats, covered members, usage and requests this week vs the 7 days
  before); this week's usage by day; most active members; follow-ups (Not covered, pending and expired invitations,
  linking to `members?tab=…`); packages with expiry warnings.
- `usage`: app switcher (All apps + every catalog app); presets 7 days, 30 days, this month, last month, custom
  (calendar days in `Asia/Dhaka`, at most 366); KPI cards with change vs the previous period; usage by day with the
  7-day average; by-feature table with share bars; paginated by-member table; Export CSV
  (`/api/v1/portal/institutions/<slug>/usage/export.csv` for the same range and app). Only institution-paid usage.
- `members?tab=covered|invited|not_covered|personal_plan` (`&status=expired|accepted|revoked|all` on Invited; no
  `status` = pending): seat summary, Invite member (any email domain), Import CSV (dry-run preview, rows over the seat
  cap marked "Won't be imported", then the real import), one search box for every tab, tab counts from `tabs`.
  Covered: status/role filters, row actions (Make admin/member, Suspend, Activate, Remove = take off the package),
  a right-hand panel with the member's usage per app over 30 days (read from `usage/` member rows) and the removal
  consequence; the admin's own row and the owner are locked. Invited: status filter, Resend, Revoke. Not covered:
  Add to package (`cover/`) per row or for a selection, after a confirmation, never more than the free seats; a panel
  with Add to package and "Report to BDREN support". Personal plan: read-only rows (name, email, joined, label) with
  an explanation and a "Report to BDREN support" mailto link; no actions, no usage.
- `domains`: the sign-in domains with confirmed members (read-only) and a "Request a domain" mailto link.
- `help`: how seats, usage and domains work, and the BDREN support email.

### Next.js website (`frontend/`)
- `/invite/[token]`: shows the invitation (institution, role, inviter, expiry). Not signed in → "Sign in"
  (`/api/v1/auth/login/?next=/invite/<token>`) and "Create account" (`/register?next=/invite/<token>`; the full
  email is never shown to an anonymous visitor, so `email=<email>` is added only when the preview carries it).
  Signed in with a matching email → "Accept invitation". Mismatch → explains which email the invite was sent to and offers sign-out.
  Expired/revoked/accepted → clear message.
- `/portal/…` redirects to the institution console in the admin app (`<NEXT_PUBLIC_ADMIN_URL or /admin/>portal/…`);
  the website has no institution-admin pages of its own. After accepting an invitation, "Continue" follows
  `redirect`, sending `/admin/…` paths to the admin app.
- Profile menu / profile page: "Manage members" links to `<admin URL>portal/<slug>/members` for each institution the
  user administers; the "admin console" link points to `/admin/` and shows only for superadmins (profile
  `is_superadmin`).
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
