#!/bin/sh
# Creates the application role/database for Django. ZITADEL's own role/database
# is created by `zitadel start-from-init` using the admin credentials.
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<SQL
CREATE ROLE "$BDREN_DB_USER" LOGIN PASSWORD '$BDREN_DB_PASSWORD';
CREATE DATABASE "$BDREN_DB_NAME" OWNER "$BDREN_DB_USER";
REVOKE ALL ON DATABASE "$BDREN_DB_NAME" FROM PUBLIC;
SQL
