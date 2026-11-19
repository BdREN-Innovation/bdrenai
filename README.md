# BDREN AI platform

Single sign-on, institutions, packages and billing for BDREN AI products (Synapse, Mindspear, …).

| Part | Path | Stack | What it is |
|---|---|---|---|
| Identity | `deploy/zitadel/` | ZITADEL v4 (API + Login v2) | Sign-in, MFA, passkeys, OIDC clients for every app |
| Backend | `backend/` | Django 5.2 + DRF, Python 3.12 | Users, institutions, packages, subscriptions, quotas, invitations, billing (bKash) |
| Website | `frontend/` | Next.js, Node 22 | Public site at `/`: products, pricing, sign-up, profile |
| Admin app | `admin/` | Vite + React 19, Node 22 | `/admin/`: platform (superadmin) console and institution console |
| Edge | `deploy/nginx/` | nginx | Routes `bdren.localhost`, `api.…`, `admin.…`, `auth.…` |

Everything runs in Docker for a full local stack. For day-to-day work, run the data services and ZITADEL in
Docker and the three apps on your machine with live reload (section 3).

## 1. Prerequisites

- Docker with Compose v2 (Docker Desktop or OrbStack)
- Python 3.12 and Node 22 (only for section 3, running the apps on your machine)
- `*.localhost` names resolve to your machine in browsers and curl; nothing to add to `/etc/hosts`

## 2. Full stack in Docker

### 2.1 Configure

```bash
cp .env.example .env
```

Replace every `CHANGE_ME` in `.env`. `ZITADEL_MASTERKEY` must be exactly 32 characters:

```bash
openssl rand -hex 16    # ZITADEL_MASTERKEY (32 chars)
openssl rand -hex 24    # LOGIN_SESSION_COOKIE_SECRET, the three DB passwords, DJANGO_SECRET_KEY
```

Avoid `$` in values: Compose treats it as a variable.

### 2.2 Start

```bash
docker compose up -d --build --wait
```

The first run takes a few minutes. `docker-compose.override.yml` loads automatically and publishes Postgres on
`127.0.0.1:5433` and Redis on `127.0.0.1:6380` for section 3. On every start the backend runs migrations and
seeds the product catalog.

### 2.3 Register the apps in ZITADEL (once per fresh database)

ZITADEL writes a short-lived admin token into a Docker volume on first start. Its image has no shell, so read it
through a throwaway container:

```bash
docker run --rm -v bdren-sso_zitadel-bootstrap:/b:ro alpine:3 cat /b/admin-bootstrap.pat \
  | python3 scripts/bootstrap_zitadel.py \
      --issuer http://auth.bdren.localhost:8080 --connect http://127.0.0.1:8080 \
      --pat-file - --config deploy/zitadel/clients.json
```

This creates every client in `deploy/zitadel/clients.json` plus the `bdren-signup` service user, and writes their
IDs and secrets to `.zitadel-secrets.json` (git-ignored). Copy three values into `.env`:

```bash
python3 -c "import json; s = json.load(open('.zitadel-secrets.json')); p = s['bdren-platform-api']; \
print(f\"OIDC_CLIENT_ID={p['client_id']}\nOIDC_CLIENT_SECRET={p['client_secret']}\nZITADEL_SERVICE_TOKEN={s['bdren-signup']['token']}\")"
```

Then reload the backend: `docker compose up -d backend`.

### 2.4 Open it

| What | URL |
|---|---|
| Website | http://bdren.localhost:8080/ |
| Admin app (platform and institution consoles) | http://bdren.localhost:8080/admin/ |
| API health | http://bdren.localhost:8080/api/v1/health/ |
| ZITADEL console | http://auth.bdren.localhost:8080/ui/console |
| OIDC discovery | http://auth.bdren.localhost:8080/.well-known/openid-configuration |

`http://localhost:8080/` shows only nginx's default page: routing is by host name.

ZITADEL's built-in administrator is `zitadel-admin@zitadel.auth.bdren.localhost` with ZITADEL's documented
first-instance password, which you must change on first sign-in.

### 2.5 Make yourself a platform superadmin

