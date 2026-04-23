'use strict';

const CONTEXT_WINDOW = parseInt(process.env.TRANSCRIPT_CONTEXT_WINDOW || '20', 10);
const MODEL = process.env.HERMES_MODEL || 'nomad-hermes';
const SERVER_NAME = (process.env.MATRIX_HOMESERVER_URL || 'http://localhost:8008')
  .replace(/^https?:\/\//, '').split(':')[0] || 'localhost';
const ROOM_NAME = `#nomad-hermes-node:${SERVER_NAME}`;

class ContextInjector {
  /**
   * @param {import('./transcriptStore')} transcriptStore
   * @param {import('winston').Logger} logger
   */
  constructor(transcriptStore, logger) {
    this.transcriptStore = transcriptStore;
    this.logger = logger;
  }

  /**
   * Build an OpenAI-compatible chat completion payload for Hermes.
   *
   * @param {object} triggerEvent - The Matrix event that triggered the AI call
   * @returns {object} OpenAI-compatible payload
   */
  async buildPayload(triggerEvent) {
    const body = (triggerEvent.content && triggerEvent.content.body) || '';

    // ─── 1. Fetch transcript context ──────────────────────────────────────
    let rows = [];
    try {
      rows = await this.transcriptStore.getTranscript(triggerEvent.room_id, CONTEXT_WINDOW);
    } catch (err) {
      this.logger.warn({ msg: 'Could not fetch transcript for context injection', err: err.message });
    }

    const transcript = this._formatTranscript(rows.reverse());

    // ─── 2. Detect modifier ───────────────────────────────────────────────
    const modifier = this._detectModifier(body);

    // ─── 3. Build messages array ──────────────────────────────────────────
    const systemMsg = {
      role: 'system',
      content: `You are Hermes, an AI assistant embedded in a Matrix group chatroom connected to the NOMAD offline knowledge base. Format your responses in Markdown.`,
    };

    const userContent = [transcript, modifier].filter(Boolean).join('\n\n') + `\n\nUser message: ${body}`;

    const userMsg = {
      role: 'user',
      content: userContent,
    };

    return {
      model: MODEL,
      messages: [systemMsg, userMsg],
      stream: true,
      max_tokens: 2048,
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  _formatTranscript(rows) {
    if (!rows || rows.length === 0) return '';

    const lines = rows.map((r) => {
      const name = r.display_name || r.sender || 'Unknown';
      const time = new Date(Number(r.origin_server_ts)).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      return `${name} (${time}): ${r.content_body || ''}`;
    });

    return `[ROOM TRANSCRIPT - last ${rows.length} messages in ${ROOM_NAME}]\n${lines.join('\n')}\n[END TRANSCRIPT]`;
  }

  _detectModifier(body) {
    const b = body.trim();

    if (/!hermes\s+search:docs\s+(.+)/i.test(b)) {
      return "Search NOMAD's uploaded document knowledge base for relevant information.";
    }

    if (/!hermes\s+search:wiki\s+(.+)/i.test(b)) {
      return "Search NOMAD's offline Wikipedia knowledge base for relevant information.";
    }

    const summarizeMatch = b.match(/!hermes\s+summarize\s+(?:last\s+)?(\d+)/i);
    if (summarizeMatch) {
      return `Summarize the conversation above in 3-5 bullet points, focusing on the last ${summarizeMatch[1]} messages.`;
    }

    if (/!hermes\s+summarize/i.test(b)) {
      return 'Summarize the conversation above in 3-5 bullet points.';
    }

    const rememberMatch = b.match(/!hermes\s+remember\s+(.+)/is);
    if (rememberMatch) {
      return `Store the following as a persistent memory note: ${rememberMatch[1].trim()}`;
    }

    return null;
  }
}

module.exports = ContextInjector;
