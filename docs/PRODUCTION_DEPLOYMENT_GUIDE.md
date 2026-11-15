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
   *(Using `-f docker-compose.yml -f docker-compose.prod.yml` skips `docker-compose.override.yml`, ensuring PostgreSQL and Redis expose zero host ports.)*
4. **Provision OIDC Clients & Revoke Bootstrap PAT**:
   - Run `scripts/bootstrap_zitadel.py`, copy the `bdren-platform-api` client ID/secret into `.env`, restart `backend`, and delete the `bootstrap-admin` machine user in the ZITADEL Console.
5. **Schedule Automated Backups**:
   - Add a daily cron entry running `/home/bdren/projects/sso/scripts/backup_restore.sh backup`.
