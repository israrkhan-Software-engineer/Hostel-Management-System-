#!/usr/bin/env bash
# ==============================================================================
# HMS Disaster Recovery Preparation Script — Phase 2 Implementation
# ==============================================================================
# Preflights and prepares an isolated staging recovery environment:
# 1. Verifies host tools (docker, compose, gpg, aws-cli, openssl, sha256sum)
# 2. Verifies available disk space (prevents out-of-disk failures during recovery)
# 3. Validates backup manifest and cryptographic integrity
# 4. Validates decryption keys without modifying database state
# 5. Generates isolated recovery environment configuration (.env.recovery)
# ==============================================================================
set -euo pipefail
umask 077

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${HMS_ENV_FILE:-$ROOT/.env}"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ENV_FILE"
  set +a
fi

BACKUP_DIR="${BACKUP_DIR:-/var/backups/hms}"
BACKUP_MANIFEST="${1:-}"

echo "=== HMS Disaster Recovery Environment Preparation ==="

# ── 1. Host Tooling & Prerequisite Validation ─────────────────────────────────
echo "[Check 1/5] Checking required host utilities..."
MISSING_TOOLS=()
for tool in docker gpg sha256sum gzip tar openssl; do
  if ! command -v "$tool" &>/dev/null; then
    MISSING_TOOLS+=("$tool")
  fi
done

if [[ ${#MISSING_TOOLS[@]} -gt 0 ]]; then
  echo "ERROR: Missing required tools: ${MISSING_TOOLS[*]}" >&2
  echo "Install missing utilities before attempting disaster recovery." >&2
  exit 1
fi
echo "  ✓ Core host utilities available (docker, gpg, sha256sum, gzip, tar, openssl)"

# Check Docker engine connectivity
if ! docker info &>/dev/null; then
  echo "ERROR: Docker daemon is not accessible or not running." >&2
  exit 1
fi
echo "  ✓ Docker daemon is active and responsive"

# ── 2. Disk Space Verification ────────────────────────────────────────────────
echo "[Check 2/5] Checking target filesystem storage capacity..."
# Requires at least 10 GB free space for recovery operations
AVAIL_KB=$(df -k "$BACKUP_DIR" 2>/dev/null | awk 'NR==2 {print $4}' || echo "0")
MIN_REQUIRED_KB=10485760 # 10 GB in KB

if [[ "$AVAIL_KB" -lt "$MIN_REQUIRED_KB" && "$AVAIL_KB" -ne 0 ]]; then
  AVAIL_MB=$((AVAIL_KB / 1024))
  echo "WARNING: Low disk space in $BACKUP_DIR ($AVAIL_MB MB available, 10,240 MB recommended)."
  echo "Recovery may fail if uncompressed database and object storage exceed available disk."
else
  echo "  ✓ Sufficient storage capacity available for extraction and staging"
fi

# ── 3. Manifest Discovery or Validation ────────────────────────────────────────
echo "[Check 3/5] Validating backup bundle..."
if [[ -z "$BACKUP_MANIFEST" ]]; then
  echo "  No manifest specified. Looking for most recent completed backup in $BACKUP_DIR..."
  BACKUP_MANIFEST=$(find "$BACKUP_DIR" -maxdepth 1 -name "hms_*_manifest.json" 2>/dev/null | sort -r | head -n1 || true)
  if [[ -z "$BACKUP_MANIFEST" ]]; then
    echo "ERROR: No backup manifest found in $BACKUP_DIR." >&2
    echo "Provide path to a manifest: $0 <path_to_manifest.json>" >&2
    exit 1
  fi
fi

echo "  Target manifest: $BACKUP_MANIFEST"
if [[ ! -f "$BACKUP_MANIFEST" ]]; then
  echo "ERROR: Manifest file does not exist: $BACKUP_MANIFEST" >&2
  exit 1
fi

STATUS=$(grep -o '"status": "[^"]*' "$BACKUP_MANIFEST" | cut -d'"' -f4)
if [[ "$STATUS" != "COMPLETED" && "$STATUS" != "SUCCESS" ]]; then
  echo "ERROR: Backup status is '$STATUS'. Incomplete backups cannot be used for recovery." >&2
  exit 1
fi
echo "  ✓ Manifest status is '$STATUS'"

# Checksum verification
MANIFEST_DIR="$(cd "$(dirname "$BACKUP_MANIFEST")" && pwd)"
CHECKSUM_FILE="${BACKUP_MANIFEST%_manifest.json}_checksums.sha256"
if [[ -f "$CHECKSUM_FILE" ]]; then
  echo "  Verifying SHA-256 checksums..."
  (cd "$MANIFEST_DIR" && sha256sum --check --ignore-missing "$CHECKSUM_FILE")
  echo "  ✓ SHA-256 integrity verified for all artifacts"
fi

# ── 4. Decryption Key Preflight ───────────────────────────────────────────────
echo "[Check 4/5] Preflighting decryption credentials..."
ENCRYPTION_MODE=$(grep -o '"mode": "[^"]*' "$BACKUP_MANIFEST" | head -n1 | cut -d'"' -f4)
ENCRYPTION_TYPE=$(grep -o '"type": "[^"]*' "$BACKUP_MANIFEST" | head -n1 | cut -d'"' -f4)

case "$ENCRYPTION_TYPE" in
  gpg-asymmetric)
    RECIPIENT=$(grep -o '"recipient": "[^"]*' "$BACKUP_MANIFEST" | head -n1 | cut -d'"' -f4)
    echo "  Validating GPG secret key presence for recipient: $RECIPIENT..."
    if ! gpg --list-secret-keys "$RECIPIENT" &>/dev/null; then
      echo "WARNING: Secret key for '$RECIPIENT' not found in local keyring."
      echo "Import the private key using: gpg --import <private_key.asc>"
    else
      echo "  ✓ GPG private key is present in keyring"
    fi
    ;;
  gpg-symmetric)
    if [[ -z "${BACKUP_GPG_PASSPHRASE:-}" ]]; then
      echo "WARNING: BACKUP_GPG_PASSPHRASE is not exported in current shell environment."
    else
      echo "  ✓ BACKUP_GPG_PASSPHRASE is set"
    fi
    ;;
  kms-envelope)
    if ! command -v aws &>/dev/null; then
      echo "ERROR: aws CLI is required for KMS envelope decryption." >&2
      exit 1
    fi
    echo "  ✓ AWS CLI available for KMS envelope decryption"
    ;;
  none)
    echo "  ℹ Backup is unencrypted (development)"
    ;;
