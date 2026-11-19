# Billing: manual payments and bKash (phase 3) — contract

Builds §4.6 Billing and §4.7 Subscriptions of `docs/SUPERADMIN_PANEL_PLAN.md` on top of
`feature/institution-admin` (d6171b2). Conventions (JSON, session auth, CSRF, error shape, pagination, audit
on every mutation with `metadata.organization_id`) are those of `docs/SUPERADMIN_API.md`.

Decided product rules (from the plan, §8):
- bKash is **one payment per period**, no auto-debit. The panel never sends payment links.
- Institution admins pay from the institution console (Renew / Upgrade buttons), then bKash's own checkout page
  collects number, OTP and PIN.
- **Upgrade** = full price of the new package, a new period starts on the payment date, the old period ends then.
- **Downgrade** = scheduled, takes effect at the next renewal (no charge now); cancellable until then.
- **Renew** = same package, next period starts at the current period's end (or now if already expired).
- Manual payment: the superadmin records payment details and picks the institution's package and period.
- One gentle reminder email to the institution's admins when a subscription reaches its end. No link in it.

bKash sandbox findings (verified 2026-11-18, `TR0011wEp5MBG1794997089896` / `DKI20PX90K`):
- Activate **only** after our own `execute` (or a status query) returns `transactionStatus: Completed`. The browser
  callback alone proves nothing.
- A status query right after execute can return `2033 Transaction Not Found`; retry a few times before concluding.
- `execute` on a payment that was not approved returns `2056 Invalid Payment State`; the payment stays `Initiated`.
- After a full refund, payment status still shows the original `maxRefundableAmount`: **track refunds ourselves**.
- API (tokenized checkout v1.2.0-beta, base `BKASH_BASE_URL` ending in `/tokenized/`):
  `checkout/token/grant` (headers `username`, `password`; body `app_key`, `app_secret`; `id_token` valid 3600 s),
  `checkout/create` (headers `Authorization: <id_token>`, `X-App-Key`; body `mode: "0011"`, `payerReference`,
  `callbackURL`, `amount`, `currency: "BDT"`, `intent: "sale"`, `merchantInvoiceNumber`; returns `paymentID`,
  `bkashURL`), `checkout/execute` `{paymentID}`, `checkout/payment/status` `{paymentID}`,
  `checkout/general/searchTransaction` `{trxID}`, `checkout/payment/refund` `{paymentID, amount, trxID, sku, reason}`
  (refund status: same endpoint with only `{paymentID, trxID}`). Success is `statusCode: "0000"`.

## Settings (env, never committed)
`BKASH_BASE_URL`, `BKASH_APP_KEY`, `BKASH_APP_SECRET`, `BKASH_USERNAME`, `BKASH_PASSWORD`, `BKASH_CALLBACK_URL`
(public URL of `GET /api/v1/payments/bkash/callback/`), `BKASH_TIMEOUT_SECONDS` (default 30).
bKash is "enabled" when key, secret, username and password are all set; otherwise checkout answers 503
`bkash_unavailable`. `BKASH_MODE` is derived for display: `sandbox` if the base URL contains `sandbox`, else `live`.
`ADMIN_PUBLIC_URL` (default `http://localhost:5174/admin`) is where the callback sends the browser back
(`<ADMIN_PUBLIC_URL>/portal/<slug>/billing?payment=<id>&result=success|failed|cancelled`).
`BILLING_RECEIPT_PREFIX` (default `BDR`). The id_token is cached (Django cache) for 55 minutes.

## Data model

### `Subscription` (apps.subscriptions)
- `product` becomes **nullable**: null for a combined (bundle) package. A subscription *covers* an app when
  `product == app` or (`product is null` and the app is in `package_version.products`).
- Creating a subscription for an account cancels the account's active/trial subscriptions that it covers:
  a bundle cancels the account's active singles of its apps and any active bundle; a single for an app the account
  already gets from an active bundle → `ValueError` (API: 409 `covered_by_bundle`).
- `pending_package_version` (exists) is the scheduled downgrade, applied at the next renewal.
- new `expiry_reminder_sent_at` (datetime, null): set when the end-of-period reminder was emailed; cleared on renew.
- Remove the bundle `ValueError` in `create_subscription`; update `sync_subscription_entitlements`, the plan
  resolver (`apps/entitlements/services.py user_plan`) and `apps/subscriptions/plans.py` so a bundle subscription
  counts for each app it covers.

