#!/usr/bin/env bash
# Create Matrix users: admin and hermes-bot
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Load .env
set -a; source "${REPO_ROOT}/.env"; set +a

HOMESERVER="http://localhost:8008"

_register_user() {
  local username="$1"
  local password="$2"
  local is_admin="${3:-false}"

  echo "  Registering @${username}:localhost ..."

  # Use the client/r0/register endpoint with dummy auth
  local response
  response=$(curl -sf -X POST "${HOMESERVER}/_matrix/client/r0/register" \
    -H "Content-Type: application/json" \
    -d "{
      \"username\": \"${username}\",
      \"password\": \"${password}\",
      \"auth\": { \"type\": \"m.login.dummy\" },
      \"inhibit_login\": false
    }" 2>&1) || true

  if echo "${response}" | grep -q '"user_id"'; then
    echo "  → @${username}:localhost registered"
  elif echo "${response}" | grep -q 'M_USER_IN_USE'; then
    echo "  → @${username}:localhost already exists"
  else
    echo "  WARNING: Unexpected response for ${username}: ${response}"
  fi
}

# Register admin user
ADMIN_PASS="${MATRIX_ADMIN_PASSWORD:-$(openssl rand -hex 16)}"
_register_user "admin" "${ADMIN_PASS}" "true"

# Register hermes-bot user
BOT_PASS="${HERMES_BOT_PASSWORD:-$(openssl rand -hex 16)}"
_register_user "hermes-bot" "${BOT_PASS}" "false"

# Login as hermes-bot and capture access token
echo "  Logging in as @hermes-bot:localhost..."
LOGIN_RESPONSE=$(curl -sf -X POST "${HOMESERVER}/_matrix/client/r0/login" \
  -H "Content-Type: application/json" \
  -d "{
    \"type\": \"m.login.password\",
    \"user\": \"hermes-bot\",
    \"password\": \"${BOT_PASS}\"
  }")

HERMES_MATRIX_ACCESS_TOKEN=$(echo "${LOGIN_RESPONSE}" | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)

if [ -z "${HERMES_MATRIX_ACCESS_TOKEN}" ]; then
  echo "ERROR: Could not capture hermes-bot access token"
  echo "Response: ${LOGIN_RESPONSE}"
  exit 1
fi

# Write token to .env
_upsert_env() {
  local key="$1"
  local val="$2"
  local file="${REPO_ROOT}/.env"
  if grep -q "^${key}=" "${file}"; then
    sed -i "s|^${key}=.*|${key}=${val}|" "${file}"
  else
    echo "${key}=${val}" >> "${file}"
  fi
}

_upsert_env "HERMES_MATRIX_ACCESS_TOKEN" "${HERMES_MATRIX_ACCESS_TOKEN}"
echo "  → HERMES_MATRIX_ACCESS_TOKEN written to .env"
