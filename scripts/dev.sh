#!/usr/bin/env bash
# Dev: run orchestrator locally (outside Docker) with hot-reload
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

# Load .env
set -a; source .env; set +a

# Override service URLs to point at localhost (Docker-exposed ports)
export MATRIX_HOMESERVER_URL="http://localhost:8008"
export HERMES_API_URL="http://localhost:8642/v1/chat/completions"
export DATABASE_URL="postgresql://synapse:${SYNAPSE_DB_PASSWORD}@localhost:5432/nomad_hermes"
export REDIS_URL="redis://localhost:6379"
export PORT="${PORT:-4000}"

echo "=== Dev mode: orchestrator on http://localhost:${PORT} ==="
echo "  Matrix HS: ${MATRIX_HOMESERVER_URL}"
echo "  Hermes API: ${HERMES_API_URL}"
echo ""

cd orchestrator
npm install
node --watch src/index.js
