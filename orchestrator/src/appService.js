'use strict';

const { Pool } = require('pg');
const Redis = require('ioredis');
const EventHandler = require('./eventHandler');
const TranscriptStore = require('./transcriptStore');

const REDIS_TXN_TTL = 60; // seconds — dedup window

class AppService {
  /**
   * @param {import('winston').Logger} logger
   */
  constructor(logger) {
    this.logger = logger;
    this.pool = null;
    this.redis = null;
    this.transcriptStore = null;
    this.eventHandler = null;
    this._inMemoryTxnCache = new Map(); // fallback when Redis unavailable
  }

  async init() {
    // ─── PostgreSQL ─────────────────────────────────────────────────────────
    const dbUrl = process.env.DATABASE_URL;
    if (dbUrl) {
      try {
        this.pool = new Pool({ connectionString: dbUrl });
        // Ensure nomad_hermes database and schema exist
        await this._runMigrations();
        this.logger.info('PostgreSQL connected');
      } catch (err) {
        this.logger.warn({ msg: 'PostgreSQL unavailable (non-fatal during tests)', err: err.message });
        this.pool = null;
      }
    }

    // ─── Redis ──────────────────────────────────────────────────────────────
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    try {
      this.redis = new Redis(redisUrl, {
        lazyConnect: true,
        enableOfflineQueue: false,
        retryStrategy: (times) => (times > 3 ? null : Math.min(times * 200, 2000)),
      });
      await this.redis.connect();
      this.logger.info('Redis connected');
    } catch (err) {
      this.logger.warn({ msg: 'Redis unavailable — falling back to in-memory cache', err: err.message });
      this.redis = null;
    }

    this.transcriptStore = new TranscriptStore(this.pool, this.logger);
    this.eventHandler = new EventHandler(this.transcriptStore, this.logger);
  }

  /**
   * Handle a batch of events from Synapse.
   * Implements at-least-once delivery dedup via Redis (or in-memory fallback).
   *
   * @param {string} txnId
   * @param {object[]} events
   */
  async handleTransaction(txnId, events) {
    const key = `txn:${txnId}`;

    // ─── Deduplication ───────────────────────────────────────────────────
    const alreadySeen = await this._txnSeen(key);
    if (alreadySeen) {
      this.logger.debug({ msg: 'Duplicate transaction — skipping', txnId });
      return;
    }

    // ─── Process each message event ──────────────────────────────────────
    for (const event of events) {
      if (event.type !== 'm.room.message') continue;

      // Skip self-sent events from our bot user to avoid loops
      const botLocalpart = process.env.MATRIX_BOT_LOCALPART || 'hermes-orchestrator';
      const serverName = process.env.MATRIX_SERVER_NAME || 'localhost';
      const botUserId = `@${botLocalpart}:${serverName}`;
      if (event.sender === botUserId) continue;

      try {
        await this.eventHandler.process(event);
      } catch (err) {
        this.logger.error({ msg: 'Event processing error', eventId: event.event_id, err: err.message });
      }
    }

    // Mark as processed
    await this._txnMarkSeen(key);
  }

  // ─── Dedup helpers ───────────────────────────────────────────────────────

  async _txnSeen(key) {
    if (this.redis) {
      try {
        const val = await this.redis.get(key);
        return val !== null;
      } catch (_) {
        // fall through to in-memory
      }
    }
    return this._inMemoryTxnCache.has(key);
  }

  async _txnMarkSeen(key) {
    if (this.redis) {
      try {
        await this.redis.setex(key, REDIS_TXN_TTL, '1');
        return;
      } catch (_) {
        // fall through to in-memory
      }
    }
    this._inMemoryTxnCache.set(key, Date.now());
    // Prune old entries from in-memory cache (keep < 1000)
    if (this._inMemoryTxnCache.size > 1000) {
      const oldest = this._inMemoryTxnCache.keys().next().value;
      this._inMemoryTxnCache.delete(oldest);
    }
  }

  async _runMigrations() {
    const client = await this.pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS room_events (
          id              BIGSERIAL PRIMARY KEY,
          event_id        TEXT UNIQUE NOT NULL,
          room_id         TEXT NOT NULL,
          sender          TEXT NOT NULL,
          display_name    TEXT,
          event_type      TEXT NOT NULL,
          content_body    TEXT,
          content_msgtype TEXT,
          origin_server_ts BIGINT NOT NULL,
          is_ai_trigger   BOOLEAN DEFAULT FALSE,
          ai_modifier     TEXT,
          processed_at    TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_room_events_room_ts
          ON room_events (room_id, origin_server_ts DESC);
        CREATE INDEX IF NOT EXISTS idx_room_events_sender
          ON room_events (sender);
      `);
    } finally {
      client.release();
    }
  }
}

module.exports = AppService;
