#!/usr/bin/env bash
# ==============================================================================
# HMS PostgreSQL WAL Restoration Script
# ==============================================================================
# Invoked by PostgreSQL restore_command during Point-In-Time Recovery (PITR):
#   restore_command = '/usr/local/bin/restore-wal.sh %f %p'
#
# Fetches requested WAL segment from local archive or remote S3 off-site bucket.
# ==============================================================================
set -euo pipefail
umask 077

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <file_name (%f)> <destination_path (%p)>" >&2
  exit 1
fi

FILE_NAME="$1"
DEST_PATH="$2"

WAL_DIR="${BACKUP_WAL_ARCHIVE_DIR:-/var/lib/postgresql/wal_archive}"
LOCAL_FILE="$WAL_DIR/$FILE_NAME"

# Check local archive first
if [[ -f "$LOCAL_FILE" ]]; then
  cp "$LOCAL_FILE" "$DEST_PATH"
  exit 0
fi

# Fallback: check remote S3 off-site bucket if configured
if [[ "${BACKUP_OFFSITE_ENABLED:-false}" == "true" && -n "${BACKUP_OFFSITE_S3_BUCKET:-}" ]]; then
  S3_SRC="s3://${BACKUP_OFFSITE_S3_BUCKET}/${BACKUP_OFFSITE_S3_PREFIX:-backups/hms}/wal/$FILE_NAME"
  if command -v aws &>/dev/null; then
    if aws s3 cp "$S3_SRC" "$DEST_PATH" --only-show-errors 2>/dev/null; then
      exit 0
    fi
  fi
fi

# Non-zero exit code informs PostgreSQL that the segment is not available (normal end of WAL stream)
exit 1
