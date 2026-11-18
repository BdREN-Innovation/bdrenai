# BDREN AI Superadmin Panel: plan

The platform superadmin console for BDREN AI. One place to manage every app (Synapse, Mindspear, …),
its packages and subscriptions, usage across apps, institutions, and institution-admin invitations.

It copies the look and structure of the Synapse admin panel (`dev-chat.bdren.ai/adminpanel`, source in
`~/Projects/synapse-admin-kb`), but sits one level higher: Synapse's panel manages one app's tenants; this
one manages the platform that sells all apps to institutions.

Written 2026-11-18 from a read-only walk of the Synapse admin panel and the bdrenai code at `232034a`.

---

## 1. What the Synapse admin panel does (reference)

| Page | What it shows | Patterns worth copying |
|---|---|---|
| **Dashboard** | Quick-link cards to every section; "Getting around" help (sidebar, ⌘K) | Card grid with icon + one-line description |
| **Usage** | Institution picker, range chips (7d / 30d / This month / Last month / Custom), Export. Six KPI tiles with ▲▼ change vs previous period (tokens, requests, tokens/request, members with usage, models used, cost). Daily bar chart with 7-day average and Tokens/Requests toggle. "By model" table with share bars. "By member" table, paginated | KPI tile with delta, range picker, share-bar table, CSV export |
| **Users** | "194 active · 187 pending invites · 9 institutions" summary. Status tabs (All / Active / Invited / Expired / Suspended), search, role and institution filters, Export, Resend invites. Row click opens a **right-hand drawer**: status chips, tokens / requests / credits, tokens by model, institution, joined date, sign-in method, role select, grant credits (package select + Grant), full-usage link, Suspend, Remove | List + detail drawer; status tabs; bulk resend |
| **Access** | Roles (ADMIN global, INSTITUTION_ADMIN per institution, USER) and Groups | Role list with scope badges |
| **Institutions** | Counts (institutions, active, seat caps). Search, **Create institution**, **Invite individual user**. Table: name, tenant id, seats used/cap, status, actions (Open, Invite admin, Suspend, Remove) | Inline row actions, destructive button styled red |
| **Create institution dialog** | Name, Tenant ID, Slug, Seat limit (blank = unlimited), **Initial admin email (required)**, Admin name → "Create institution and invite admin" | Create + invite in one step |
| **Institution detail** | Tabs: Overview, Members, Agents, Knowledge base, Usage & limits, Policy, History. Overview: end-chat switch with member message and contact link; "Nothing needs attention"; seats, active users, requests, tokens (≈ cost) with sparklines; adoption bars (joined / used 30d / used this week; invitations waiting/expired); most active members; most used models; administrators with Revoke; details (timezone, sign-in domains, created, slug, tenant id) | Detail page with tabs, attention banner, sparkline tiles, admin list |
| **Usage & limits** | Used / reserved / remaining tokens; per-model breakdown with limits; reset date in institution timezone; "shadow rollout gate" readiness metrics | Used-reserved-remaining trio |
| **Policy** | Versioned policy: mode (Shadow / Enforce), timezone, institution limit, per-member limit, per-model limits, **change reason**, Preview, Save version | Versioned config with reason + preview before save |
| **History** | Policy versions with reason and time | Audit timeline |
| **Agents**, **Configuration**, **Grants** | Synapse-specific (agent configs, YAML-backed settings, capability grants + audit log) | Grants' "Management / Audit log" tab pair |
| **Shell** | Grouped sidebar (Overview / People / Platform / Support), collapsible; ⌘K command menu; light/dark/system theme; user menu bottom-left | Whole shell |

Design system: `synapse-admin-kb/DESIGN.md` (teal `#186569` + orange `#f5871f`, Inter, 6–12px radii,
dark ground `#06161a`). Stack: TanStack Start + Router + Query, React 19, Tailwind 4, Radix Dialog, cmdk,
lucide icons.

## 2. What bdrenai already has