Sign in once on the website (this creates your user), then:

```bash
docker compose exec backend python manage.py grant_platform_role --email you@example.org
```

Reload `/admin/` to get the platform console. Other roles: `--role identity_administrator`,
`organization_administrator`, `product_manager`, `billing_administrator`, `support_administrator`; `--revoke` removes.

### 2.6 Test accounts (local only)

On a fresh database, seed ready-made accounts instead of signing up by hand:

```bash
docker compose exec backend python manage.py seed_test_accounts
```

| Email | Role | Password |
|---|---|---|
| `superadmin@bdren.test` | Platform superadmin | `Bdren-Test-2026!` |
| `inst-admin@bdren.test` | Institution admin of Sylhet Agricultural University (`sau`, 50 seats) | `Bdren-Test-2026!` |
| `member@bdren.test` | Member of Sylhet Agricultural University | `Bdren-Test-2026!` |

Sign in at http://bdren.localhost:8080/admin/ (superadmin, institution admin) or http://bdren.localhost:8080/
(member). The command creates each account in ZITADEL with a verified email, mirrors it in Django and gives it its
role. Running it again resets the passwords and changes nothing else; `--password '<new>'` sets a different one. It
needs `ZITADEL_SERVICE_TOKEN` (§2.3) and refuses to run unless the identity provider is local (`localhost`,
`*.localhost` or `*.test`), so these accounts can never be created on a real deployment.

Keep any other test accounts you create (other institutions, feature databases, Synapse SSO users) in
`TEST_ACCOUNTS.md` at the repository root. It is git-ignored: passwords for accounts made by hand never go in the
repository.

## 3. Develop with live reload

Keep ZITADEL, Postgres and Redis in Docker (section 2 done once), stop the Dockerised apps, and run the backend,
website and admin app on your machine:

```bash
docker compose stop backend frontend admin mailer billing-reconciler expiry-reminders
```

| Process | Port | Proxies `/api` to |
|---|---|---|
| Django | 8000 | — |
| Website (`next dev`) | 3000 | Django, when `DEV_API_PROXY` is set |
| Admin app (`vite`) | 5174 | Django (`ADMIN_DEV_API`, default `http://localhost:8000`) |

Sign in through the website on **http://localhost:3000**. The session cookie is shared with the admin app on
:5174 because cookies ignore the port. `deploy/zitadel/clients.json` already allows the `localhost:3000` callback.

### 3.1 Backend

```bash
python3.12 -m venv .venv
.venv/bin/pip install -r backend/requirements/dev.txt
```

Each terminal that runs Django needs `.env` plus the host-side overrides:

```bash
set -a; . ./.env; set +a
export DJANGO_DEBUG=true BDREN_DB_HOST=127.0.0.1 BDREN_DB_PORT=5433 REDIS_URL=redis://127.0.0.1:6380/1
export OIDC_ISSUER=http://auth.bdren.localhost:8080
export OIDC_REDIRECT_URI=http://localhost:3000/api/v1/auth/callback/
export OIDC_POST_LOGOUT_REDIRECT_URI=http://localhost:3000/api/v1/auth/logged-out/
export OIDC_ALLOWED_REDIRECT_ORIGINS=http://localhost:3000,http://localhost:5174
cd backend
../.venv/bin/python manage.py migrate
../.venv/bin/python manage.py seed_bdren_catalog
../.venv/bin/python manage.py runserver 8000
```

`OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` and `ZITADEL_SERVICE_TOKEN` come from `.env` (section 2.3). Grant
yourself a role with `../.venv/bin/python manage.py grant_platform_role --email you@example.org`.

Background workers, each in its own terminal with the same environment (all optional):

```bash
../.venv/bin/python manage.py send_invitation_emails --loop   # bulk invitation emails
../.venv/bin/python manage.py reconcile_bkash --loop          # settles bKash payments whose callback never came
../.venv/bin/python manage.py send_expiry_reminders --loop    # subscription expiry reminders
```

With `DJANGO_DEBUG=true` and `EMAIL_BACKEND` empty, emails are printed to the Django console instead of sent.