### `PaymentRecord` (apps.billing) — extended, existing rows keep working
| field | notes |
|---|---|
| `account` | (exists) the paying account; institution payments use the organization `Account` |
| `subscription` | (exists) the subscription it created/extended, set on completion |
| `package_version` | FK PackageVersion, null for legacy rows: what was bought |
| `kind` | `new` / `renew` / `upgrade` (`legacy` for existing rows) |
| `method` | `bkash` / `bank_transfer` / `cheque` / `cash` / `bkash_manual` (paid by bKash outside the integration) / `other`. Data migration maps `provider`: manual_offline→other, bank_transfer→bank_transfer, institutional_invoice→other. Keep `provider` column for compatibility (set to the closest old value) or drop it after migrating every reader; prefer migrating readers. |
| `status` | `pending` (bKash created, or manual awaiting verification) / `completed` / `failed` / `cancelled` / `rejected` / `refunded` / `partially_refunded` |
| `amount`, `currency` | (exist) |
| `periods` | positive int, default 1: number of billing intervals bought |
| `period_start`, `period_end` | set on completion (manual: from the form) |
| `reference` | (exists) manual: bank/cheque/other reference; bKash: the `trxID` once completed |
| `payer_name`, `payment_date` | manual details (payment_date defaults to today) |
| `notes` | (exists) |
| `attachment`, `attachment_type`, `attachment_name` | optional bank slip: BinaryField ≤ 5 MB, PDF/PNG/JPEG checked by file signature, served only to superadmins and that institution's owners/admins |
| `recorded_by` | FK User: superadmin who recorded a manual payment, or the institution admin who started a bKash checkout |
| `verified_by`, `verified_at` | (exist) |
| `bkash_payment_id` | unique, null |
| `bkash_trx_id` | null |
| `bkash_payer_account` | masked to the last 3 digits, e.g. `********378` |
| `bkash_status` | last raw `transactionStatus` |
| `failure_reason` | short text for failed/cancelled |
| `receipt_number` | unique, assigned on completion: `<PREFIX>-<YYYY>-<6-digit sequence>` (sequence row-locked) |
| `refunded_amount` | decimal, default 0 |
| `created_at`, `completed_at`, `updated_at` | |

### `Refund` (apps.billing, new)
`payment` FK, `amount`, `reason` (required), `method` (`bkash` via API, or `manual` = recorded money returned
outside the system), `bkash_refund_trx_id`, `status` (`completed`/`failed`), `failure_reason`, `created_by`, `created_at`.
Total completed refunds may never exceed the payment amount (checked under a row lock on the payment).

## Pricing and periods (one service, used by every path)
`quote(account, package, kind)` → `{"package_version", "amount", "currency", "periods", "period_start", "period_end", "kind"}`:
- price = latest active version's `price` × `periods`; free packages cannot be bought (400 `free_package`);
  archived/inactive packages or packages of inactive apps cannot be bought (400 `package_unavailable`).
- `new`: no active/trial subscription covering the package's apps; starts now.
- `renew`: same package as the current subscription (or its scheduled downgrade target, which then applies);
  starts at `max(current.expires_at, now)`.
- `upgrade`: a different package with a higher per-period price than the current one; starts now, the current one
  ends now (cancelled with history "Upgraded").
- `period_end` = start + 30 days × periods (monthly) or 365 days × periods (yearly), matching `_default_expiry`.
Completing a payment applies exactly the quote stored on the payment (package_version, periods, start) inside one
transaction with the subscription change, and is idempotent (a completed payment is never applied twice).

## bKash flow
1. Institution owner/admin: `POST /api/v1/portal/institutions/<slug>/billing/checkout/` `{"package": "<package id>", "kind": "new|renew|upgrade"}`
   → validates via `quote`, creates `PaymentRecord(method=bkash, status=pending)`, calls bKash create
   (`merchantInvoiceNumber` = payment id without dashes, first 20 chars ok; `payerReference` = institution slug;
   `callbackURL` = `BKASH_CALLBACK_URL`) → 201 `{"payment": Payment, "redirect_url": "<bkashURL>"}`. bKash errors →
   payment `failed` with `failure_reason`, response 502 `bkash_error`.
