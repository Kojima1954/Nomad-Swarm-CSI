#!/usr/bin/env bash
# Create the NOMAD-Hermes group room and invite hermes-bot
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

set -a; source "${REPO_ROOT}/.env"; set +a

HOMESERVER="http://localhost:8008"

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

# Login as admin
echo "  Logging in as @admin:localhost..."
ADMIN_LOGIN=$(curl -sf -X POST "${HOMESERVER}/_matrix/client/r0/login" \
  -H "Content-Type: application/json" \
  -d "{
    \"type\": \"m.login.password\",
    \"user\": \"admin\",
    \"password\": \"${MATRIX_ADMIN_PASSWORD}\"
  }")

ADMIN_TOKEN=$(echo "${ADMIN_LOGIN}" | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)

if [ -z "${ADMIN_TOKEN}" ]; then
  echo "ERROR: Could not get admin access token"
  echo "Response: ${ADMIN_LOGIN}"
  exit 1
fi

# Check if room already exists
if [ -n "${HERMES_MATRIX_ROOM_ID:-}" ]; then
  echo "  → Room already exists: ${HERMES_MATRIX_ROOM_ID}"
  exit 0
fi

# Create the room
echo "  Creating #nomad-hermes-node:localhost..."
CREATE_RESPONSE=$(curl -sf -X POST "${HOMESERVER}/_matrix/client/v3/createRoom" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -d '{
    "room_alias_name": "nomad-hermes-node",
    "name": "NOMAD-Hermes Node",
    "topic": "AI-connected group workspace | Type !help for commands",
    "preset": "private_chat",
    "visibility": "private",
    "initial_state": [
      {
        "type": "m.room.guest_access",
        "state_key": "",
        "content": {"guest_access": "forbidden"}
      }
    ]
  }')

ROOM_ID=$(echo "${CREATE_RESPONSE}" | grep -o '"room_id":"[^"]*"' | cut -d'"' -f4)

if [ -z "${ROOM_ID}" ]; then
  # Room might already exist under that alias
  ROOM_ID=$(echo "${CREATE_RESPONSE}" | grep -o '"errcode":"M_ROOM_IN_USE"' || true)
  if [ -n "${ROOM_ID}" ]; then
    echo "  → Room alias already taken — resolving existing room..."
    RESOLVE=$(curl -sf "${HOMESERVER}/_matrix/client/v3/directory/room/%23nomad-hermes-node%3Alocalhost" \
      -H "Authorization: Bearer ${ADMIN_TOKEN}")
    ROOM_ID=$(echo "${RESOLVE}" | grep -o '"room_id":"[^"]*"' | cut -d'"' -f4)
  else
    echo "ERROR: Could not create room"
    echo "Response: ${CREATE_RESPONSE}"
    exit 1
  fi
fi

echo "  → Room created: ${ROOM_ID}"
_upsert_env "HERMES_MATRIX_ROOM_ID" "${ROOM_ID}"

# Invite hermes-bot
echo "  Inviting @hermes-bot:localhost..."
curl -sf -X POST "${HOMESERVER}/_matrix/client/v3/rooms/${ROOM_ID}/invite" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -d '{"user_id": "@hermes-bot:localhost"}' > /dev/null || echo "  WARNING: Could not invite hermes-bot"

# Have hermes-bot join the room
if [ -n "${HERMES_MATRIX_ACCESS_TOKEN:-}" ]; then
  echo "  Having hermes-bot join the room..."
  curl -sf -X POST "${HOMESERVER}/_matrix/client/v3/join/${ROOM_ID}" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${HERMES_MATRIX_ACCESS_TOKEN}" \
    -d '{}' > /dev/null || echo "  WARNING: hermes-bot could not join room"
fi

echo "  → HERMES_MATRIX_ROOM_ID=${ROOM_ID} written to .env"
