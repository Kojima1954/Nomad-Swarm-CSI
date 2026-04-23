'use strict';

const express = require('express');

// node-fetch v3 is ESM-only; use dynamic import wrapper
let _fetch;
async function fetchFn(...args) {
  if (!_fetch) {
    const mod = await import('node-fetch');
    _fetch = mod.default;
  }
  return _fetch(...args);
}

const router = express.Router();

const SERVICES = {
  synapse: process.env.MATRIX_HOMESERVER_URL || 'http://synapse:8008',
  hermes: `http://hermes-agent:${process.env.HERMES_API_PORT || '8642'}`,
  nomad_ollama: 'http://nomad_ollama:11434',
};

async function checkService(name, url, path) {
  const start = Date.now();
  try {
    const res = await fetchFn(`${url}${path}`, { timeout: 5000 });
    return { name, status: res.ok ? 'ok' : 'degraded', code: res.status, ms: Date.now() - start };
  } catch (err) {
    return { name, status: 'down', error: err.message, ms: Date.now() - start };
  }
}

router.get('/', async (req, res) => {
  const [synapse, hermes, nomad_ollama] = await Promise.all([
    checkService('synapse', SERVICES.synapse, '/_matrix/client/versions'),
    checkService('hermes', SERVICES.hermes, '/v1/models'),
    checkService('nomad_ollama', SERVICES.nomad_ollama, '/api/tags'),
  ]);

  // Postgres & Redis are checked via the pool/client on the app service
  const postgres = { name: 'postgres', status: 'unknown' };
  const redis = { name: 'redis', status: 'unknown' };

  const allOk = [synapse, hermes, nomad_ollama].every((s) => s.status === 'ok');

  res.status(allOk ? 200 : 503).json({
    status: allOk ? 'ok' : 'degraded',
    version: '2.0.0',
    services: { synapse, hermes, nomad_ollama, postgres, redis },
  });
});

module.exports = router;
