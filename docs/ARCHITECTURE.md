# Architecture — NOMAD-Hermes Node v2.0.0

## Overview

NOMAD-Hermes Node is a single Docker Compose application that integrates:
- **Matrix Synapse** — self-hosted chat homeserver
- **Element Web** — Matrix web client
- **Project N.O.M.A.D.** — offline knowledge base (documents + Wikipedia + Ollama LLM)
- **Hermes Agent** — AI engine with memory and skill pipeline
- **Orchestrator** — Matrix Application Service (Node.js/Express)

## Dual-Channel AI Integration

### Channel A — Hermes Native Matrix Gateway (Awareness Only)
Hermes Agent's built-in Matrix gateway is configured but with triggers **disabled** (`trigger_prefix: "__DISABLED__"`, `trigger_mention: false`). This keeps Hermes aware of the room and registered as `@hermes-bot` without responding to messages directly.

### Channel B — Matrix Application Service (Primary)
The Orchestrator registers as a Matrix Application Service. Synapse pushes **all room events** to `http://orchestrator:4000/_matrix/app/v1/transactions/:txnId`. The Orchestrator:
1. Deduplicates transactions via Redis sorted set (TTL 60s)
2. Persists every `m.room.message` to PostgreSQL (`nomad_hermes.room_events`)
3. Routes commands: `!nomad`, `!room`, `!help`, `!hermes`/mentions
4. For AI triggers: fetches last 20 messages, injects as context, calls `hermes-agent:8642/v1/chat/completions`, streams response back to room

This design prevents the "double-fire" problem where both channels would respond to the same trigger.

## Request Flow

```
User types "!hermes what is photosynthesis?"
        │
        ▼
  Synapse (Matrix homeserver)
        │  pushes event batch
        ▼
  Orchestrator /_matrix/app/v1/transactions/:txnId
        │  [1] responds HTTP 200 immediately
        │  [2] checks Redis for txnId dedup
        │  [3] saves event to PostgreSQL
        │  [4] detects !hermes trigger
        │  [5] checks rate limit (10/min per room)
        │  [6] fetches last 20 messages from PG
        │  [7] formats context + user query
        │  [8] POST to hermes-agent:8642/v1/chat/completions
        │         │  streams SSE response tokens
        │         ▼
        │  nomad_ollama:11434 (llama3.1:8b)
        │  [9] assembles full response
        │  [10] PUT to synapse /_matrix/client/v3/rooms/.../send
        ▼
  Room sees @hermes-orchestrator's response
```

## Database Architecture

Single PostgreSQL instance (`synapse-postgres`) hosts two databases:
- `synapse` — Synapse's internal state (managed by Synapse)
- `nomad_hermes` — Room transcript store (managed by Orchestrator)

The `room_events` table uses `BIGSERIAL` primary key, `UNIQUE(event_id)` for idempotent inserts, and two indexes for efficient transcript queries.

## Port Map

| Port | Service | Notes |
|------|---------|-------|
| 8008 | Synapse | Matrix homeserver |
| 8080 | Element Web | Matrix web client |
| 8081 | NOMAD Command Center | Remapped from 8080 via override |
| 4000 | Orchestrator | AS webhook + health + API |
| 8642 | Hermes Agent | AI API server |
| 11434 | Ollama | LLM inference |
| 6333 | Qdrant | Vector database |
| 5432 | PostgreSQL | Synapse + transcript DB |
| 6379 | Redis | Rate limiting + txn dedup |

## Security Properties

- AS token verification on every Synapse → Orchestrator request (HTTP 403 otherwise)
- Transaction dedup prevents replay attacks causing duplicate AI responses
- No federation: `default_federate: false`, `federation_domain_whitelist: []`
- No external API calls at runtime (fully offline after setup)
- All secrets generated via `openssl rand -hex 32`
