# Environment Variable Reference (`.env`)

| Variable | Description | Example / Prod Value |
|---|---|---|
| `ZITADEL_DOMAIN` | Public hostname for ZITADEL | `auth.bdren.ai` |
| `PLATFORM_DOMAIN` | Main landing + `/admin` + `/api` hostname | `bdren.ai` |
| `ADMIN_DOMAIN` | Dedicated admin vhost alias | `admin.bdren.ai` |
| `API_DOMAIN` | Dedicated API vhost alias | `api.bdren.ai` |
| `ZITADEL_EXTERNALPORT` | External port visible to browsers | `443` (dev: `8080`) |
| `ZITADEL_EXTERNALSECURE` | Whether external scheme is HTTPS | `true` (dev: `false`) |
| `ZITADEL_PUBLIC_SCHEME` | `https` in prod, `http` in dev | `https` |
| `ZITADEL_VERSION` | Pinned stable ZITADEL v4 tag | `v4.20.3` |
| `ZITADEL_MASTERKEY` | Exact 32-byte key encrypting ZITADEL keys | `openssl rand -hex 16` |
| `LOGIN_SESSION_COOKIE_SECRET` | Secret signing Login v2 cookies (32+ chars) | `openssl rand -hex 24` |
| `POSTGRES_ADMIN_USER` / `PASSWORD` | PostgreSQL superuser credentials | Strong random password |
| `ZITADEL_DB_NAME` / `USER` / `PASSWORD` | Dedicated DB & role for ZITADEL | `zitadel` |
| `BDREN_DB_NAME` / `USER` / `PASSWORD` | Dedicated DB & role for Django (no `CREATEDB`) | `bdren` |
| `DJANGO_SECRET_KEY` | Django cryptographic signing key | `openssl rand -hex 32` |
| `DJANGO_DEBUG` | Must be `false` in production | `false` |
| `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` | Provisioned by `scripts/bootstrap_zitadel.py` | From `.zitadel-secrets.json` |
| `ZITADEL_SERVICE_TOKEN` | PAT of the `bdren-signup` machine user (ORG_USER_MANAGER); enables website sign-up. Empty = sign-up returns 503 | From `.zitadel-secrets.json` (`bdren-signup.token`) |
