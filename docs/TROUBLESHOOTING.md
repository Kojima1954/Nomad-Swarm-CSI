# Troubleshooting — NOMAD-Hermes Node

## Quick Diagnostic

```bash
bash scripts/healthcheck.sh
docker compose ps
docker compose logs --tail=50 <service>
```

---

## Common Issues

### Synapse fails to start

**Symptom:** `docker compose logs synapse` shows database connection errors.

**Fix:**
```bash
docker compose up -d synapse-postgres
# Wait 10s for PG to initialize
docker compose up -d synapse
```

### Synapse not loading the AS registration

**Symptom:** Orchestrator receives no events; logs show no AS webhook calls.

**Check:**
```bash
docker compose exec synapse cat /data/appservices/hermes-orchestrator.yaml
```

**Fix:** The registration file must be present **and Synapse must be restarted**:
```bash
docker compose restart synapse
```

### Orchestrator returns HTTP 403

**Symptom:** Synapse logs show 403 responses from `http://orchestrator:4000`.

**Cause:** `MATRIX_HS_TOKEN` mismatch between Synapse's registered token and the Orchestrator's `.env`.

**Fix:**
```bash
# Check what token Synapse has:
cat upstream/synapse-data/appservices/hermes-orchestrator.yaml | grep hs_token
# Check what token Orchestrator has:
grep MATRIX_HS_TOKEN .env
# If they differ, re-run setup.sh or manually update .env and restart orchestrator
```

### Hermes not responding to !hermes commands

**Symptom:** No response in the room; no errors in orchestrator logs.

**Checks:**
1. Is the Orchestrator receiving events?
   ```bash
   docker compose logs orchestrator --follow
   ```
2. Is Hermes Agent running?
   ```bash
   curl http://localhost:8642/v1/models
   ```
3. Is rate limiting active?
   The room gets max `AI_RATE_LIMIT_PER_MINUTE` (default 10) requests/minute.

### Duplicate AI responses

**Symptom:** Two identical responses appear after a single `!hermes` command.

**Cause:** Both the Orchestrator (AS path) and Hermes's own Matrix gateway responded.

**Fix:** Ensure `config/hermes-config.yaml` has:
```yaml
gateway:
  matrix:
    trigger_prefix: "__DISABLED__"
    trigger_mention: false
```
Then restart hermes-agent: `docker compose restart hermes-agent`

### Ollama out of memory

**Symptom:** `!hermes` commands timeout; Ollama logs show OOM errors.

**Fix:** Reduce `num_ctx` in `config/ollama-modelfile` (e.g., 16384) and recreate the model:
```bash
docker cp config/ollama-modelfile nomad_ollama:/tmp/nomad-hermes-modelfile
docker exec nomad_ollama ollama create nomad-hermes -f /tmp/nomad-hermes-modelfile
docker compose restart hermes-agent
```

### Port 8080 conflict

**Symptom:** `docker compose up` fails with "port already in use".

**Cause:** Something else is running on port 8080 (e.g., another web server).

**Fix:** Edit `.env` and `docker-compose.yml` to change Element Web's port:
```yaml
element-web:
  ports: ["8090:80"]   # change 8080 to 8090
```

### PostgreSQL "nomad_hermes database does not exist"

**Symptom:** Orchestrator logs show `database "nomad_hermes" does not exist`.

**Fix:** The Orchestrator auto-creates the `nomad_hermes` DB via `DATABASE_URL`. If the URL uses a non-existent database, create it manually:
```bash
docker compose exec synapse-postgres psql -U synapse -c "CREATE DATABASE nomad_hermes;"
docker compose restart orchestrator
```

---

## Logs

| Service | Command |
|---|---|
| Synapse | `docker compose logs synapse` |
| Orchestrator | `docker compose logs orchestrator` |
| Hermes Agent | `docker compose logs hermes-agent` |
| PostgreSQL | `docker compose logs synapse-postgres` |
| Redis | `docker compose logs redis` |
| Element Web | `docker compose logs element-web` |
| NOMAD Ollama | `docker logs nomad_ollama` |

---

## Full Reset

```bash
docker compose down -v          # remove all containers AND volumes
bash scripts/setup.sh           # start fresh
```
