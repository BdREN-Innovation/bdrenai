# BDREN SSO & Entitlement Platform — User Guide

This guide explains what this project is, which URLs to open, how the main flows work, and how to connect
another application (for example **mindspear.app**) to it.

---

## 1. What this project is, in one picture

The platform answers two different questions, and each one has its own system:

| Question | Answered by | You touch it at |
|---|---|---|
| **Who is this person?** (login, password, MFA, passkeys, university login) | **ZITADEL** (an open-source identity server) | `auth.…` domain |
| **What may this person use, and how much?** (products, packages, subscriptions, quotas) | **Django backend** (this repo, `backend/`) | `/api/v1/…` |

On top of that sits a **Next.js website** (`frontend/`): the public landing page and the admin dashboard.

```
                       ┌───────────────────────────── nginx (port 8080 locally / 443 in prod) ─────────────────────────────┐
 Browser ─────────────▶│ auth.bdren.localhost   → ZITADEL (login pages, OIDC, console)                                     │
                       │ bdren.localhost        → landing page   (/admin → admin dashboard, /api/ → Django)               │
                       │ api.bdren.localhost    → Django REST API                                                          │
                       │ admin.bdren.localhost  → admin dashboard                                                          │
                       └────────────────────────────────────────────────────────────────────────────────────────────────────┘
 mindspear.app backend ──(1) OIDC login──────────▶ ZITADEL          "who is this user?"
                       ──(2) API key + user id───▶ Django API       "may they use 5 AI requests?"
```

Key idea: **every app logs users in through the same ZITADEL**. When a user who already logged in to one
app visits another, ZITADEL recognises its own session and lets them straight through, with no password prompt. That is the
"single sign-on". Each app still keeps **its own** session cookie; no cookies are shared between domains.

---

## 2. URLs (local development)

All local URLs go through nginx on **port 8080**. `*.localhost` names resolve to your own machine automatically
in Chrome/Firefox, so no `/etc/hosts` edits are needed.

| What | URL |
|---|---|
| Public landing page (catalog, pricing, sign-in button) | http://bdren.localhost:8080/ |
| Admin dashboard | http://bdren.localhost:8080/admin  (also http://admin.bdren.localhost:8080/) |
| Start a login | http://bdren.localhost:8080/api/v1/auth/login/ |
| Who am I? (JSON, after login) | http://bdren.localhost:8080/api/v1/auth/me/ |
| Health check | http://bdren.localhost:8080/api/v1/health/ |
| Public product catalog (JSON) | http://bdren.localhost:8080/api/v1/catalog/products/ |
| ZITADEL login page | http://auth.bdren.localhost:8080/ui/v2/login/ |
| **ZITADEL admin console** (users, MFA settings, apps, orgs) | http://auth.bdren.localhost:8080/ui/console |
| OIDC discovery document (what other apps need) | http://auth.bdren.localhost:8080/.well-known/openid-configuration |

In production, replace the hostnames with `bdren.ai`, `admin.bdren.ai`, `api.bdren.ai`, `auth.bdren.ai`, and use `https://` with no port.

Opening `http://localhost:8080/` shows only the default nginx page. Routing is by hostname, so always use the
`*.bdren.localhost` names.

---

## 3. First-time setup (do this once)

### 3.1 Start the stack
```bash
cd ~/projects/sso
docker compose up -d --build --wait     # first run takes a few minutes
docker compose ps                       # all 7 services should say "healthy"
```
On every start the backend runs database migrations and seeds the demo catalog (**Mindspear** and **Synapse** with their packages).

### 3.2 Register the login clients in ZITADEL
This is needed after a **fresh database** (first install, or after `docker compose down -v`):
```bash
docker run --rm -v bdren-sso_zitadel-bootstrap:/b:ro alpine:3 cat /b/admin-bootstrap.pat \
  | python3 scripts/bootstrap_zitadel.py \
      --issuer http://auth.bdren.localhost:8080 --connect http://127.0.0.1:8080 \
      --pat-file - --config deploy/zitadel/clients.json
```
It prints client IDs and writes all client IDs and secrets to `.zitadel-secrets.json`. Copy the
`bdren-platform-api` values into `.env`:
```
OIDC_CLIENT_ID=<bdren-platform-api client_id>
OIDC_CLIENT_SECRET=<bdren-platform-api client_secret>
```
then `docker compose up -d backend`.

