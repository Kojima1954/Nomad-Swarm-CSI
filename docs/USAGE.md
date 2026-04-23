# Usage Guide — NOMAD-Hermes Node

## Getting Started

### 1. Open Element Web

Navigate to **http://localhost:8080**

### 2. Register / Sign In

Click **Create Account** and register on `localhost` (your local Synapse server).

### 3. Join the Room

Join the room `#nomad-hermes-node:localhost`:
- Click the **+** next to **Rooms** in the left sidebar
- Search for `nomad-hermes-node` or enter the full alias

### 4. Start Chatting

Type `!help` to see the command list.

---

## Command Reference

| Command | Effect |
|---|---|
| `!hermes [question]` | Ask Hermes a general question |
| `!hermes search:docs [query]` | Search NOMAD's document knowledge base |
| `!hermes search:wiki [query]` | Search NOMAD's offline Wikipedia knowledge base |
| `!hermes summarize last [N]` | Summarize the last N messages in 3-5 bullet points |
| `!hermes remember [note]` | Save a persistent memory note across sessions |
| `@hermes-bot [message]` | Mention the bot directly (same as `!hermes`) |
| `!nomad status` | Show NOMAD/Ollama service health summary |
| `!nomad models` | List available AI models in Ollama |
| `!nomad docs list` | List uploaded documents in NOMAD |
| `!room users` | List current room members |
| `!room stats` | Room usage statistics (total messages, AI queries) |
| `!room transcript [N]` | Show last N messages (default 10) |
| `!help` | Show this command list |

---

## Uploading Documents to NOMAD

1. Open **http://localhost:8081** (NOMAD Command Center)
2. Upload EPUBs, PDFs, or text files via the document upload interface
3. NOMAD indexes the documents for search
4. Use `!hermes search:docs [topic]` to query them

---

## AI Response Formatting

Hermes formats all responses in **Markdown**. Element Web renders Markdown natively:
- **Bold text**, *italics*, `code blocks`
- Tables, bullet lists, headers
- Source prefixes: `[NOMAD DOCS]`, `[NOMAD WIKI]`, `[HERMES MEMORY]`

---

## Rate Limits

By default, the room is limited to **10 AI requests per minute** to prevent flooding. If you hit the limit, wait a moment and try again. The limit is configurable via `AI_RATE_LIMIT_PER_MINUTE` in `.env`.

---

## Offline Use

After `setup.sh` completes, the entire stack runs offline. No internet connection is required at runtime. All AI inference uses the local `llama3.1:8b` model via NOMAD's Ollama instance.

---

## Persistent Data

After `docker compose down && docker compose up -d`:
- **Room history** — preserved in PostgreSQL (`synapse_db_data` volume)
- **Hermes memory** — preserved in `hermes_data` volume  
- **NOMAD knowledge base** — preserved in `nomad_data`, `nomad_ollama_data`, `nomad_qdrant_data` volumes
- **Transcript store** — preserved in `synapse_db_data` volume (`nomad_hermes` database)

To completely reset: `docker compose down -v` (destroys all volumes).
