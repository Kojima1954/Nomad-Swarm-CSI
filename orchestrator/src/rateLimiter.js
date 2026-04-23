'use strict';

const RATE_LIMIT = parseInt(process.env.AI_RATE_LIMIT_PER_MINUTE || '10', 10);
const WINDOW_MS = 60 * 1000; // 1 minute sliding window

class RateLimiter {
  /**
   * @param {import('winston').Logger} logger
   * @param {import('ioredis')|null} [redis]
   */
  constructor(logger, redis = null) {
    this.logger = logger;
    this.redis = redis;
    // Fallback: in-memory per-room sorted set (Array of timestamps)
    this._store = new Map();
  }

  /**
   * Check whether a new AI request for the given room is within rate limits.
   * Uses a sliding-window algorithm backed by Redis sorted sets.
   * Falls back to in-memory if Redis is unavailable.
   *
   * @param {string} roomId
   * @returns {Promise<boolean>} true = allowed, false = rate limited
   */
  async check(roomId) {
    if (this.redis) {
      try {
        return await this._checkRedis(roomId);
      } catch (err) {
        this.logger.warn({ msg: 'Redis rate-limiter error — falling back to in-memory', err: err.message });
      }
    }
    return this._checkMemory(roomId);
  }

  // ─── Redis implementation ─────────────────────────────────────────────────

  async _checkRedis(roomId) {
    const key = `ratelimit:ai:${roomId}`;
    const now = Date.now();
    const windowStart = now - WINDOW_MS;

    // Remove entries outside the window
    await this.redis.zremrangebyscore(key, '-inf', windowStart);
    const count = await this.redis.zcard(key);

    if (count >= RATE_LIMIT) {
      return false;
    }

    // Add current timestamp with a unique member to avoid sorted set collisions
    await this.redis.zadd(key, now, `${now}-${process.hrtime.bigint().toString()}`);
    await this.redis.expire(key, 60);
    return true;
  }

  // ─── In-memory fallback ───────────────────────────────────────────────────

  _checkMemory(roomId) {
    const now = Date.now();
    const windowStart = now - WINDOW_MS;

    if (!this._store.has(roomId)) {
      this._store.set(roomId, []);
    }

    const timestamps = this._store.get(roomId).filter((t) => t > windowStart);
    this._store.set(roomId, timestamps);

    if (timestamps.length >= RATE_LIMIT) {
      return false;
    }

    timestamps.push(now);
    return true;
  }
}

module.exports = RateLimiter;