### 3.2 Website

```bash
cd frontend
npm ci
DEV_API_PROXY=http://localhost:8000 npm run dev      # http://localhost:3000
```

Set `NEXT_PUBLIC_ADMIN_URL=http://localhost:5174/admin/` to make the website's admin links open the Vite app.

### 3.3 Admin app

```bash
cd admin
npm ci
npm run dev                                            # http://localhost:5174/admin/
```

More in [admin/README.md](admin/README.md).

## 4. Payments (bKash sandbox)

bKash is off until `BKASH_APP_KEY`, `BKASH_APP_SECRET`, `BKASH_USERNAME` and `BKASH_PASSWORD` are all set in
`.env`. An empty `BKASH_BASE_URL` uses the sandbox. After paying, bKash redirects the browser to
`BKASH_CALLBACK_URL`, which must be reachable from your browser; for section 3 set it to
`http://localhost:8000/api/v1/payments/bkash/callback/` and `ADMIN_PUBLIC_URL=http://localhost:5174/admin`.
Manual (offline) payments need no configuration. Never commit real credentials. Contract:
[docs/BILLING_API.md](docs/BILLING_API.md).

## 5. Tests

```bash
scripts/test_backend.sh                  # backend: pytest on a throwaway DB in the Docker Postgres
cd admin && npm test && npm run build    # admin app: vitest, then type check and build
cd frontend && npm test && npm run build # website
```

`scripts/test_backend.sh` needs the stack's Postgres running and the `.venv` from section 3.1. Before committing
model changes, check that migrations are complete:
`cd backend && ../.venv/bin/python manage.py makemigrations --check --dry-run`.

## 6. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| ZITADEL error page on sign-in; `zitadel-api` log says `Errors.App.NotFound` | `.env` holds client IDs from an older database. Redo section 2.3 and reload the backend. |
| `bootstrap_zitadel.py` gets `401 Errors.Token.Invalid` | The token was not read. Use the `docker run … alpine` command in 2.3: `docker compose exec zitadel-api cat` fails because the image has no shell or `cat`. |
| 502 from nginx after recreating containers | nginx still points at the old container addresses: `docker compose restart nginx`. |
| After sign-in you land on the website's home page instead of where you started | Django only returns you to origins in `OIDC_ALLOWED_REDIRECT_ORIGINS`; anything else goes to `/`. Add the origin. A new callback URL also goes in `deploy/zitadel/clients.json`, then rerun 2.3. |
| `vite: command not found` / `next: command not found` | Run `npm ci` in that app's folder. |
| Signed in but `/admin/` says "You don't have access to the admin console" | Your user has no platform role and administers no institution: run `grant_platform_role` (2.5). |
| Start from scratch | `docker compose down -v` deletes all data, including ZITADEL users; then redo section 2. |

## 7. More documentation

| Topic | File |
|---|---|
| Architecture | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| User and operator guide | [docs/USER_GUIDE.md](docs/USER_GUIDE.md) |
| Environment variables | [docs/ENV_REFERENCE.md](docs/ENV_REFERENCE.md) |
| Superadmin and institution (portal) API | [docs/SUPERADMIN_API.md](docs/SUPERADMIN_API.md) |
| Billing API | [docs/BILLING_API.md](docs/BILLING_API.md) |
| Connecting an app to BDREN sign-in | [docs/OIDC_INTEGRATION_GUIDE.md](docs/OIDC_INTEGRATION_GUIDE.md) |
| Institution identity providers | [docs/INSTITUTIONAL_FEDERATION_GUIDE.md](docs/INSTITUTIONAL_FEDERATION_GUIDE.md) |
| MFA and passkeys | [docs/MFA_AND_PASSKEYS_GUIDE.md](docs/MFA_AND_PASSKEYS_GUIDE.md) |
| Production deployment, backups | [docs/PRODUCTION_DEPLOYMENT_GUIDE.md](docs/PRODUCTION_DEPLOYMENT_GUIDE.md), [docs/BACKUP_AND_RESTORE.md](docs/BACKUP_AND_RESTORE.md) |
