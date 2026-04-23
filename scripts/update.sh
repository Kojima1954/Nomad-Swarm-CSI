#!/usr/bin/env bash
# Update: pull latest images, rebuild orchestrator, restart
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

echo "=== NOMAD-Hermes Node: Update ==="

echo "[1/4] Pulling latest base images..."
docker compose pull synapse element-web redis synapse-postgres

echo "[2/4] Rebuilding orchestrator..."
docker compose build --no-cache orchestrator

echo "[3/4] Updating upstream repos..."
git -C upstream/project-nomad pull --ff-only || echo "  WARNING: project-nomad update failed"
git -C upstream/hermes-agent pull --ff-only || echo "  WARNING: hermes-agent update failed"

echo "[4/4] Restarting services..."
docker compose up -d --remove-orphans

echo ""
echo "Update complete. Run 'bash scripts/healthcheck.sh' to verify."
