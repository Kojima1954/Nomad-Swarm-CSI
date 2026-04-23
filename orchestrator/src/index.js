'use strict';

require('dotenv').config();

const express = require('express');
const { createLogger, transports, format } = require('winston');

const AppService = require('./appService');
const healthRouter = require('./healthRouter');

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(format.timestamp(), format.json()),
  transports: [new transports.Console()],
});

const PORT = parseInt(process.env.PORT || '4000', 10);
const MATRIX_HS_TOKEN = process.env.MATRIX_HS_TOKEN || '';

// ─── Middleware ───────────────────────────────────────────────────────────────

/**
 * Verify the Synapse → Orchestrator HS token.
 * Every AS endpoint MUST call this guard.
 */
function verifyHsToken(req, res, next) {
  const token = req.query.access_token || '';
  if (!MATRIX_HS_TOKEN) {
    logger.warn('MATRIX_HS_TOKEN not configured — rejecting all AS requests');
    return res.status(403).json({ error: 'AS token not configured' });
  }
  if (token !== MATRIX_HS_TOKEN) {
    logger.warn({ msg: 'AS token mismatch', ip: req.ip });
    return res.status(403).json({ error: 'Forbidden' });
  }
  return next();
}

async function main() {
  const appService = new AppService(logger);
  await appService.init();

  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // ─── Matrix Application Service endpoints ────────────────────────────────

  /**
   * PUT /_matrix/app/v1/transactions/:txnId
   * Synapse pushes batches of room events here.
   * Must respond HTTP 200 within 30s.
   */
  app.put('/_matrix/app/v1/transactions/:txnId', verifyHsToken, async (req, res) => {
    const { txnId } = req.params;
    const { events = [] } = req.body;

    // Respond immediately — process async to stay within 30s window
    res.json({});

    try {
      await appService.handleTransaction(txnId, events);
    } catch (err) {
      logger.error({ msg: 'Error handling transaction', txnId, err: err.message });
    }
  });

  /**
   * GET /_matrix/app/v1/users/:userId
   * User provisioning — return 200 {} for any bot user in our namespace.
   */
  app.get('/_matrix/app/v1/users/:userId', verifyHsToken, (req, res) => {
    res.json({});
  });

  /**
   * GET /_matrix/app/v1/rooms/:roomAlias
   * Room provisioning — not supported.
   */
  app.get('/_matrix/app/v1/rooms/:roomAlias', verifyHsToken, (req, res) => {
    res.status(404).json({ error: 'Room not found' });
  });

  // ─── Internal / health endpoints ─────────────────────────────────────────

  app.use('/health', healthRouter);

  app.get('/api/transcript/:roomId', async (req, res) => {
    try {
      const events = await appService.transcriptStore.getTranscript(req.params.roomId, 50);
      res.json({ events });
    } catch (err) {
      logger.error({ msg: 'Transcript fetch error', err: err.message });
      res.status(500).json({ error: 'Internal error' });
    }
  });

  app.listen(PORT, () => {
    logger.info(`NOMAD-Hermes Orchestrator listening on port ${PORT}`);
  });
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
