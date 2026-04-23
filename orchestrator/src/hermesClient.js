'use strict';

const MAX_MSG_LENGTH = 4000;

// node-fetch v3 is ESM-only; use dynamic import wrapper
let _fetch;
async function fetchFn(...args) {
  if (!_fetch) {
    const mod = await import('node-fetch');
    _fetch = mod.default;
  }
  return _fetch(...args);
}

let _EventSourceParser;
async function getParser() {
  if (!_EventSourceParser) {
    const mod = await import('eventsource-parser');
    _EventSourceParser = mod.createParser;
  }
  return _EventSourceParser;
}

const HERMES_API_URL = process.env.HERMES_API_URL || 'http://hermes-agent:8642/v1/chat/completions';
const HERMES_API_KEY = process.env.HERMES_API_KEY || '';

class HermesClient {
  /**
   * @param {import('./matrixClient')} matrixClient
   * @param {import('winston').Logger} logger
   */
  constructor(matrixClient, logger) {
    this.matrixClient = matrixClient;
    this.logger = logger;
  }

  /**
   * Send a completion request to Hermes, stream the response, and post it
   * back to the Matrix room.
   *
   * @param {object} payload  - OpenAI-compatible request body (stream: true)
   * @param {string} roomId   - Target Matrix room ID
   */
  async query(payload, roomId) {
    // Show typing indicator
    await this.matrixClient.setTyping(roomId, true).catch(() => {});

    let response;
    try {
      response = await fetchFn(HERMES_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${HERMES_API_KEY}`,
        },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      await this.matrixClient.setTyping(roomId, false).catch(() => {});
      throw new Error(`Hermes API unreachable: ${err.message}`);
    }

    if (!response.ok) {
      await this.matrixClient.setTyping(roomId, false).catch(() => {});
      const errText = await response.text().catch(() => '');
      throw new Error(`Hermes API error ${response.status}: ${errText}`);
    }

    // ─── Stream SSE response ──────────────────────────────────────────────
    let assembled = '';
    const createParser = await getParser();

    const parser = createParser((event) => {
      if (event.type !== 'event') return;
      if (event.data === '[DONE]') return;

      try {
        const parsed = JSON.parse(event.data);

        // Filter out tool progress events (log only)
        if (parsed.type === 'hermes.tool.progress') {
          this.logger.debug({ msg: 'Hermes tool progress', data: parsed });
          return;
        }

        const delta = parsed.choices && parsed.choices[0] && parsed.choices[0].delta;
        if (delta && delta.content) {
          assembled += delta.content;
        }
      } catch (_) {
        // Ignore malformed SSE data chunks
      }
    });

    try {
      for await (const chunk of response.body) {
        parser.feed(chunk.toString());
      }
    } catch (err) {
      this.logger.warn({ msg: 'Stream interrupted', err: err.message });
    }

    await this.matrixClient.setTyping(roomId, false).catch(() => {});

    if (!assembled.trim()) {
      assembled = '_Hermes returned an empty response._';
    }

    // ─── Post response (split if > MAX_MSG_LENGTH chars) ─────────────────
    const chunks = this._splitMessage(assembled);
    for (const chunk of chunks) {
      await this.matrixClient.sendMessage(roomId, chunk);
    }
  }

  _splitMessage(text) {
    if (text.length <= MAX_MSG_LENGTH) return [text];

    const chunks = [];
    let remaining = text;
    while (remaining.length > 0) {
      // Try to split at a newline boundary near the limit
      let splitAt = MAX_MSG_LENGTH;
      if (remaining.length > MAX_MSG_LENGTH) {
        const nlIdx = remaining.lastIndexOf('\n', MAX_MSG_LENGTH);
        splitAt = nlIdx > MAX_MSG_LENGTH / 2 ? nlIdx : MAX_MSG_LENGTH;
      }
      chunks.push(remaining.slice(0, splitAt));
      remaining = remaining.slice(splitAt);
    }
    return chunks;
  }
}

module.exports = HermesClient;
