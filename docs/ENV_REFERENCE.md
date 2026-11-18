# Environment Variable Reference (`.env`)

| Variable | Description | Example / Prod Value |
|---|---|---|
| `ZITADEL_DOMAIN` | Public hostname for ZITADEL | `auth.bdren.ai` |
| `PLATFORM_DOMAIN` | Main hostname: website at `/`, superadmin SPA at `/admin/`, API at `/api/` | `bdren.ai` |
| `ADMIN_DOMAIN` | Alias that 301-redirects to `<PLATFORM_DOMAIN>/admin/` (same path), so the SPA shares the platform session | `admin.bdren.ai` |
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
| `EMAIL_BACKEND` | Django email backend. Empty = console backend when `DJANGO_DEBUG=true`, SMTP otherwise | empty (prod: SMTP) |
| `EMAIL_HOST` / `EMAIL_PORT` | SMTP server for invitation emails | `smtp.example.org` / `587` |
| `EMAIL_HOST_USER` / `EMAIL_HOST_PASSWORD` | SMTP credentials (secret; never commit) | From the mail provider |
| `EMAIL_USE_TLS` | STARTTLS to the SMTP server | `true` |
| `DEFAULT_FROM_EMAIL` | Sender of invitation emails | `BDREN AI <no-reply@bdren.ai>` |
| `PLATFORM_PUBLIC_URL` | Public origin of the website; invitation links are `<PLATFORM_PUBLIC_URL>/invite/<token>` | `https://bdren.ai` (dev: `http://bdren.localhost:8080`) |
| `INVITATION_TTL_DAYS` | Days an invitation link stays valid; Resend issues a new link and restarts the clock | `7` |
| `INVITATION_INLINE_EMAILS` | Invitation emails one web request sends itself; bulk actions leave the rest `queued` for the `mailer` service (`manage.py send_invitation_emails --loop`) | `5` |
| `INVITATION_RESEND_COOLDOWN_MINUTES` | One invitation is emailed at most once per this many minutes; an earlier Resend answers 429 `resend_too_soon` | `5` |
| `INVITATION_SEND_RATE` | Per-admin limit (DRF rate) on invite, resend, resend-expired, import and create-institution-with-admin, across the superadmin and portal APIs | `120/hour` |
| `TRUSTED_PROXIES` | Comma-separated IPs/CIDRs of reverse proxies whose `X-Real-IP` header is taken as the client address in audit entries; any other peer is recorded as itself. The backend is reachable only on the internal Docker network, hence private ranges by default | `127.0.0.0/8,::1/128,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16` |