> **Symptom when this is wrong:** clicking "Sign In" gives a ZITADEL error page and the `zitadel-api` log shows
> `Errors.App.NotFound`. It means `.env` holds client IDs from an older database. Re-run the steps above.

### 3.3 Log in to the ZITADEL console as the built-in administrator
- URL: http://auth.bdren.localhost:8080/ui/console
- Username: `zitadel-admin@zitadel.auth.bdren.localhost`
- Password: ZITADEL's documented first-instance default. You must change it on first login
  (`PASSWORDCHANGEREQUIRED=true`).

This account administers **identity** (users, MFA rules, institutions). It is *not* automatically an admin
of the BDREN business dashboard; see 3.4.

### 3.4 Make yourself a BDREN platform admin
1. Log in once on the platform: http://bdren.localhost:8080/ → **Sign In / Register (SSO)**. You can register a new
   user there or use the ZITADEL admin. This first login creates your user record in Django.
2. Give that user the super-admin role:
   ```bash
   docker compose exec backend python manage.py shell -c "
   from apps.identities.models import User
   from apps.administration.models import PlatformRoleAssignment as R
   u = User.objects.order_by('-created_at').first()   # or filter(email='you@example.com')
   R.objects.get_or_create(user=u, role=R.Role.SUPER_ADMIN); print('admin:', u)"
   ```
3. Open http://bdren.localhost:8080/admin. You now see the dashboard.

Available roles: `platform_super_admin` (everything), `identity_administrator`, `organization_administrator`,
`product_manager`, `billing_administrator`, `support_administrator`.

---

## 4. The main flows (what happens behind each button)

### 4.1 Sign up / log in
1. User clicks **Sign In / Register (SSO)** → browser goes to `/api/v1/auth/login/`.
2. Django redirects to **ZITADEL** (`auth.…/oauth/v2/authorize`) using *Authorization Code + PKCE*, a standard secure login handshake.
3. ZITADEL shows its login page: username/password, "Register new user", passkey, TOTP, or a university button.
4. ZITADEL sends the browser back to `/api/v1/auth/callback/`. Django verifies the response, then:
   - creates or updates the user, identified by **(issuer, subject)**, never by email;
   - creates the user's **Personal account**;
   - sets its own `HttpOnly` session cookie.
5. User lands back on the page given in `?next=` (only same-site paths or allow-listed origins are accepted).

Logout: click **Sign out** in the header of the landing page or the admin dashboard. Behind it, `POST /api/v1/auth/logout/`
ends the Django session and returns ZITADEL's logout URL. The browser goes there to end the central SSO session, and
ZITADEL then redirects to `/api/v1/auth/logged-out/`, which returns you to the landing page.

### 4.2 Personal vs organization accounts
- Every user has a **Personal** account.
- A user can also be a member of **Organizations** (e.g. a university) with role `owner`, `admin`, `billing` or `member`.
- Subscriptions and quotas belong to an **account**, so a researcher can use their own quota, their university's, or both.
- Switching context: `GET /api/v1/accounts/contexts/` lists the accounts, and `POST /api/v1/accounts/switch-context/` with `{"account_id": "…"}` switches.

### 4.3 Products, packages, subscriptions
- **Product** = an app you sell, e.g. `mindspear`.
- **Feature** = something you count, e.g. `ai_requests`, `storage_gb`.
- **Package** = a plan with limits per feature, e.g. *Mindspear Professional: 5000 ai_requests/month*. Packages are
  **versioned**: publishing new limits creates a new version, and you choose who moves to it (`new_only`, `immediate`,
  `on_renewal`, `selected_only`).
- **Subscription** = account X is on package version Y. Paid packages are activated when an admin **verifies a manual payment**.
- **Entitlement** = the resulting limit (e.g. 5000/month), from which a **usage counter** tracks `used` and `reserved`.

Each feature has a **quota policy** that decides whose pool is charged: `personal_only`, `organization_only`,
`personal_then_org`, `org_then_personal`, `both`.

Seeded catalog:

| Product | Packages | Features |
|---|---|---|
| `mindspear` | starter (free), professional (1500 BDT/mo), institutional (25000 BDT/mo) | `ai_requests`, `storage_gb`, `projects`, `team_members` |
| `synapse` | community (free), lab-pro (3000 BDT/mo) | `workflow_executions`, `api_requests`, `integrations`, `storage_gb` |

