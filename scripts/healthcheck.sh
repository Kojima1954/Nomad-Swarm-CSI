#!/usr/bin/env bash
# Healthcheck: verify all 7 integration points
set -uo pipefail

PASS=0
FAIL=0
GREEN='\033[0;32m'
RED='\033[0;31m'
RESET='\033[0m'

check() {
  local label="$1"
  local url="$2"
  local start
  start=$(date +%s%3N)

  local http_code
  http_code=$(curl -o /dev/null -s -w "%{http_code}" --max-time 5 "${url}" 2>/dev/null || echo "000")
  local elapsed=$(( $(date +%s%3N) - start ))

  if [[ "${http_code}" =~ ^[0-9]+$ ]] && [ "${http_code}" -ge 200 ] && [ "${http_code}" -lt 400 ]; then
    echo -e "${GREEN}✅ PASS${RESET}  [${elapsed}ms]  ${label}  (HTTP ${http_code})  ${url}"
    PASS=$(( PASS + 1 ))
  else
    echo -e "${RED}❌ FAIL${RESET}  [${elapsed}ms]  ${label}  (HTTP ${http_code})  ${url}"
    FAIL=$(( FAIL + 1 ))
  fi
}

echo "=== NOMAD-Hermes Node Health Check ==="
echo ""

check "[1] Synapse"        "http://localhost:8008/_matrix/client/versions"
check "[2] Element Web"    "http://localhost:8080"
check "[3] NOMAD CC"       "http://localhost:8081"
check "[4] NOMAD Ollama"   "http://localhost:11434/api/tags"
check "[5] NOMAD Qdrant"   "http://localhost:6333/healthz"
check "[6] Hermes API"     "http://localhost:8642/v1/models"
check "[7] Orchestrator"   "http://localhost:4000/health"

echo ""
echo "Results: ${PASS} passed, ${FAIL} failed"

if [ "${FAIL}" -gt 0 ]; then
  echo ""
  echo "Run 'docker compose ps' and 'docker compose logs <service>' to debug."
  exit 1
fi

exit 0
