#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${HMS_ENV_FILE:-$ROOT/.env}"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # .env is an operator-controlled shell-style environment file.
  # shellcheck disable=SC1091
  source "$ENV_FILE"
  set +a
fi

PRODUCTION="${1:-}"
if [[ "$PRODUCTION" != "" && "$PRODUCTION" != "--production" ]]; then
  echo "Usage: $0 [--production]" >&2
  exit 2
fi

fail() {
  echo "Environment validation failed: $1" >&2
  exit 1
}

require_value() {
  local name="$1"
  local value="${!name:-}"
  [[ -n "$value" ]] || fail "$name is required"
  [[ "$value" != CHANGE_ME* ]] || fail "$name still has a placeholder value"
}

require_secret() {
  local name="$1"
  require_value "$name"
  local value="${!name}"
  [[ ${#value} -ge 32 ]] || fail "$name must be at least 32 characters"
}

for name in POSTGRES_DB POSTGRES_USER DATABASE_MIGRATION_URL CORS_ORIGINS \
  OBJECT_STORAGE_URL OBJECT_STORAGE_ACCESS_KEY OBJECT_STORAGE_SECRET_KEY OBJECT_STORAGE_BUCKET_PRIVATE_PROOFS; do
  require_value "$name"
done

for name in POSTGRES_PASSWORD HMS_APP_PASSWORD REDIS_PASSWORD JWT_SECRET PLATFORM_JWT_SECRET FIELD_ENCRYPTION_KEY; do
  require_secret "$name"
done

[[ ${#OBJECT_STORAGE_ACCESS_KEY} -ge 16 ]] || fail "OBJECT_STORAGE_ACCESS_KEY must be at least 16 characters"
[[ ${#OBJECT_STORAGE_SECRET_KEY} -ge 32 ]] || fail "OBJECT_STORAGE_SECRET_KEY must be at least 32 characters"
[[ "$OBJECT_STORAGE_ACCESS_KEY" =~ ^[A-Za-z0-9_-]+$ && "$OBJECT_STORAGE_SECRET_KEY" =~ ^[A-Za-z0-9_-]+$ ]] \
  || fail "Object-storage credentials must use only letters, digits, underscores, and hyphens"
[[ "$POSTGRES_PASSWORD" =~ ^[A-Za-z0-9_-]+$ && "$HMS_APP_PASSWORD" =~ ^[A-Za-z0-9_-]+$ && "$REDIS_PASSWORD" =~ ^[A-Za-z0-9_-]+$ ]] \
  || fail "Database and Redis passwords must use URL-safe letters, digits, underscores, and hyphens"

[[ "$JWT_SECRET" != "$PLATFORM_JWT_SECRET" ]] || fail "JWT_SECRET and PLATFORM_JWT_SECRET must be different"
[[ "${HMS_ENABLE_WORKER:-false}" == "true" || "${HMS_ENABLE_WORKER:-false}" == "false" ]] \
  || fail "HMS_ENABLE_WORKER must be true or false"

if [[ "$PRODUCTION" == "--production" ]]; then
  [[ "${NODE_ENV:-}" == "production" ]] || fail "NODE_ENV must be production"
  [[ "${CORS_ORIGINS,,}" != *"*"* ]] || fail "CORS_ORIGINS must not contain a wildcard in production"
  IFS=',' read -r -a cors_origins <<< "$CORS_ORIGINS"
  for origin in "${cors_origins[@]}"; do
    [[ "$origin" == https://* && "$origin" != *" "* ]] || fail "Every CORS_ORIGINS entry must be an exact HTTPS origin"
  done
  [[ "${APP_FRONTEND_URL:-}" == https://* ]] || fail "APP_FRONTEND_URL must use HTTPS in production"
  [[ "${OBJECT_STORAGE_URL:-}" == https://* ]] || fail "OBJECT_STORAGE_URL must use HTTPS in production"
  for name in OBJECT_STORAGE_ACCESS_KEY OBJECT_STORAGE_SECRET_KEY OBJECT_STORAGE_BUCKET_PRIVATE_PROOFS \
    TLS_CERT_FILE TLS_KEY_FILE POSTGRES_VERSION REDIS_VERSION NGINX_VERSION SEAWEEDFS_VERSION; do
    require_value "$name"
  done
  if [[ "${BACKUP_ENCRYPTION_MODE:-gpg}" == "kms" ]]; then
    require_value "BACKUP_KMS_KEY_ID"
  else
    if [[ -z "${BACKUP_GPG_RECIPIENT:-}" && -z "${BACKUP_GPG_PASSPHRASE:-}" ]]; then
      fail "Either BACKUP_GPG_RECIPIENT or BACKUP_GPG_PASSPHRASE must be set for production backup encryption"
    fi
  fi
  [[ "$POSTGRES_VERSION" =~ ^[0-9]+\.[0-9]+(\.[0-9]+)?-alpine[0-9.]*$ ]] || fail "POSTGRES_VERSION must be a pinned Alpine version tag"
  [[ "$REDIS_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+-alpine[0-9.]*$ ]] || fail "REDIS_VERSION must be a pinned Alpine version tag"
  [[ "$NGINX_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+-alpine[0-9.]*$ ]] || fail "NGINX_VERSION must be a pinned Alpine version tag"
  [[ "$SEAWEEDFS_VERSION" =~ ^[0-9]+\.[0-9]+([.][0-9]+)?$ ]] || fail "SEAWEEDFS_VERSION must be a pinned release tag"
  [[ "${OBJECT_STORAGE_AUTO_CREATE_BUCKET:-false}" != "true" ]] \
    || fail "Provision production object-storage buckets before deployment"
  [[ -r "$TLS_CERT_FILE" && -r "$TLS_KEY_FILE" ]] || fail "TLS certificate and key files must be readable"
fi

echo "Environment validation passed."
