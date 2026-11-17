#!/usr/bin/env bash
# ==============================================================================
# HMS PostgreSQL WAL Archiving Script
# ==============================================================================
# Invoked by PostgreSQL archive_command:
#   archive_command = '/usr/local/bin/archive-wal.sh %p %f'
#
# Guarantees RPO <= 15 minutes by continuously archiving WAL segments to local
# persistent storage and optional off-site S3 storage.
# ==============================================================================
set -euo pipefail
umask 077

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <source_path (%p)> <file_name (%f)>" >&2
  exit 1
fi

SRC_PATH="$1"
FILE_NAME="$2"

if [[ ! -f "$SRC_PATH" ]]; then
  echo "ERROR: WAL source file '$SRC_PATH' does not exist." >&2
  exit 1
fi

# Target local WAL archive directory inside container or host
WAL_DIR="${BACKUP_WAL_ARCHIVE_DIR:-/var/lib/postgresql/wal_archive}"
mkdir -p "$WAL_DIR"

DEST_FILE="$WAL_DIR/$FILE_NAME"
TEMP_FILE="$WAL_DIR/.tmp_$FILE_NAME.$$"

# Idempotency check: if destination file exists and is identical in size, succeed
if [[ -f "$DEST_FILE" ]]; then
  SRC_SIZE=$(stat -c%s "$SRC_PATH" 2>/dev/null || stat -f%z "$SRC_PATH" 2>/dev/null || wc -c < "$SRC_PATH")
  DEST_SIZE=$(stat -c%s "$DEST_FILE" 2>/dev/null || stat -f%z "$DEST_FILE" 2>/dev/null || wc -c < "$DEST_FILE")
  if [[ "$SRC_SIZE" -eq "$DEST_SIZE" ]]; then
    # Already archived successfully
    exit 0
  else
    echo "WARNING: Destination '$DEST_FILE' exists with different size ($DEST_SIZE vs $SRC_SIZE). Overwriting." >&2
  fi
fi

# Copy atomically via temporary file
cp "$SRC_PATH" "$TEMP_FILE"
mv "$TEMP_FILE" "$DEST_FILE"

# Optional off-site sync if configured
if [[ "${BACKUP_OFFSITE_ENABLED:-false}" == "true" && -n "${BACKUP_OFFSITE_S3_BUCKET:-}" ]]; then
  S3_DEST="s3://${BACKUP_OFFSITE_S3_BUCKET}/${BACKUP_OFFSITE_S3_PREFIX:-backups/hms}/wal/$FILE_NAME"
  if command -v aws &>/dev/null; then
    aws s3 cp "$DEST_FILE" "$S3_DEST" --only-show-errors || {
      echo "WARNING: Off-site WAL upload to '$S3_DEST' failed. Local copy succeeded." >&2
    }
  fi
fi

exit 0
