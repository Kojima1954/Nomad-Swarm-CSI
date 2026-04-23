'use strict';

const MAX_MSG_LENGTH = 4000;

class TranscriptStore {
  /**
   * @param {import('pg').Pool|null} pool
   * @param {import('winston').Logger} logger
   */
  constructor(pool, logger) {
    this.pool = pool;
    this.logger = logger;
  }

  /**
   * Persist a Matrix room event to PostgreSQL.
   * No-op if pool is unavailable.
   *
   * @param {object} event - Raw Matrix event
   */
  async saveEvent(event) {
    if (!this.pool) return;

    const body = event.content && event.content.body;
    const msgtype = event.content && event.content.msgtype;

    const triggerPrefix = process.env.AI_TRIGGER_PREFIX || '!hermes';
    const isAiTrigger = Boolean(body && (
      body.startsWith(triggerPrefix) || body.toLowerCase().includes('@hermes-bot')
    ));

    const aiModifier = isAiTrigger ? this._extractModifier(body) : null;

    try {
      await this.pool.query(
        `INSERT INTO room_events
           (event_id, room_id, sender, display_name, event_type,
            content_body, content_msgtype, origin_server_ts, is_ai_trigger, ai_modifier)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (event_id) DO NOTHING`,
        [
          event.event_id,
          event.room_id,
          event.sender,
          (event.content && event.content.displayname) || null,
          event.type || 'm.room.message',
          body || null,
          msgtype || null,
          event.origin_server_ts,
          isAiTrigger,
          aiModifier,
        ]
      );
    } catch (err) {
      this.logger.error({ msg: 'Failed to insert event', eventId: event.event_id, err: err.message });
      throw err;
    }
  }

  /**
   * Retrieve the last `limit` messages for a room, ordered newest-first.
   *
   * @param {string} roomId
   * @param {number} limit
   * @returns {Promise<object[]>}
   */
  async getTranscript(roomId, limit = 20) {
    if (!this.pool) return [];

    const { rows } = await this.pool.query(
      `SELECT * FROM room_events
       WHERE room_id = $1
       ORDER BY origin_server_ts DESC
       LIMIT $2`,
      [roomId, limit]
    );
    return rows;
  }

  /**
   * Aggregate room usage statistics.
   *
   * @param {string} roomId
   * @returns {Promise<{total: number, ai_triggers: number, first_ts: number|null}>}
   */
  async getRoomStats(roomId) {
    if (!this.pool) return { total: 0, ai_triggers: 0, first_ts: null };

    const { rows } = await this.pool.query(
      `SELECT
         COUNT(*)::int                        AS total,
         COUNT(*) FILTER (WHERE is_ai_trigger)::int AS ai_triggers,
         MIN(origin_server_ts)                AS first_ts
       FROM room_events
       WHERE room_id = $1`,
      [roomId]
    );
    return rows[0] || { total: 0, ai_triggers: 0, first_ts: null };
  }

  /**
   * Full-text search across a room's message history.
   *
   * @param {string} roomId
   * @param {string} query
   * @returns {Promise<object[]>}
   */
  async searchEvents(roomId, query) {
    if (!this.pool) return [];

    const { rows } = await this.pool.query(
      `SELECT * FROM room_events
       WHERE room_id = $1
         AND to_tsvector('english', COALESCE(content_body, '')) @@ plainto_tsquery('english', $2)
       ORDER BY origin_server_ts DESC
       LIMIT 20`,
      [roomId, query]
    );
    return rows;
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  _extractModifier(body) {
    if (!body) return null;
    if (/!hermes\s+search:docs/i.test(body)) return 'search:docs';
    if (/!hermes\s+search:wiki/i.test(body)) return 'search:wiki';
    if (/!hermes\s+summarize/i.test(body)) return 'summarize';
    if (/!hermes\s+remember/i.test(body)) return 'remember';
    return null;
  }
}

module.exports = TranscriptStore;