### 4.4 Admin dashboard (http://bdren.localhost:8080/admin)
Behind it are these API calls (all need a platform role):

| Area | Endpoint | Typical actions |
|---|---|---|
| Overview | `GET /api/v1/admin/summary/` | metrics, recent audit log |
| Users | `GET/PATCH /api/v1/admin/users/` | suspend / reactivate a user |
| Organizations | `POST /api/v1/admin/organizations/` | `create_org`, `set_membership`, `register_idp` |
| Catalog | `POST /api/v1/admin/catalog/` | `create_product`, `create_feature`, `create_package`, `publish_package_version` |
| Subscriptions | `POST /api/v1/admin/subscriptions/` | `assign_subscription`, `change_package`, `renew`, `cancel`, `verify_payment`, `entitlement_override` |
| Usage & audit | `GET /api/v1/admin/usage-audit/` | inspect counters and audit trail |

### 4.5 University (institutional) login
Each university becomes a **ZITADEL Organization** with its own SAML or OIDC identity provider. Its users then
log in with their university credentials and are automatically joined to the matching BDREN organization.
See `docs/INSTITUTIONAL_FEDERATION_GUIDE.md` and `scripts/configure_institutional_idp.py`.

### 4.6 MFA and passkeys
These are configured entirely in the ZITADEL console (**Default Settings → Login Behavior and Security**). See
`docs/MFA_AND_PASSKEYS_GUIDE.md`. Passkeys need HTTPS in production.

---

## 5. Integrating another app (e.g. mindspear.app)

Mindspear needs to do **two separate things**:

| | What | Talks to | Credential |
|---|---|---|---|
| **A** | Log users in ("Sign in with BDREN") | ZITADEL | OIDC `client_id` + `client_secret` |
| **B** | Check / charge quotas ("can this user run 1 more AI request?") | BDREN Django API | Product API key (`X-Product-Api-Key`) |

### 5.1 Part A: login (OIDC)

**Step 1: register Mindspear as a client.** Add an entry to `deploy/zitadel/clients.json`:
```json
{
  "name": "mindspear",
  "redirect_uris": [
    "https://mindspear.app/auth/callback",
    "http://localhost:3001/auth/callback"
  ],
  "post_logout_redirect_uris": ["https://mindspear.app/", "http://localhost:3001/"],
  "dev_mode": true
}
```
- Redirect URIs must match **exactly** (no wildcards, trailing slash matters).
- `dev_mode: true` allows `http://` URIs. Use `false` for a production-only client.

Run the bootstrap command from 3.2 again. It is safe to repeat: existing clients are updated, and new ones are
created. The Mindspear `client_id` / `client_secret` appear in `.zitadel-secrets.json`.
(You can also create the app by hand in the ZITADEL console: project **bdren-apps** → New → Web → Code + PKCE.)

**Step 2: configure Mindspear's backend.** Any standard OIDC library works. The only values it needs:

| Setting | Local | Production |
|---|---|---|
| Issuer / discovery | `http://auth.bdren.localhost:8080` | `https://auth.bdren.ai` |
| Client ID / secret | from `.zitadel-secrets.json` | same (from the prod ZITADEL) |
| Redirect URI | `http://localhost:3001/auth/callback` | `https://mindspear.app/auth/callback` |
| Scopes | `openid profile email` | same |
| Flow | Authorization Code + PKCE (S256) | same |

