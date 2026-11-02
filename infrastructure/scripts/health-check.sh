#!/usr/bin/env bash
# HMS Health Check — real HTTP/TCP probes (not docker ps text matching)
set -euo pipefail

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

echo "HMS Health Check — $(date -u +%Y-%m-%dT%H:%M:%SZ)"

check "API liveness"       "wget -qO- http://localhost:3001/api/v1/health/live"
check "API readiness"      "wget -qO- http://localhost:3001/api/v1/health/ready"
check "Frontend liveness"  "wget -qO- http://localhost:3000/health"
check "PostgreSQL"         "docker compose exec -T postgres pg_isready -U \${POSTGRES_USER:-hms_user}"
check "Redis"              "docker compose exec -T redis redis-cli ping"
check "MinIO"              "wget -qO- http://localhost:9000/minio/health/live"

echo ""
echo "Passed: $PASS  Failed: $FAIL"
[[ $FAIL -eq 0 ]]
