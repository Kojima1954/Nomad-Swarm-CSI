'use strict';

// node-fetch v3 is ESM-only; use dynamic import wrapper
let _fetch;
async function fetchFn(...args) {
  if (!_fetch) {
    const mod = await import('node-fetch');
    _fetch = mod.default;
  }
  return _fetch(...args);
}

const MATRIX_HOMESERVER_URL = process.env.MATRIX_HOMESERVER_URL || 'http://synapse:8008';
const MATRIX_AS_TOKEN = process.env.MATRIX_AS_TOKEN || '';
const BOT_LOCALPART = process.env.MATRIX_BOT_LOCALPART || 'hermes-orchestrator';
const SERVER_NAME = process.env.MATRIX_SERVER_NAME || 'localhost';
const BOT_USER_ID = `@${BOT_LOCALPART}:${SERVER_NAME}`;

class MatrixClient {
  /**
   * @param {import('winston').Logger} logger
   * @param {import('./transcriptStore')|null} [transcriptStore]
   */
  constructor(logger, transcriptStore = null) {
    this.logger = logger;
    this._transcriptStore = transcriptStore;
    this._txnCounter = 0;
  }

  /**
   * Send a text message to a Matrix room.
   *
   * @param {string} roomId
   * @param {string} body   - Markdown body text
   * @param {string} [fmt]  - 'markdown' (default) or 'plain'
   */
  async sendMessage(roomId, body, fmt = 'markdown') {
    const txnId = `orch-${Date.now()}-${++this._txnCounter}`;
    const url = `${MATRIX_HOMESERVER_URL}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txnId}?user_id=${encodeURIComponent(BOT_USER_ID)}`;

    const content = {
      msgtype: 'm.text',
      body,
    };

    if (fmt === 'markdown') {
      content.format = 'org.matrix.custom.html';
      content.formatted_body = this._markdownToHtml(body);
    }

    try {
      const res = await fetchFn(url, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${MATRIX_AS_TOKEN}`,
        },
        body: JSON.stringify(content),
      });

      if (!res.ok) {
        const err = await res.text().catch(() => '');
        this.logger.error({ msg: 'Matrix sendMessage failed', status: res.status, err });
      }
    } catch (err) {
      this.logger.error({ msg: 'Matrix sendMessage error', err: err.message });
    }
  }

  /**
   * Get joined members of a room.
   *
   * @param {string} roomId
   * @returns {Promise<{joined: object}>}
   */
  async getJoinedMembers(roomId) {
    const url = `${MATRIX_HOMESERVER_URL}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/joined_members?user_id=${encodeURIComponent(BOT_USER_ID)}`;

    const res = await fetchFn(url, {
      headers: { Authorization: `Bearer ${MATRIX_AS_TOKEN}` },
    });

    if (!res.ok) throw new Error(`Matrix getJoinedMembers error: HTTP ${res.status}`);
    return res.json();
  }

  /**
   * Set typing indicator for the bot in a room.
   *
   * @param {string} roomId
   * @param {boolean} isTyping
   */
  async setTyping(roomId, isTyping) {
    const url = `${MATRIX_HOMESERVER_URL}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/typing/${encodeURIComponent(BOT_USER_ID)}?user_id=${encodeURIComponent(BOT_USER_ID)}`;

    await fetchFn(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${MATRIX_AS_TOKEN}`,
      },
      body: JSON.stringify({ typing: isTyping, timeout: isTyping ? 30000 : 0 }),
    }).catch((err) => {
      this.logger.warn({ msg: 'setTyping failed', err: err.message });
    });
  }

  /**
   * Get room state events.
   *
   * @param {string} roomId
   * @returns {Promise<object[]>}
   */
  async getRoomState(roomId) {
    const url = `${MATRIX_HOMESERVER_URL}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state?user_id=${encodeURIComponent(BOT_USER_ID)}`;

    const res = await fetchFn(url, {
      headers: { Authorization: `Bearer ${MATRIX_AS_TOKEN}` },
    });

    if (!res.ok) throw new Error(`Matrix getRoomState error: HTTP ${res.status}`);
    return res.json();
  }

  /**
   * Get room statistics (delegates to transcriptStore if available).
   *
   * @param {string} roomId
   * @returns {Promise<object>}
   */
  async getRoomStats(roomId) {
    if (this._transcriptStore) {
      return this._transcriptStore.getRoomStats(roomId);
    }
    return { total: 0, ai_triggers: 0, first_ts: null };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Very basic Markdown → HTML conversion (bold, italic, code, links).
   * For full rendering, Element Web renders Markdown natively.
   */
  _markdownToHtml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
      .replace(/\n/g, '<br>');
  }
}

module.exports = MatrixClient;
