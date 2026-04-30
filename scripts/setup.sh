#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

echo "=== NOMAD-Hermes Node: First Run Setup (Matrix Edition) v2.0.0 ==="
echo ""

cd "${REPO_ROOT}"

# ─── [1/12] Verify vendored upstream sources ────────────────────────────────
echo "[1/12] Verifying vendored upstream sources..."
if [ ! -d "upstream/project-nomad" ] || [ ! -d "upstream/hermes-agent" ]; then
  echo "ERROR: upstream sources missing — expected upstream/project-nomad and upstream/hermes-agent in-tree"
  exit 1
fi
echo "  → upstream/project-nomad and upstream/hermes-agent present"

# ─── [2/12] Generate secrets ─────────────────────────────────────────────────
echo "[2/12] Generating secrets and .env file..."
if [ ! -f ".env" ]; then
  cp .env.example .env
fi

_upsert_env() {
  local key="$1"
  local val="$2"
  local file=".env"
  if grep -q "^${key}=" "${file}"; then
    # Only replace if current value is empty
    local current
    current=$(grep "^${key}=" "${file}" | cut -d= -f2-)
    if [ -z "${current}" ]; then
      sed -i "s|^${key}=.*|${key}=${val}|" "${file}"
    fi
  else
    echo "${key}=${val}" >> "${file}"
  fi
}

_upsert_env "SYNAPSE_DB_PASSWORD"   "$(openssl rand -hex 32)"
_upsert_env "MATRIX_AS_TOKEN"       "$(openssl rand -hex 32)"
_upsert_env "MATRIX_HS_TOKEN"       "$(openssl rand -hex 32)"
_upsert_env "HERMES_API_KEY"        "$(openssl rand -hex 32)"

# Re-load .env so subsequent steps can use the values
set -a; source .env; set +a

# ─── [3/12] Write AS registration file (with token substitution) ─────────────
echo "[3/12] Writing Application Service registration..."
mkdir -p upstream/synapse-data/appservices

AS_REG="upstream/synapse-data/appservices/hermes-orchestrator.yaml"
sed \
  -e "s|\${MATRIX_AS_TOKEN}|${MATRIX_AS_TOKEN}|g" \
  -e "s|\${MATRIX_HS_TOKEN}|${MATRIX_HS_TOKEN}|g" \
  config/hermes-as-registration.yaml > "${AS_REG}"

echo "  → ${AS_REG}"

# ─── [4/12] Copy config files ────────────────────────────────────────────────
echo "[4/12] Copying config files..."

mkdir -p upstream/synapse-data upstream/element-config

cp config/homeserver.yaml upstream/synapse-data/homeserver.yaml
cp config/hermes-config.yaml upstream/hermes-agent/config.yaml
cp config/nomad-compose-override.yml upstream/project-nomad/docker-compose.override.yml
cp config/element-config.json upstream/element-config/config.json

echo "  → homeserver.yaml, hermes-config.yaml, nomad-compose-override.yml, element-config.json"

# ─── [5/12] Create Docker network ────────────────────────────────────────────
echo "[5/12] Creating Docker network..."
docker network create nomad-hermes-net 2>/dev/null || echo "  → nomad-hermes-net already exists"

# ─── [6/12] Start PostgreSQL, wait for healthy ───────────────────────────────
echo "[6/12] Starting synapse-postgres..."
docker compose up -d synapse-postgres

echo "  Waiting for PostgreSQL to be healthy (max 60s)..."
for i in $(seq 1 12); do
  if docker compose exec -T synapse-postgres pg_isready -U synapse 2>/dev/null; then
    echo "  → PostgreSQL healthy"
    break
  fi
  if [ "$i" -eq 12 ]; then
    echo "ERROR: PostgreSQL failed to become healthy within 60s"
    exit 1
  fi
  sleep 5
done

# ─── [7/12] Start Synapse, wait for /_matrix/client/versions ─────────────────
echo "[7/12] Starting Synapse..."
docker compose up -d synapse

echo "  Waiting for Synapse to respond (max 120s)..."
for i in $(seq 1 24); do
  if curl -sf http://localhost:8008/_matrix/client/versions > /dev/null 2>&1; then
    echo "  → Synapse ready"
    break
  fi
  if [ "$i" -eq 24 ]; then
    echo "ERROR: Synapse failed to start within 120s"
    exit 1
  fi
  sleep 5
done

# ─── [8/12] Create Matrix users ──────────────────────────────────────────────
echo "[8/12] Creating Matrix users..."
bash scripts/create-matrix-users.sh

# ─── [9/12] Create Matrix room ───────────────────────────────────────────────
echo "[9/12] Creating Matrix group room..."
bash scripts/create-matrix-room.sh

# Re-load .env (room ID and access token were written by scripts above)
set -a; source .env; set +a

# ─── [10/12] Start NOMAD stack ───────────────────────────────────────────────
echo "[10/12] Starting NOMAD Project stack..."
pushd upstream/project-nomad > /dev/null
docker compose up -d
popd > /dev/null

echo "  Waiting for Ollama (max 120s)..."
for i in $(seq 1 24); do
  if curl -sf http://localhost:11434/api/tags > /dev/null 2>&1; then
    echo "  → Ollama ready"
    break
  fi
  if [ "$i" -eq 24 ]; then
    echo "WARNING: Ollama not responding — model pull may fail"
    break
  fi
  sleep 5
done

# ─── [11/12] Pull Llama model and create Modelfile ───────────────────────────
echo "[11/12] Pulling llama3.1:8b model (this may take a while on first run)..."
docker exec nomad_ollama ollama pull llama3.1:8b || echo "  WARNING: model pull failed — retry manually with: docker exec nomad_ollama ollama pull llama3.1:8b"

echo "  Creating nomad-hermes Modelfile..."
docker cp config/ollama-modelfile nomad_ollama:/tmp/nomad-hermes-modelfile
docker exec nomad_ollama ollama create nomad-hermes -f /tmp/nomad-hermes-modelfile || echo "  WARNING: Modelfile creation failed"

# ─── [12/12] Start remaining services ────────────────────────────────────────
echo "[12/12] Starting hermes-agent, orchestrator, element-web, redis..."

# Restart Synapse AFTER AS registration file is in place (Critical Constraint #6)
echo "  Restarting Synapse to load Application Service registration..."
docker compose restart synapse
sleep 10

docker compose up -d hermes-agent redis
sleep 5
docker compose up -d orchestrator element-web

echo ""
echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║         NOMAD-Hermes Node is running!                            ║"
echo "╠══════════════════════════════════════════════════════════════════╣"
echo "║  Element Web        →  http://localhost:8080                     ║"
echo "║  NOMAD Command      →  http://localhost:8081                     ║"
echo "║  Synapse API        →  http://localhost:8008                     ║"
echo "║  Orchestrator       →  http://localhost:4000/health              ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo ""
echo "Run 'bash scripts/healthcheck.sh' to verify all services."
