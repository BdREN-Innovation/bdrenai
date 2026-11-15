#!/usr/bin/env bash
# Runs backend tests against the dev Postgres (docker compose up -d postgres).
# Uses the DB admin role ONLY because Django must create a throwaway test database;
# the app role intentionally lacks CREATEDB.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
export DJANGO_DEBUG=true BDREN_DB_HOST=127.0.0.1 BDREN_DB_PORT=5433 DJANGO_CACHE=locmem
export BDREN_DB_USER="$POSTGRES_ADMIN_USER" BDREN_DB_PASSWORD="$POSTGRES_ADMIN_PASSWORD"
cd backend && ../.venv/bin/python -m pytest -q "$@"
