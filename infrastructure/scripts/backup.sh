#!/usr/bin/env bash
# HMS Backup Script — Phase 0 skeleton
# Encrypts before leaving the host; retention period is policy-driven (G-09/OD-06).
# DO NOT hardcode retention days — they come from BACKUP_RETENTION_DAYS env var.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:?BACKUP_DIR env var required}"
TS=$(date -u +%Y%m%d_%H%M%SZ)
mkdir -p "$BACKUP_DIR"

echo "[$(date -u +%H:%M:%SZ)] HMS backup starting — $TS"

# ── PostgreSQL logical dump ──────────────────────────────────────────────────
echo "  Dumping PostgreSQL..."
docker compose exec -T postgres \
  pg_dump -U "${POSTGRES_USER:?}" -d "${POSTGRES_DB:?}" \
  | gzip > "$BACKUP_DIR/postgres_$TS.sql.gz"

gzip -t "$BACKUP_DIR/postgres_$TS.sql.gz"
echo "  ✓ PostgreSQL dump verified"

# ── SeaweedFS object storage ─────────────────────────────────────────────────
echo "  Archiving SeaweedFS object storage data..."
OBJECT_STORAGE_CONTAINER="$(docker compose ps -q object-storage)"
if [[ -z "$OBJECT_STORAGE_CONTAINER" ]]; then
  echo "ERROR: object-storage service is not running." >&2
  exit 1
fi
docker run --rm \
  --volumes-from "$OBJECT_STORAGE_CONTAINER":ro \
  -v "$BACKUP_DIR":/out \
  alpine tar -czf "/out/object_storage_$TS.tar.gz" -C /data .

test -s "$BACKUP_DIR/object_storage_$TS.tar.gz"
echo "  ✓ Object storage archive verified"

# ── Encrypt (requires BACKUP_GPG_RECIPIENT env var) ─────────────────────────
if [[ -n "${BACKUP_GPG_RECIPIENT:-}" ]]; then
  echo "  Encrypting backups..."
  gpg --batch --yes --encrypt --recipient "$BACKUP_GPG_RECIPIENT" \
    "$BACKUP_DIR/postgres_$TS.sql.gz"
  gpg --batch --yes --encrypt --recipient "$BACKUP_GPG_RECIPIENT" \
    "$BACKUP_DIR/object_storage_$TS.tar.gz"
  rm "$BACKUP_DIR/postgres_$TS.sql.gz" "$BACKUP_DIR/object_storage_$TS.tar.gz"
  echo "  ✓ Encrypted"
else
  echo "  WARNING: BACKUP_GPG_RECIPIENT not set — backups are UNENCRYPTED"
  echo "           Set BACKUP_GPG_RECIPIENT before production use."
fi

# ── Retention — policy-driven, not hardcoded ─────────────────────────────────
if [[ -n "${BACKUP_RETENTION_DAYS:-}" ]] && [[ "$BACKUP_RETENTION_DAYS" =~ ^[0-9]+$ ]]; then
  echo "  Cleaning backups older than $BACKUP_RETENTION_DAYS days..."
  find "$BACKUP_DIR" -maxdepth 1 -type f \
    \( -name 'postgres_*.sql.gz' -o -name 'postgres_*.sql.gz.gpg' \
       -o -name 'object_storage_*.tar.gz' -o -name 'object_storage_*.tar.gz.gpg' \) \
    -mtime +"$BACKUP_RETENTION_DAYS" -delete
else
  echo "  WARNING: BACKUP_RETENTION_DAYS not set or invalid — no cleanup performed"
fi

echo "[$(date -u +%H:%M:%SZ)] HMS backup complete — $TS"
