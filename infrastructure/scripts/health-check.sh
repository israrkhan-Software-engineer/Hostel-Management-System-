#!/usr/bin/env bash
# HMS Health Check — real HTTP/TCP probes (not docker ps text matching)
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

COMPOSE=(docker compose)
if [[ -f "$ENV_FILE" ]]; then COMPOSE+=(--env-file "$ENV_FILE"); fi
COMPOSE+=(-f "$ROOT/docker-compose.yml")
if [[ "${NODE_ENV:-}" == "production" ]]; then
  COMPOSE+=(-f "$ROOT/docker-compose.prod.yml")
fi
if [[ "${HMS_ENABLE_WORKER:-false}" == "true" ]]; then
  COMPOSE+=(--profile worker)
fi

compose() {
  "${COMPOSE[@]}" "$@"
}

PASS=0; FAIL=0

check() {
  local name="$1"; local cmd="$2"
  if eval "$cmd" &>/dev/null; then
    echo "  ✓ $name"
    PASS=$((PASS+1))
  else
    echo "  ✗ $name"
    FAIL=$((FAIL+1))
  fi
}

compose_health() {
  local container
  container="$(compose ps -q "$1")"
  [[ -n "$container" ]] && [[ "$(docker inspect --format '{{.State.Health.Status}}' "$container")" == "healthy" ]]
}

echo "HMS Health Check — $(date -u +%Y-%m-%dT%H:%M:%SZ)"

check "Nginx container"    "compose_health nginx"
check "API liveness"       "compose exec -T api node -e \"fetch('http://127.0.0.1:3001/api/health/live').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))\""
check "API readiness"      "compose exec -T api node -e \"fetch('http://127.0.0.1:3001/api/health/ready').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))\""
check "Frontend"           "compose exec -T frontend node -e \"fetch('http://127.0.0.1:3000/').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))\""
check "PostgreSQL"         "compose exec -T postgres sh -c 'pg_isready -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\"'"
check "Redis"              "compose exec -T redis sh -c 'REDISCLI_AUTH=\"\$REDIS_PASSWORD\" redis-cli ping | grep -q PONG'"

if [[ "${NODE_ENV:-}" == "production" ]]; then
  echo "  - S3-compatible storage (verified by API readiness)"
else
  check "SeaweedFS S3" "compose exec -T object-storage wget -qO- http://127.0.0.1:8333/status"
fi

if compose ps --services --filter status=running | grep -qx worker; then
  check "BullMQ worker" "compose exec -T worker node /app/scripts/worker-healthcheck.cjs"
else
  echo "  - BullMQ worker (optional profile not running)"
fi

echo ""
echo "Passed: $PASS  Failed: $FAIL"
[[ $FAIL -eq 0 ]]
