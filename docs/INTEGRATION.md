# Integration Guide — NOMAD-Hermes Node v2.0.0

## Matrix Application Service Registration

The Orchestrator registers as a Matrix Application Service (AS) with Synapse. This gives it:
- A privileged push stream of **all** room events (no polling)
- Server-level trust (never rate-limited by Synapse)
- Ability to post as `@hermes-orchestrator:localhost` without standard auth

### Registration file: `config/hermes-as-registration.yaml`

```yaml
id: "nomad-hermes-orchestrator"
url: "http://orchestrator:4000"
as_token: "${MATRIX_AS_TOKEN}"   # substituted by setup.sh
hs_token: "${MATRIX_HS_TOKEN}"   # substituted by setup.sh
sender_localpart: "hermes-orchestrator"
namespaces:
  users:
    - exclusive: true
      regex: "@hermes-orchestrator:.*"
```

`setup.sh` substitutes tokens and copies to `upstream/synapse-data/appservices/hermes-orchestrator.yaml`, which is referenced in `homeserver.yaml`.

**Synapse must be restarted after writing this file** (handled by `setup.sh` step 12).

## Critical Constraint: No Double-Fire

Hermes Agent has a built-in Matrix gateway. If enabled, it would independently consume `!hermes` messages — resulting in **two AI responses** per trigger.

**Solution:** Disable Hermes's gateway triggers in `config/hermes-config.yaml`:
```yaml
gateway:
  matrix:
    trigger_prefix: "__DISABLED__"
    trigger_mention: false
```

All AI routing flows through the Orchestrator → Hermes API path exclusively.

## Transaction Deduplication

Synapse delivers events **at-least-once**. Network hiccups can re-deliver the same transaction. Without dedup, every re-delivery generates a duplicate AI response.

**Implementation:** Redis sorted set with TTL 60s per transaction ID:
```
Key: txn:{txnId}
Value: "1" (string)
TTL: 60 seconds
```
Falls back to an in-memory Map if Redis is unavailable.

## Context Injection

Before every Hermes API call, the Orchestrator:
1. Queries `nomad_hermes.room_events` for the last 20 messages
2. Formats them as a transcript header
3. Detects modifiers (`search:docs`, `search:wiki`, `summarize`, `remember`)
4. Builds an OpenAI-compatible payload with `system` + `user` messages and `stream: true`

## Hermes API Integration

The Orchestrator calls Hermes Agent's `/v1/chat/completions` endpoint (OpenAI-compatible):
```
POST http://hermes-agent:8642/v1/chat/completions
Authorization: Bearer ${HERMES_API_KEY}
Content-Type: application/json
```
Responses are streamed via SSE. `hermes.tool.progress` events are logged but not relayed to the room. The full assembled response is posted to Matrix via `PUT /_matrix/client/v3/rooms/.../send/m.room.message`.

## NOMAD Integration

NOMAD runs as an included Compose stack (`upstream/project-nomad/docker-compose.yml`). A compose override (`config/nomad-compose-override.yml`) attaches NOMAD services to `nomad-hermes-net` and remaps NOMAD Command Center from 8080 → 8081.

Hermes queries NOMAD's Ollama at `http://nomad_ollama:11434/v1` directly. The Orchestrator queries `http://nomad_command_center:8080/api/health` and `http://nomad_ollama:11434/api/tags` for status commands.

## Rate Limiting

Sliding window algorithm using Redis sorted sets:
- Key: `ratelimit:ai:{roomId}`
- Score: timestamp (ms)
- Window: 60 seconds
- Default limit: 10 requests/min per room (configurable via `AI_RATE_LIMIT_PER_MINUTE`)

Falls back to in-memory Map per room if Redis unavailable.
