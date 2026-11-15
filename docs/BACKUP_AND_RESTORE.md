# Database Backup & Restore Runbook

Both the `zitadel` identity database and the `bdren` entitlement/usage database reside in PostgreSQL 17 (`postgres-data` volume).

## 1. Create a Consistent Compressed Backup
```bash
./scripts/backup_restore.sh backup
```
Creates `0600`-permissioned custom-format dumps (`backups/bdren_<UTC>.dump` and `backups/zitadel_<UTC>.dump`).
Also back up the `ZITADEL_MASTERKEY` from your secret store; ZITADEL requires the matching master key to decrypt stored signing keys.

## 2. Verify Backup Integrity Automatically
```bash
./scripts/backup_restore.sh verify-restore
```
Dumps `bdren`, restores it into a temporary database (`bdren_restore_verify`), queries row counts, and drops the temporary database.

## 3. Full Production Restore Procedure
```bash
docker compose stop backend zitadel-api zitadel-login
docker compose exec -T postgres pg_restore -U "$POSTGRES_ADMIN_USER" -d "$BDREN_DB_NAME" --clean --if-exists < backups/bdren_<TIMESTAMP>.dump
docker compose exec -T postgres pg_restore -U "$POSTGRES_ADMIN_USER" -d "$ZITADEL_DB_NAME" --clean --if-exists < backups/zitadel_<TIMESTAMP>.dump
docker compose start zitadel-api zitadel-login backend
```
