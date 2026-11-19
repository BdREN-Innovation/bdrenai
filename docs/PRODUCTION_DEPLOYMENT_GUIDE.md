# Production Deployment Guide (Ubuntu Server + Docker Compose)

1. **Provision DNS & TLS Certificates**:
   - Point `bdren.ai`, `auth.bdren.ai`, `admin.bdren.ai`, and `api.bdren.ai` to the server.
   - Place TLS certificates (`fullchain.pem`, `privkey.pem`) in `deploy/nginx/certs/`.
2. **Configure `.env`**:
   - Copy `.env.example` to `.env`, set `ZITADEL_EXTERNALSECURE=true`, `ZITADEL_PUBLIC_SCHEME=https`, `ZITADEL_EXTERNALPORT=443`, `DJANGO_DEBUG=false`, and generate strong random secrets (`openssl rand -hex 24`, no `$`).
3. **Start the Production Stack**:
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build --wait
   ```
   *(Passing `-f docker-compose.yml -f docker-compose.prod.yml` overrides any `COMPOSE_FILE` in `.env`, so the local-only `docker-compose-dev.yaml` is never loaded and PostgreSQL and Redis expose zero host ports. Remove the `COMPOSE_FILE` line from a production `.env` anyway.)*
4. **Provision OIDC Clients & Revoke Bootstrap PAT**:
   - Run `scripts/bootstrap_zitadel.py`, copy the `bdren-platform-api` client ID/secret into `.env`, restart `backend`, and delete the `bootstrap-admin` machine user in the ZITADEL Console.
5. **Schedule Automated Backups**:
   - Add a daily cron entry running `/home/bdren/projects/sso/scripts/backup_restore.sh backup`.