**Backend (Django, enough to start):**
- Catalog: `Product` (has `api_key_hash`), `Feature` (unit, quota policy), `Package` (price, BDT, interval, trial days), `PackageVersion` (migration policy: new_only / immediate / on_renewal / selected_only), `PackageLimit`.
- Customers: `Organization` (linked to a ZITADEL org), `Membership` (owner/admin/billing/member), `Account` (personal or organization), `InstitutionalIdentityProvider` (SAML/OIDC federation).
- Billing: `Subscription` + `SubscriptionHistory`, `PaymentRecord` (manual/offline, verify step).
- Quota: `Entitlement` (with overrides), `UsageCounter`, `UsageReservation`, `UsageEvent`.
- `AuditLog`; admin RBAC roles (platform_super_admin, identity_administrator, organization_administrator, product_manager, billing_administrator, support_administrator).
- Admin API `api/v1/admin/`: `summary/`, `users/` (GET, PATCH), `organizations/` (GET, POST), `catalog/` (POST only), `subscriptions/` (GET, POST), `usage-audit/` (GET).

**Frontend:** `frontend/src/components/AdminDashboard.tsx`, one 512-line component with tab buttons. Works as a demo; it is not a base to grow.

**Missing:**
- **Invitations**: no model, email, accept flow, resend or expiry.
- **List APIs**: no pagination, search, filters, or detail endpoints (one org, one user, one subscription).
- **Usage analytics**: `UsageEvent` exists, but there are no daily rollups by product / feature / organization / member, no previous-period comparison, and no cost.
- **Catalog editing**: no GET/PATCH for products, features or packages; no API-key rotation; no OIDC client registry per app.
- **App provisioning**: creating an institution here does not create the tenant in Synapse (or any other app).

## 3. Recommended approach

**Build a new `admin/` app in bdrenai by copying the Synapse admin shell, not by extending `AdminDashboard.tsx`.**

- Copy from `synapse-admin-kb`: `Sidebar`, `Header`, `CommandMenu`, `ThemeSelector`, `components/shared/*` (Card, Chips, FormDialog, KebabMenu, Pagination, RangePicker, SearchInput, StatusToggle, StickyActionBar, EmptyState, LoadingState, charts), `styles.css` tokens, `theme/`. Same stack (TanStack Start, Query, Tailwind 4).
- Serve it at `admin.bdren.ai` (nginx already reserves `ADMIN_DOMAIN`). The Next.js app keeps the public landing page and the customer portal.
- **Auth**: the existing Django BFF (ZITADEL login, `Secure; HttpOnly` session cookie). The panel never holds tokens. Every view checks the admin RBAC role server-side; the UI only hides what the role can't do.
- One design system across both consoles, so a later shared package is possible. Not needed now.

Why not port the look into Next.js 14: the Synapse components assume TanStack Router/Query and Tailwind 4, so a rewrite costs more than a copy, and the two panels would drift.

## 4. Information architecture

```
OVERVIEW      Dashboard · Usage
CUSTOMERS     Institutions · Users · Invitations
BILLING       Billing (bKash + manual) · Subscriptions
PLATFORM      Configuration (packages, apps, platform settings) · Admins & roles · Audit log
SUPPORT       Help
```