Example with Python/Django + [Authlib](https://docs.authlib.org/):
```python
# settings / setup
from authlib.integrations.django_client import OAuth
oauth = OAuth()
oauth.register(
    name="bdren",
    server_metadata_url="https://auth.bdren.ai/.well-known/openid-configuration",
    client_id=env("BDREN_CLIENT_ID"),
    client_secret=env("BDREN_CLIENT_SECRET"),
    client_kwargs={"scope": "openid profile email", "code_challenge_method": "S256"},
)

# views
def login(request):
    return oauth.bdren.authorize_redirect(request, "https://mindspear.app/auth/callback")

def callback(request):
    token = oauth.bdren.authorize_access_token(request)   # verifies state, nonce, signature, iss, aud, exp
    claims = token["userinfo"]
    user = get_or_create_local_user(issuer=claims["iss"], subject=claims["sub"],
                                    email=claims.get("email"), name=claims.get("name"))
    request.session["user_id"] = user.id
    return redirect("/")
```
For Node.js use `openid-client` or Auth.js (NextAuth) with a generic OIDC provider; for PHP/Laravel use Socialite with an OIDC driver.
The reference implementation without libraries is `demo_apps/app.py` (and `backend/apps/identities/oidc.py`).

Rules to follow:
- Identify users by **`iss` + `sub`**, never by email. `sub` is the user's ZITADEL ID and is the same in every BDREN app.
- Keep tokens server-side, and give the browser only your own `HttpOnly; Secure; SameSite=Lax` session cookie.
- Logout: clear your session, then redirect to ZITADEL's `end_session_endpoint` (from the discovery document) with
  `id_token_hint` and `post_logout_redirect_uri`.

**Step 3: try SSO.** Log in on http://bdren.localhost:8080/, then open Mindspear and click login. You should pass
through ZITADEL without being asked for a password.

### 5.2 Part B: quotas and entitlements (server-to-server)

**Step 1: get Mindspear's product API key.** The seed command creates the product but does **not** reveal the key,
so generate a fresh one (this invalidates any previous key):
```bash
docker compose exec backend python manage.py shell -c "
from apps.products.models import Product
print(Product.objects.get(slug='mindspear').rotate_api_key())"
```
It prints `bdren_prod_mindspear_…`. Store it as a secret in Mindspear's backend (env var), and never ship it to the browser.
A new product created via the admin catalog (`create_product`) returns its key once in the response.

**Step 2: call the API from Mindspear's backend.** Always send the key plus the user's `iss` and `sub` from the login:

```bash
API=https://api.bdren.ai/api/v1          # local: http://api.bdren.localhost:8080/api/v1
KEY=bdren_prod_mindspear_...

# (a) Read-only check: "would 1 AI request be allowed?"
curl -s -X POST $API/entitlements/check/ -H "X-Product-Api-Key: $KEY" -H 'Content-Type: application/json' -d '{
  "product": "mindspear", "feature": "ai_requests", "quantity": 1,
  "issuer": "https://auth.bdren.ai", "zitadel_subject": "<sub>"
}'
# → {"allowed": true, "limit": 5000, "used": 450, "reserved": 10, "remaining": 4540, "reset_at": "..."}
```

For anything that actually consumes quota, use the **reserve → do work → commit/release** pattern. It is safe
under concurrency and retries:
```bash
# (b) Reserve before doing the work (idempotency_key = unique per operation, reuse it on retries)
curl -s -X POST $API/usage/reservations/ -H "X-Product-Api-Key: $KEY" -H 'Content-Type: application/json' -d '{
  "product": "mindspear", "feature": "ai_requests", "quantity": 1,
  "idempotency_key": "req-7f3a…", "issuer": "https://auth.bdren.ai", "zitadel_subject": "<sub>"
}'
# 201 → {"reservation_id": "…", "status": "reserved", "expires_at": "…"}
# 429 → {"allowed": false, "error": "quota_exceeded"}   → show "upgrade your plan"

# (c) Work succeeded → make it permanent
curl -s -X POST $API/usage/reservations/<reservation_id>/commit/  -H "X-Product-Api-Key: $KEY"

# (c') Work failed → give the units back
curl -s -X POST $API/usage/reservations/<reservation_id>/release/ -H "X-Product-Api-Key: $KEY"
```
Reservations that are never committed expire and are returned to the pool automatically.
To charge a university's pool instead of the user's, add `"organization_account_id": "<uuid>"`.

Typical Mindspear code:
```python
def run_ai_request(user, prompt):
    r = bdren.post("/usage/reservations/", {...,"feature": "ai_requests", "quantity": 1,
                                            "idempotency_key": str(uuid4())})
    if r.status_code == 429:
        raise QuotaExceeded("Monthly AI request limit reached")
    rid = r.json()["reservation_id"]
    try:
        result = call_llm(prompt)
    except Exception:
        bdren.post(f"/usage/reservations/{rid}/release/"); raise
    bdren.post(f"/usage/reservations/{rid}/commit/")
    return result
```

### 5.3 Important limitation: the user must exist in BDREN first
BDREN creates its user record **only when the person logs in through the BDREN platform**
(`/api/v1/auth/callback/`). A Mindspear login alone does not create it. Until it exists, quota calls for that
user return **403 "Target user not found or inactive"**, and the user also has **no subscription**, so checks
return `allowed: false`.

Options:
1. **Simplest:** on a Mindspear user's first login, if the quota API returns "user not found", send them once to
   `https://bdren.ai/api/v1/auth/login/?next=https://mindspear.app/welcome`. Thanks to SSO this is
   an invisible redirect, and it creates the record. Then let them pick a plan on the BDREN landing page. For this,
   add `https://mindspear.app` to `OIDC_ALLOWED_REDIRECT_ORIGINS`, otherwise `next` falls back to `/`.
2. **Better (code change):** add a server-to-server "ensure user" endpoint in Django that provisions a user from
   `(issuer, sub, email, name)` when called with a valid product API key, and optionally assigns the free package.
   Ask for this if you want it built.

### 5.4 Production checklist for Mindspear
- [ ] Client added to `clients.json` with the exact `https://mindspear.app/...` redirect URIs, and bootstrap run on the **production** ZITADEL.
- [ ] Mindspear env: `BDREN_ISSUER=https://auth.bdren.ai`, `BDREN_CLIENT_ID`, `BDREN_CLIENT_SECRET`, `BDREN_API=https://api.bdren.ai/api/v1`, `BDREN_PRODUCT_API_KEY`.
- [ ] Mindspear's backend can reach `auth.bdren.ai` and `api.bdren.ai` over HTTPS.
- [ ] Features Mindspear meters (`ai_requests`, `storage_gb`, …) exist in the BDREN catalog with the same keys.
- [ ] Plan for 5.3 (first-login provisioning).

---

## 6. Operating the project (cheat sheet)

| Task | Command |
|---|---|
| Start / stop | `docker compose up -d --wait` / `docker compose stop` |
| Status | `docker compose ps` |
| Logs (one service) | `docker compose logs -f backend` (or `zitadel-api`, `nginx`, `frontend`) |
| Rebuild after code change | `docker compose up -d --build backend frontend` |
| Django shell | `docker compose exec backend python manage.py shell` |
| Backend tests | `scripts/test_backend.sh` |
| Frontend tests | `cd frontend && npm test` |
| Backup / verify backup | `scripts/backup_restore.sh backup` / `scripts/backup_restore.sh verify-restore` |
| Production start | `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build --wait` |

**Danger:** `docker compose down -v` deletes the database volumes, which means all users, ZITADEL config and subscriptions.
Afterwards you must redo section 3.2 (client IDs change) and 3.4.

Another project, `bdrenai-local`, may run on ports 80/443 on the same machine. This project uses **8080**.

---

## 7. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| ZITADEL error after "Sign In"; log shows `Errors.App.NotFound` | Stale client ID in `.env`. Redo 3.2. |
| ZITADEL error `redirect_uri` mismatch | The app's redirect URI isn't listed exactly in `clients.json`. Add it and re-run bootstrap. |
| `http://localhost:8080/...` gives 404 | Use the hostnames `bdren.localhost`, `api.bdren.localhost`, etc. |
| `/api/v1/auth/me/` → 403 | Not logged in (normal). |
| `/admin` shows no data / 403 | Your user lacks a platform role. See 3.4. |
| Quota API → 403 `Invalid or inactive product API key` | Wrong key, or the key was rotated. Rotate again (5.2) and update Mindspear. |
| Quota API → 403 `Target user not found` | User never logged in via BDREN. See 5.3. |
| Quota API → `allowed: false` with limit 0 | The user/account has no subscription for that product. Subscribe or assign one in the admin. |
| Quota API → 429 `quota_exceeded` | Limit reached for this period. Upgrade, or set an admin `entitlement_override`. |
| After login you land on `/` instead of your `next` URL | That origin isn't in `OIDC_ALLOWED_REDIRECT_ORIGINS`. |

---

## 8. Where to read more
- `docs/API_REFERENCE.md`: every endpoint
- `docs/OIDC_INTEGRATION_GUIDE.md`: OIDC rules for client apps
- `docs/INSTITUTIONAL_FEDERATION_GUIDE.md`: universities, SAML, eduGAIN
- `docs/MFA_AND_PASSKEYS_GUIDE.md`: MFA, passkeys
- `docs/PRODUCTION_DEPLOYMENT_GUIDE.md`: going live on bdren.ai
- `docs/ENV_REFERENCE.md`: every `.env` variable
- `IMPLEMENTATION_PLAN.md`, `DEVELOPMENT_PROGRESS.md`: design and history