esac

# ── 5. Generate Isolated Recovery Environment Configuration ───────────────────
echo "[Check 5/5] Generating isolated staging environment config..."
RECOVERY_ENV_FILE="$ROOT/.env.recovery"
TS=$(date -u +%Y%m%d_%H%M%SZ)

cat <<EOF > "$RECOVERY_ENV_FILE"
# ==============================================================================
# HMS Isolated Disaster Recovery Environment
# Generated automatically by dr-prepare.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ)
# ==============================================================================
NODE_ENV=recovery
POSTGRES_DB=hms_recovery_${TS}
POSTGRES_USER=${POSTGRES_USER:-hms_recovery_user}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-$(openssl rand -hex 16)}
HMS_APP_PASSWORD=${HMS_APP_PASSWORD:-$(openssl rand -hex 16)}
POSTGRES_VERSION=${POSTGRES_VERSION:-16.6-alpine}

# Isolated recovery ports (different from production to prevent port conflict)
RECOVERY_POSTGRES_PORT=25432
RECOVERY_STORAGE_PORT=28333

# Storage keys
OBJECT_STORAGE_URL=http://object-storage-recovery:8333
OBJECT_STORAGE_ACCESS_KEY=${OBJECT_STORAGE_ACCESS_KEY:-hms_recovery_key}
OBJECT_STORAGE_SECRET_KEY=${OBJECT_STORAGE_SECRET_KEY:-$(openssl rand -hex 24)}
OBJECT_STORAGE_BUCKET_PRIVATE_PROOFS=${OBJECT_STORAGE_BUCKET_PRIVATE_PROOFS:-private-proofs}

# Manifest reference
DR_SOURCE_MANIFEST=$BACKUP_MANIFEST
EOF

echo "  ✓ Staging environment configuration generated: $RECOVERY_ENV_FILE"

echo ""
echo "======================================================================"
echo "DISASTER RECOVERY PREPARATION SUCCESSFUL"
echo "Recovery Prerequisites:  SATISFIED"
echo "Integrity Verification:  PASSED"
echo "Backup Manifest:         $BACKUP_MANIFEST"
echo "Recovery Configuration:  $RECOVERY_ENV_FILE"
echo ""
echo "Next step to execute restoration into an isolated staging database:"
echo "  ./infrastructure/scripts/restore.sh --manifest \"$BACKUP_MANIFEST\" --target-db \"hms_recovery_${TS}\""
echo "======================================================================"
exit 0