Not in this panel: **Agents** (agent creation stays inside each app, e.g. Synapse's own admin panel), Synapse's
model/endpoint configuration and capability grants. Packages and apps are not separate sidebar entries; they
live under Configuration.

### 4.1 Dashboard
- KPI tiles with change vs previous 30 days: active institutions, active users, active subscriptions, MRR (BDT), usage this month, invitations pending.
- **Needs attention** list (same idea as "Nothing needs attention right now"): subscriptions expiring in 14 days, bKash payments not settled, manual payments awaiting verification, failed payments, institutions over 90% of a limit, expired invites, apps with failing usage reporting.
- Usage by app (stacked bar, 30 days), revenue by app and by method (bKash / manual), newest institutions, latest payments.

### 4.2 Usage (cross-app)
Same layout as Synapse's Usage page, one level up:
- Filters: **App** (all / Synapse / Mindspear …), **Institution** (all or one), range chips + custom, Export CSV.
- KPI tiles: units used per main feature, requests, active users, institutions with usage, cost, change vs previous period.
- Daily trend chart (units / requests toggle, 7-day average).
- Tables: by app, by institution, by feature (share bars), by member (when one institution is chosen).
- Drill-down: a row links to the institution's Usage tab or the app's detail.

### 4.3 Institutions
- List: search; filters (status, app, package); columns: name, slug, apps subscribed (chips), package, seats used/cap (one cap for all apps, §4.10), renewal date, status; row actions: Open, Invite admin (opens the invite dialog of §4.5 with this institution already picked), Record payment, Suspend, Remove (typed confirmation).
- **Create institution** (one dialog, like Synapse): name, slug, type (university / research / government / other), contact, timezone, sign-in domains, **initial admin email + name (required)**, optional starting subscription (app + package + start date + trial). Submit creates the org, the ZITADEL org, the invitation and, if chosen, the subscription and the app tenant.
- **Detail tabs**:
  - *Overview*: attention banner, seats, active users, usage tiles with sparklines, adoption bars, administrators (invite / revoke), details.
  - *Subscriptions*: one card per app (package, version, status, period, renewal); actions: change package (choose migration timing), extend, suspend, cancel; history timeline.
  - *Members*: list + drawer like Synapse Users, scoped to this institution; **Add member**, **Import CSV**, **Resend invites** (§4.10). Seat meter at the top: "142 / 200 seats".
  - *Usage & limits*: used / reserved / remaining per app and feature; overrides (`Entitlement.is_override`) with reason and expiry.
  - *Sign-in*: email domains, federation (SAML/OIDC via `InstitutionalIdentityProvider`), auto-join role.
  - *Billing*: current package and paid-until date, payments (bKash and manual) for this institution, **Record payment** (opens §4.6 with the institution picked), receipts.
  - *History*: audit entries for this institution.
- **End access** switch per app (as in Synapse's "End chat access"), with the message members see.

### 4.4 Users
The **only place accounts are created**, for every app (§4.10). Copy of the Synapse Users page across all institutions, plus **Create user**, **Import CSV** and **Invite individual user** (no institution): status tabs (All / Active / Invited / Expired / Suspended), filters (institution, role, app), Export, Resend invites. Drawer: identity (ZITADEL subject, sign-in method, MFA on/off), memberships, per-app usage, role change, suspend, remove, **"Open in ZITADEL"** for support.

### 4.5 Invitations
- Table: email, institution, role, invited by, sent, expires, status (pending / accepted / expired / revoked).
- Actions: resend, revoke, copy link; bulk resend expired.
- **Invite institution admin** (button on this page, on the Institutions list and in ⌘K):
  1. **Institution**: a searchable picker listing every existing institution (name, slug, status, seats used/cap). Typing filters by name or slug.
  2. If it isn't in the list, the last entry is **"+ Create new institution '<typed text>'"**. Choosing it expands the same dialog with the new-institution fields (name prefilled from the search, slug, type, timezone, sign-in domains, seat limit) instead of opening a second dialog.
  3. **Admin**: email (required), name, role (institution admin by default; member or billing as options).
  4. Submit: "Send invite" for an existing institution, or "Create institution and send invite" for a new one. Both happen in one request, so a failed invite never leaves a half-made institution.
  5. A suspended institution can be picked, but the dialog warns that the admin can sign in only after it is reactivated.
- Invite flow: the superadmin enters email + role + institution → backend creates an `Invitation` (hashed single-use token, 7-day expiry) → email with link → the invitee signs in or registers through ZITADEL → the callback matches the token, creates the `Membership` with that role, and marks the invitation accepted. Identity is bound by `(iss, sub)` and never by email alone (as `OIDC_INTEGRATION_GUIDE.md` requires); the email only addresses the invite.

### 4.6 Billing (bKash + manual)
One page for every payment, whichever way it arrived. Tabs: **All payments · bKash · Manual · Awaiting action**.

- **Summary tiles** (range picker as on Usage): collected this period (BDT), via bKash, via manual, refunds, pending/failed, change vs previous period.
- **Payments table**: date, institution, package, amount (BDT), method (bKash / bank transfer / cheque / cash / other), reference (bKash `trxID`, or the bank/cheque number), status (pending, completed, failed, cancelled, refunded, awaiting verification), recorded by. Filters: institution, method, status, package, date. Export CSV.
- **Payment drawer**: all fields, the subscription it paid for (with the period it covers), bKash details (`paymentID`, `trxID`, payer MSISDN masked to the last 3 digits, time), attachments (bank slip), audit trail. Actions: Refund (bKash, partial or full, with reason), Void (manual only, with reason), Download receipt.
- **Per institution**: the same table, filtered, sits on the institution's *Billing* tab.

**bKash payments** (bKash Tokenized Checkout):
- **One payment per period** (no auto-debit). The panel sends no payment links. The institution admin pays from **our page**:
  1. Signs in to the BDREN AI portal (ZITADEL login) → *Billing*, which shows the current package, paid-until date and payment history. Each app (e.g. Synapse) also has **Renew** / **Upgrade** buttons that open this same portal page with the institution and package already chosen.
  2. **Renew**: same package, next period. **Upgrade**: pick a higher package and pay its **full price**; a **new period starts on the payment date** and the old period ends then (no proration, no credit for unused days). The summary says so before paying, e.g. "Synapse Pro, 18 Nov 2026 – 17 Dec 2026, ৳X. Your current Standard period ends today." **Downgrade**: an institution admin picks a cheaper package; nothing is charged now. The change is saved as *scheduled* and takes effect at the next renewal, when they pay the cheaper price. Until then they keep the current package; the Billing page shows "Switching to Standard on 17 Dec 2026" with a **Cancel change** button. If the institution is over the cheaper package's seat or usage limits, the page warns before scheduling.
  3. Our page shows a summary (institution, package, period, amount in BDT) and a **Pay with bKash** button.
  4. Our backend creates the bKash payment (amount, our payment id as invoice number) and sends the user to **bKash's own checkout page**. There the user enters their **bKash number, the OTP, and their PIN**, sees the amount, and confirms; bKash deducts it from their account. Our site never sees or stores the number in full, the OTP or the PIN.
  5. bKash redirects back to our callback → backend **executes** the payment and then **queries** it to confirm, before activating anything → the user lands on a "Payment successful" (or "failed / cancelled, nothing was charged") page with the receipt.
- On success: `PaymentRecord(provider=bkash, status=completed)`, the subscription for the chosen package is activated or extended, and both are audited.
- **Reconciliation**: a daily job queries bKash for every payment still pending after 30 minutes and settles it; the *Awaiting action* tab lists anything it could not settle. The callback is never trusted alone; activation needs the execute/query result.
- Credentials (app key/secret, username/password) live in server env only; the panel shows which mode is on (sandbox / live) and when the token was last refreshed, never the secrets.

**Manual payment** (button "Record payment" on this page and on each institution):
1. **Institution**: the same searchable picker as the invite dialog.
2. **Package**: pick app + package (current version shown with price, interval and limits). Defaults to the institution's current package; changing it is how a manual upgrade/downgrade is done.
3. **Period**: start date (defaults to the end of the current period, or today if none), length in billing intervals (1 month, 3, 12…), computed end date.
4. **Payment details**: amount (prefilled from package price × length, editable, a difference needs a note), currency BDT, method (bank transfer / cheque / cash / bKash paid outside the integration / other), reference number, payment date, payer name, attachment (slip/scan), notes.
5. **Preview**: "BdREN → Synapse Standard, 1 Dec 2026 – 30 Nov 2027, ৳X". Save records the payment as completed and activates/extends the subscription in one transaction. A **"Save as pending"** option keeps it for a second person to verify (uses the existing `PaymentRecord` verify step) when billing staff and approvers differ.

### 4.7 Subscriptions
- Table: institution, app, package + version, status (trial / active / past due / suspended / cancelled / expired), period, renews/expires, seats, last payment (method + date).
- Actions: change package, extend (opens *Record payment*, since every extension is tied to a payment or a recorded free grant with reason), suspend, cancel, reactivate; each writes `SubscriptionHistory` and `AuditLog`.
- Saved views: expiring in 30 days, past due, trials ending, **scheduled downgrades**.
- **One gentle reminder email** to the institution's admins when the subscription reaches its end date: plain wording that the period has ended and how to renew (pay with bKash in the portal, or contact BdREN for a manual payment). No payment link in the email, and no earlier countdown emails.

### 4.8 Configuration (platform-wide)
Replaces Synapse's Configuration/Agents/Grants pages. Everything here applies across the platform; changes are versioned with a reason, previewed before save, and listed in History, like Synapse's Policy tab. Tabs:

- **Packages**: per app, the package catalog. List: name, price (BDT), interval, trial days, current version, subscribers, status. Editor: name, description, price, interval, trial days, seat limit, **limits table** (feature × value × period), what happens at the limit (block / warn only). Saving creates a new `PackageVersion`; the preview shows **which institutions are affected** and asks for the migration timing (new subscribers only / immediately / at renewal / selected institutions) and a change reason. Version history with limit diffs. Archive (no new subscribers) instead of delete.
- **Apps**: the products sold (Synapse, Mindspear…): name, logo, status, **features** (key, unit, quota policy), OIDC client (client id, redirect URIs, post-logout URIs), server API key (last 4 shown, rotate, revoke), provisioning webhook URL and its health (last delivery, failures), usage-reporting health.
- **Billing**: bKash mode (sandbox/live) and status, invoice/receipt numbering prefix, company details on receipts, VAT/tax rate if any, grace period after expiry before suspension (e.g. 7 days), the end-of-subscription reminder (on/off, wording), allowed manual methods.
- **Invitations & sign-in**: invitation expiry (default 7 days), default role, allowed sign-in methods, MFA required for institution admins (yes/no; enforced in ZITADEL).
- **Email**: sender, templates (admin invitation, payment received, payment failed, expiry reminder, subscription suspended) with preview.
- **Defaults**: platform timezone (Asia/Dhaka), currency (BDT), default trial package for new institutions.
- **History**: every configuration version with who, when, reason and diff.

### 4.9 Admins & roles, Audit log
- **For now only the superadmin uses this panel.** Admins & roles lists the superadmin accounts and lets a superadmin add or remove another superadmin. Other staff roles (billing, support, product manager) already exist in the backend but get no UI until they are needed; the panel just checks for `platform_super_admin`.
- Audit log: filter by actor, action, target, date; detail drawer with metadata; export.

### 4.10 Accounts and seats (all apps)
Account and institution creation moves out of the apps into this panel. The apps (Synapse first) stop creating accounts themselves and only receive them.

- **One account per person** across the platform, keyed by their ZITADEL identity `(iss, sub)`. The same account signs in to every app the institution subscribes to (SSO).
- **Ways to create accounts** in this panel (superadmin):
  - *Invite institution admin* (§4.5).
  - *Add member* to an institution: email, name, role (member / institution admin) → invitation email.
  - *Import CSV* to an institution: email, name, role; preview with errors (bad email, duplicate, already a member elsewhere, over the seat cap) before sending; invites go out in the background.
  - *Invite individual user* with no institution (personal account), for people who buy alone.
- **Institution admins add their own members** from the **institution-admin portal** (the same BDREN AI portal page that has *Billing*, not this superadmin panel). Its *Members* page offers:
  - *Invite member* (email, name, role: member or institution admin of **their own** institution) and *Import CSV*, with the same preview and checks as the superadmin's import.
  - Resend / revoke invitations, suspend or remove members, change a member's role within the institution.
  - A seat meter ("142 / 200 seats"). Invites and imports are **blocked at the seat cap**; the message tells them to remove members or contact BdREN / upgrade. They cannot change the cap themselves.
  - Everything they do is audited and visible to the superadmin on the institution's *Members* and *History* tabs.
- **What a member gets**: access to **every app the institution has an active subscription for**. No per-app member list to keep in step. (Per-app access can be added later if an institution needs it.)
- **Seats are counted per institution across all apps**: one person = one seat, however many apps they use.
  - Counted: active members + pending invitations. Suspended members and expired/revoked invitations do not count.
  - The institution's **seat cap** is set on the institution, not on each subscription. By default it is the **highest seat limit among its active packages** (e.g. Synapse Standard 100 + Mindspear Basic 50 → 100); the superadmin can override it on the institution, with a reason.
  - At the cap, *Add member*, *Import CSV* and invite are blocked with a clear message ("200 / 200 seats: raise the cap or remove members"). The import preview shows how many rows fit.
  - Shown everywhere seats appear: Institutions list, institution Overview and Members, Dashboard "Needs attention" at 90%.
- **Moving existing app accounts here (Synapse)**: import Synapse's institutions and users into the platform once; users keep their password by importing their bcrypt hash into ZITADEL and are linked to their Synapse account by ZITADEL user id, so chats and institution stay (tested locally 2026-11-17, see `kb/gotchas/bdren-sso-zitadel-openid.md` in synapse). Users with Synapse 2FA set it up again in ZITADEL; Google-only users get a set-password email.

## 5. Backend work (Django, `backend/apps/`)

| Area | Work |
|---|---|
| Invitations | New `invitations` app: `Invitation(email, organization, role, token_hash, invited_by, expires_at, status, accepted_by)`; create / resend / revoke / accept endpoints; email sender; accept hook in the identities callback |
| Admin API v2 | `api/v1/admin/` REST resources with list (cursor pagination, search, filters), detail, create, update: organizations, users, memberships, invitations, products, features, packages, package versions, subscriptions, payments, entitlement overrides, audit |
| Usage analytics | Daily rollup table `UsageDaily(product, feature, organization, account, day, quantity, requests, cost)` filled from `UsageEvent` by a job; `GET admin/usage?product&org&from&to` returns tiles + series + tables, plus the previous period for deltas |
| Catalog / Configuration | Package and version CRUD with impact preview; feature CRUD; API-key rotate/revoke; app integration fields (redirect URIs, webhook URL); a versioned `PlatformSetting` store (billing, invitations, email templates, defaults) with reason and history |
| bKash | New `payments/bkash.py` client (grant/refresh token, create, execute, query, search transaction, refund) with timeouts and idempotency; callback endpoint that executes then queries before activating; `PaymentRecord` gains `provider=bkash`, `bkash_payment_id`, `bkash_trx_id`, `payer_msisdn_masked`, `raw_status`; reconciliation job for pending payments; sandbox in dev, credentials from env only |
| Manual payments | `POST admin/payments/manual` that, in one transaction, records the payment (method, reference, date, payer, attachment, notes), creates or changes the subscription to the chosen package version and period, and writes `SubscriptionHistory` + `AuditLog`; optional pending state for a second approver; attachments stored privately |
| Receipts | Numbered receipts (PDF) for every completed payment |
| Provisioning | Outbound webhook to each app on institution / subscription / membership changes (signed, retried, logged); in Synapse, a matching inbound endpoint and removal of its account-creation UI and self-registration |
| Seats | Institution `seat_cap` (+ override and reason); seat count = active memberships + pending invitations, computed in one query and checked inside the same transaction as each invite/import |
| Import | CSV import endpoint with dry-run preview; one-time migration command that imports Synapse institutions and users (ZITADEL bcrypt-hash import + linking) |
| Safety | All mutations audited with actor and reason; destructive actions need a typed confirmation and are soft (status changes), not deletes |
| Performance | Load an organization's subscriptions, counts and admins in parallel, not serially (bdrenai Postgres is local, but keep the pattern) |

## 6. Connecting apps (Synapse first)

Synapse already has institutions (tenants), seats, admins, invites and quota policy in its own Mongo
database. Pick one source of truth per concern before building the Institutions page:

| Concern | Proposal |
|---|---|
| Institution exists, members, seat cap, package limits | **Platform** owns them; it pushes to Synapse through a provisioning webhook: create/rename/suspend tenant, add/remove/suspend member and role, set limits. Synapse creates the user record on the webhook (or on first SSO login) and never on its own |
| Accounts, institution creation, admin and member invites, seat cap | **Platform only** (§4.10): the superadmin panel, and the institution-admin portal for each institution's own members. Synapse's panel loses *Create institution*, *Invite admin*, *Invite individual user*, *Create user*, *Import members* and *Resend invites*; Synapse self-registration is turned off; sign-in is SSO only |
| Agents, knowledge base, model settings, chat policy details | **Synapse** keeps them (its own admin panel) |
| Sign-in | ZITADEL for both (see `kb/gotchas/bdren-sso-zitadel-openid.md` in synapse: HTTPS issuer, `offline_access`, user migration by bcrypt-hash import) |
| Usage | Synapse reports usage to the platform (`/api/v1/usage/reservations/` + commit) or sends daily summaries; the platform shows the cross-app view, and Synapse's panel keeps its detailed view |

Open decision: whether Synapse **enforces** the platform's entitlements live (reserve/commit per request)
or only reports usage and receives limits by webhook. Webhook + report is much less coupling and fits the
current Synapse quota engine, which already enforces its own per-institution policy.

## 7. Phases

| Phase | Scope | Done when |
|---|---|---|
| 0. Shell | `admin/` app from the Synapse admin shell; ZITADEL login through Django; guard that only lets `platform_super_admin` in; sidebar, ⌘K, theme | A superadmin signs in at `admin.bdren.localhost` and sees an empty Dashboard |
| 1. Institutions, accounts, invitations | Admin API v2 for organizations/memberships/invitations; Institutions list, create-with-admin, detail Overview/Members; Users with create / import CSV; Invitations page; institution-wide seat cap and checks; email; **institution-admin portal Members page** (invite, import, resend, suspend, within the seat cap) | Create an institution, the admin gets an email, accepts, signs in through ZITADEL and appears as admin |
| 2. Configuration + manual billing | Configuration: Packages (versioned editor with impact preview), Apps, platform settings; Subscriptions; Billing page with **Record payment** (institution + package + period + payment details) | Record a manual payment for an institution with Synapse "Standard"; its subscription becomes active for the chosen period and shows on Billing and the institution |
| 3. bKash | bKash client; portal *Billing* page with Renew / Upgrade and Pay with bKash; Renew / Upgrade buttons in Synapse linking to it; callback, reconciliation job, refunds, receipts; bKash tab and tiles on Billing | A sandbox bKash payment activates the subscription; an abandoned one is settled by reconciliation; a refund shows on Billing |
| 4. Usage | Rollup job + usage API; Usage page; Dashboard tiles; institution Usage & limits tab; overrides | Usage reported by Synapse shows per app / institution / day with deltas |
| 5. Provisioning + Synapse cut-over | Webhooks to Synapse (tenant, members, limits, suspend); end-access switch; one-time import of Synapse institutions and users; remove account creation from Synapse's panel and turn off its self-registration | Creating an institution here creates the Synapse tenant with the right seat cap |
| 6. Hardening | Audit log page, exports, tests (Vitest + Django), accessibility pass, prod overlay | Tests green; every mutation audited |

## 8. Decided (2026-11-18)

- Inviting an institution admin starts from a picker of existing institutions; a new institution is created from the same dialog when it isn't listed.
- Billing uses **bKash** online, plus **manual payments** the superadmin records with payment details and the package for that institution.
- No agent creation here; agents stay in each app.
- **Configuration** holds package configuration and every other platform-wide setting.
- bKash renewal is **one payment per period** (no auto-debit). The panel sends **no bKash payment links**; the only renewal email is one gentle reminder when the subscription ends.
- Upgrades are **full price with a new period** starting on the payment date; no proration.
- **This panel creates every account and institution for all apps**; the apps stop creating accounts (§4.10, §6).
- **Seats are counted per institution across all apps** (one person = one seat).
- **Institution admins invite and import their own members** from the institution-admin portal, blocked at the seat cap; they cannot raise the cap.
- **Only the superadmin uses this panel for now**; other staff roles come later.
- Institution admins can **downgrade** themselves; it is scheduled and takes effect at the next renewal. The superadmin sees scheduled changes on the Subscriptions page and can cancel them.
- **Synapse cut-over**: tested end to end on the dev server first, then released to production for all institutions together (§9).
- Institution admins pay by signing in to the BDREN AI portal, or from **Renew / Upgrade** buttons in each app that open that portal page; bKash's own checkout collects number, OTP and PIN and deducts the amount.
- BdREN has a bKash merchant account; sandbox and live credentials will be added once approved. Until then the bKash phase is built and tested against the bKash sandbox and switched on from Configuration → Billing.

## 9. Synapse cut-over: dev first, then release

All institutions move together, once the whole switch has passed on the dev server (`dev-chat.bdren.ai`).

**On dev**
1. Run the platform stack (ZITADEL on HTTPS, Django, superadmin panel, portal) next to dev Synapse; register the Synapse OIDC client for the dev URLs.
2. Load a copy of production Synapse institutions and users into dev, then run the one-time import: institutions → platform organizations, users → ZITADEL (bcrypt hash, verified email) and memberships, Synapse users linked by ZITADEL user id.
3. Turn on SSO-only sign-in in dev Synapse, the provisioning webhook, and remove its account-creation screens.
4. Check, with real test accounts from several institutions:
   - an existing user signs in with their old password and sees their chats, institution and role;
   - a superadmin creates an institution and invites its admin; the admin accepts, signs in to Synapse, and the tenant exists there with the right seat cap;
   - an institution admin invites and imports members in the portal and is stopped at the seat cap;
   - a manual payment activates a subscription; a bKash **sandbox** payment, renewal, upgrade and scheduled downgrade work;
   - suspending an institution or member blocks access in Synapse;
   - users with Synapse 2FA and Google-only users get the right "set up again" / set-password emails;
   - counts match: users, memberships and seats per institution before vs after import.
5. Fix, re-import from a fresh copy, and repeat until every check passes on a clean run.

**Release**
1. Announce a short maintenance window; back up Synapse's database and the platform's Postgres.
2. Run the same import against production, then switch Synapse to SSO-only and the platform as the source of accounts.
3. Run the same checks with a few real users; keep the backups and the previous Synapse config ready to switch back if sign-in fails.

No open questions remain.
