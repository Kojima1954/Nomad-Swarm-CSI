# NOMAD-Hermes Group Chat Node (Matrix Edition) — v2.0.0

A single, self-hosted, AI-connected group chatroom integrating **Project N.O.M.A.D.**, **Hermes Agent**, **Matrix (Synapse + Element Web)**, and supporting infrastructure into one Docker Compose stack.

## Quick Start

```bash
# One-time setup
bash scripts/setup.sh

# Health check
bash scripts/healthcheck.sh

# Open in browser
# Element Web:      http://localhost:8080
# NOMAD Command:    http://localhost:8081
# Synapse API:      http://localhost:8008
# Orchestrator:     http://localhost:4000/health
```

## Requirements

- Ubuntu 22.04 (or compatible Linux)
- Docker Engine 24+
- Docker Compose v2 (`docker compose` — not `docker-compose`)
- `git`, `curl`, `openssl` (standard Ubuntu packages)

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           nomad-hermes-net (Docker bridge)                  │
│                                                                             │
│  ┌──────────┐   ┌──────────┐   ┌───────────────┐   ┌──────────────────┐   │
│  │  Element │   │  Synapse │   │ Orchestrator  │   │  Hermes Agent    │   │
│  │  Web     │   │ :8008    │   │ (AS) :4000    │   │  :8642           │   │
│  │  :8080   │◄──┤          │──►│               │──►│                  │   │
│  └──────────┘   │          │   │  eventHandler │   │  /v1/chat/...    │   │
│                 │  push all│   │  contextInj.  │   └────────┬─────────┘   │
│                 │  events  │   │  rateLimiter  │            │             │
│                 └────┬─────┘   └──────┬────────┘      ┌────▼─────────┐   │
│                      │                │               │  NOMAD       │   │
│  ┌───────────────┐   │   ┌────────────▼──────────┐   │  Ollama      │   │
│  │  synapse-     │◄──┘   │  Redis (dedup+rate)   │   │  :11434      │   │
│  │  postgres     │       └───────────────────────┘   └──────────────┘   │
│  │  :5432        │                                                        │
│  │  [synapse DB] │       ┌───────────────────────┐   ┌──────────────┐   │
│  │  [nomad_hermes│       │  nomad_hermes DB       │   │  NOMAD CC    │   │
│  │   transcript] │◄──────│  (transcripts)         │   │  :8081       │   │
│  └───────────────┘       └───────────────────────┘   └──────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Services

| Service | Port | Description |
|---|---|---|
| `element-web` | 8080 | Matrix web client (Element) |
| `synapse` | 8008 | Matrix homeserver |
| `orchestrator` | 4000 | Application Service + room manager |
| `hermes-agent` | 8642 | AI engine (Hermes + Ollama) |
| `synapse-postgres` | 5432 | PostgreSQL (Synapse + transcript DB) |
| `redis` | 6379 | Rate limiting + txn dedup cache |
| `nomad_command_center` | 8081 | NOMAD document/wiki manager |
| `nomad_ollama` | 11434 | Ollama LLM inference |
| `nomad_qdrant` | 6333 | Vector database |

## Usage

See [docs/USAGE.md](docs/USAGE.md) for the full command reference.

## Updating

```bash
bash scripts/update.sh
```

## Offline Operation

After `setup.sh` completes, the system is fully offline. No outbound internet connections are made at runtime. All AI inference uses NOMAD's local Ollama instance.

## License

See [LICENSE](LICENSE).