2. bKash redirects the browser to `GET /api/v1/payments/bkash/callback/?paymentID=&status=success|failure|cancel`
   (public, throttled). Unknown paymentID → 404 page-safe redirect to `<ADMIN_PUBLIC_URL>/`.
   - `cancel`/`failure` → payment `cancelled`/`failed` (only if still pending), redirect with that result.
   - `success` → lock the payment; if already completed → redirect success. Else `execute`; if execute errors,
     `payment/status` with up to 3 retries 1 s apart (2033); `Completed` → complete the payment (store trxID,
     masked payer, receipt number, apply quote, audit `payment.completed`, email the receipt to the payer user if any);
     otherwise → `failed` with the bKash status message. Redirect with the result.
   The callback's `status=success` alone never completes a payment.
3. Reconciliation: `manage.py reconcile_bkash [--loop]` (compose service like the mailer, every 5 min): pending bKash
   payments older than 10 minutes → query status: `Completed` → complete; `Initiated` with `verificationStatus
   Complete` → execute then complete; still `Initiated` after 24 h, or any failed/cancelled state → `failed`/`cancelled`.
   Logs counts. Idempotent and safe to run concurrently (row locks, skip locked).
4. Refund (superadmin): `POST billing/payments/<id>/refund/` `{"amount", "reason", "end_subscription": false}` →
   bKash payments: refund API, record `Refund` with `bkash_refund_trx_id`; manual payments: record a manual refund.
   Status → `refunded` or `partially_refunded`. `end_subscription: true` cancels the subscription the payment created
   or extended (only if this payment's period is the current one). 409 `refund_exceeds_payment`, 409 `not_refundable`
   (pending/failed/cancelled/rejected), 502 `bkash_error` (nothing recorded as completed).

## Superadmin API (`/api/v1/superadmin/billing/`, superadmin only)
`Payment` shape:
```json
{"id","receipt_number","institution": {"slug","name"}|null,"account_id","package": {"id","name","kind"}|null,
 "package_version": 3|null,"kind","method","status","amount","currency","periods","period_start","period_end",
 "reference","payer_name","payment_date","notes","has_attachment": bool,
 "bkash": {"payment_id","trx_id","payer_account","status"}|null,"failure_reason",
 "refunded_amount","refunds": [{"id","amount","reason","method","bkash_refund_trx_id","status","created_by","created_at"}],
 "recorded_by": PersonRef|null,"verified_by": PersonRef|null,"verified_at","completed_at","created_at"}
```
- `GET summary/?from=&to=` → `{"collected": "…", "bkash": "…", "manual": "…", "refunds": "…", "pending": n, "failed": n,
  "previous": {same keys for the previous period of equal length}, "bkash_mode": "sandbox|live|off"}` (completed amounts net of refunds where stated).
- `GET payments/?q=&status=&method=bkash|manual&institution=<slug>&package=<id>&from=&to=&tab=all|bkash|manual|attention&page=`
  (`attention` = pending manual awaiting verification + bKash pending > 10 min + failed in the period). `q` matches
  receipt number, reference, trxID, payer name, institution name.
- `GET payments/<id>/` → Payment.
- `POST payments/manual/` `{"institution": "<slug>", "package": "<id>", "kind": "new|renew|upgrade", "periods": 1,
  "period_start": "YYYY-MM-DD"|null (default from quote), "amount": "…", "method": "bank_transfer|cheque|cash|bkash_manual|other",
  "reference", "payer_name", "payment_date", "notes", "pending": false}` → 201 Payment. Amount differing from the quote
  requires `notes` (400 otherwise). `pending: true` stores it `pending` for a second person to verify.
- `POST payments/<id>/verify/` `{"notes"?}` (pending manual only; applies the quote) · `POST payments/<id>/reject/` `{"reason"}`.
- `POST payments/<id>/refund/` (above).
- `POST payments/<id>/attachment/` (multipart `file`) · `GET payments/<id>/attachment/` (download, `Content-Disposition: attachment`).
- `GET payments/<id>/receipt/` → printable HTML receipt (completed payments only; 409 otherwise).
- `GET quote/?institution=<slug>&package=<id>&kind=&periods=` → the quote, for the Record payment preview.
- `GET subscriptions/?status=&institution=&package=&expiring_within=<days>&scheduled=1&page=` → `Subscription`:
  `{"id","institution": {"slug","name"}|null,"package": {"id","name","kind"},"version","apps": [{"slug","name"}],"status",
  "starts_at","expires_at","auto_renew","scheduled_package": {"id","name"}|null,"last_payment": {"id","method","completed_at"}|null}`.
- `POST subscriptions/<id>/cancel-scheduled-change/` · `POST subscriptions/<id>/stop-renewal/` · `POST subscriptions/<id>/resume-renewal/`
  (reuse the services from d6171b2).
- `GET /api/v1/superadmin/institutions/<slug>/billing/` → `{"subscriptions": [Subscription], "payments": [Payment] (latest 50)}`.

## Portal API additions (institution owners/admins; `/api/v1/portal/institutions/<slug>/billing/`)
- `GET billing/` → `{"subscriptions": [Subscription], "payments": [Payment without recorded_by email], "bkash_enabled": bool,
  "offers": [{"package": {"id","name","kind","audience","apps"},"kind": "renew|upgrade|new","quote": {...}}]}`
  (`offers` = renew of each current subscription, upgrades = public packages covering the same apps with a higher price,
  `new` = public packages when nothing is active).
- `POST billing/checkout/` (above). `POST billing/downgrade/` `{"package": "<id>"}` → schedules (sets
  `pending_package_version`; lower price, same apps covered; 400 otherwise) · `DELETE billing/downgrade/` cancels.
- `GET billing/payments/<id>/receipt/` and `GET billing/payments/<id>/attachment/` for their own institution only.

## Emails
Receipt email (payer user, after completion): amount, package, period, receipt number, method; no links.
`manage.py send_expiry_reminders [--loop]` (daily): subscriptions whose `expires_at` has passed in the last 7 days
and `expiry_reminder_sent_at` is null → one gentle email to the institution's active owners/admins
("Your <package> period ended on <date>. To keep using <apps>, renew from your institution console or contact BdREN.").

## Admin SPA (superadmin)
- **Billing** page (`/billing`, no longer "soon"): range picker, summary tiles (collected, via bKash, via manual,
  refunds, pending, failed; change vs previous period), bKash mode chip (Sandbox/Live/Off), tabs All · bKash · Manual ·
  Awaiting action, filters (status, institution, package), search, export CSV of the current filter, payments table
  (date, institution, package, amount ৳, method, reference/trxID, status, recorded by). Row → drawer: all fields,
  bKash ids, refunds list, attachment download/upload, actions Verify/Reject (pending manual), Refund (amount ≤
  remaining, reason, end-subscription checkbox), Receipt.
- **Record payment** dialog (Billing page header and institution row/detail): institution picker, package picker
  (packages covering what the institution has; shows current subscription and offers renew/upgrade/new), periods,
  start date (prefilled from the quote), payment details (amount prefilled from the quote, method, reference, payer,
  date, notes required when amount differs, attachment), live preview "Sylhet Agricultural University → BdREN AI Suite
  Standard, 18 Nov 2026 – 17 Dec 2026, ৳4,500", Save / Save as pending.
- **Subscriptions** page (`/subscriptions`, no longer "soon"): table with filters and saved views (expiring in 30 days,
  scheduled downgrades, stopped renewal), row actions cancel scheduled change, stop/resume renewal, record payment.
- Institution detail gets a **Billing** tab (subscriptions + payments + Record payment).
- Configuration gets nothing new here; bKash settings are env only (shown read-only as the mode chip).

The institution console screens (Renew / Upgrade / Pay with bKash, downgrade scheduling, result page after the
callback, receipts) are built by the institution-admin session against the Portal API above.

## Portal errors and shapes (for the institution console)

All errors use `{"error", "message", "fields"?}`; `message` is plain English safe to show as is.

`POST billing/checkout/`
| status | `error` | when |
|---|---|---|
| 400 | `invalid` | missing/unknown `kind`, malformed body (`fields` names the field) |
| 404 | `not_found` | package id does not exist |
| 400 | `free_package` | the package is free; nothing to pay |
| 400 | `package_unavailable` | archived, inactive, not public, or one of its apps is inactive |
| 400 | `package_not_offered` | not one of this institution's `offers` for that `kind` (e.g. renew of a different package, upgrade to an equal/lower price, `new` while a subscription is active) |
| 409 | `covered_by_bundle` | a single package for an app the institution already gets from an active combined package |
| 409 | `checkout_in_progress` | a bKash payment for this institution was started < 10 minutes ago and is still pending; body adds `"payment": Payment` so the screen can offer to continue or wait |
| 409 | `seats_exceed_package` | the package's `seat_limit` is below the institution's seats in use; body adds `"seats": {"used","cap"}` |
| 403 | `institution_suspended` | (existing portal rule) |
| 503 | `bkash_unavailable` | bKash is not configured |
| 502 | `bkash_error` | bKash refused or did not answer; the payment is stored as `failed` with `failure_reason` |

`POST billing/downgrade/`
| status | `error` | when |
|---|---|---|
| 400 | `invalid` / 404 `not_found` | as above |
| 409 | `nothing_to_downgrade` | no active subscription covering the package's apps |
| 400 | `package_not_offered` | not cheaper per period, or does not cover the same apps |
| 409 | `seats_exceed_package` | seats in use exceed the cheaper package's `seat_limit` (`"seats"` in body) |
| 409 | `renewal_stopped` | the subscription is set not to renew |
→ 200 `{"subscription": Subscription}` (with `scheduled_package`).

`DELETE billing/downgrade/` → 200 `{"subscription": Subscription}`; 409 `no_scheduled_change`.

`GET billing/` shapes: `subscriptions` use the superadmin `Subscription` shape; `payments` use `Payment` except
`recorded_by`/`verified_by` are `{"name"}` only (no email) and `refunds[].created_by` is omitted. `offers[].quote` is
`{"package_version","amount","currency","periods","period_start","period_end","kind"}`. `bkash_enabled` is false →
hide Pay with bKash and show "Contact BdREN to pay".
Callback result banner (`?payment=<id>&result=`): `success` → "Payment received, receipt <number>";
`failed` → show the payment's `failure_reason`; `cancelled` → "Payment cancelled, nothing was charged".

## Implementation notes (as built)

Where the build is more specific than the sections above:
- `GET billing/subscriptions/` also takes `auto_renew=true|false`; `Subscription` and `Payment` also carry `account_id`.
- `GET billing/quote/` also takes `period_start=YYYY-MM-DD` and adds `package`, `seat_limit` and `subscription_id`
  (the subscription renewed or upgraded from) to the quote.
- `GET /api/v1/superadmin/institutions/<slug>/billing/` also returns `offers` (same shape as the portal's).
- `POST payments/<id>/refund/`: 409 `refund_exceeds_payment` adds `"remaining": "…"`; `end_subscription: true` on a
  payment whose period is not the subscription's current one is 409 `period_not_current`. A bKash refund that bKash
  refuses is kept as a `failed` `Refund` row (visible in `refunds`) and nothing on the payment changes.
- `POST billing/downgrade/` "same apps" means exactly the same set of apps. The target must also be buyable, so a
  free, archived or non-public target answers 400 `free_package` / `package_unavailable` like checkout.
  `DELETE billing/downgrade/` takes an optional `subscription` id (body or query); without it every scheduled change
  of the institution is cleared and the first such subscription is returned.
- The callback redirect's `result` can also be `pending`: bKash could not be reached after the payer approved, so the
  payment waits for `reconcile_bkash` (the console should say "Payment is being confirmed").
- A bKash `Completed` answer for an amount other than the payment's fails the payment (BdREN refunds it).
- The public `POST /api/v1/catalog/subscribe/` stays single-package only (a bundle id is 404 `package_not_found`):
  combined packages are sold per institution through billing (bKash checkout or a recorded manual payment).
- Compose services `billing-reconciler` (`reconcile_bkash --loop`, every 300 s; does nothing while bKash is not
  configured) and `expiry-reminders` (`send_expiry_reminders --loop`, every 86400 s), both like `mailer`.

- bKash `new`/`upgrade` periods start when the payment completes (the quote's length is kept), not when checkout
  opened; renewals still start at the current period's end; manual payments keep the dates the superadmin chose.
  Found in the live sandbox run of 2026-11-19 (payment `TR0011vAVyXMV1795060527293`, trx `DKJ70PXGQR`, refund
  `DKJ50PXGQZ`): checkout 09:55, completion 10:02.
