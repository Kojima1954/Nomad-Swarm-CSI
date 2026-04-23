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

const NOMAD_CC_URL = process.env.NOMAD_CC_URL || 'http://nomad_command_center:8080';
const NOMAD_OLLAMA_URL = process.env.NOMAD_OLLAMA_URL || 'http://nomad_ollama:11434';
const MATRIX_HOMESERVER_URL = process.env.MATRIX_HOMESERVER_URL || 'http://synapse:8008';
const MATRIX_AS_TOKEN = process.env.MATRIX_AS_TOKEN || '';
const BOT_LOCALPART = process.env.MATRIX_BOT_LOCALPART || 'hermes-orchestrator';
const SERVER_NAME = process.env.MATRIX_SERVER_NAME || 'localhost';

class CommandRouter {
  /**
   * @param {import('./matrixClient')} matrixClient
   * @param {import('winston').Logger} logger
   */
  constructor(matrixClient, logger) {
    this.matrixClient = matrixClient;
    this.logger = logger;
  }

  /**
   * Handle !nomad [subcommand] commands.
   * @param {object} event
   */
  async handleNomadCommand(event) {
    const body = (event.content && event.content.body) || '';
    const parts = body.trim().split(/\s+/);
    const subCmd = (parts[1] || '').toLowerCase();

    switch (subCmd) {
      case 'status':
        return this._nomadStatus(event);
      case 'models':
        return this._nomadModels(event);
      case 'docs':
        return this._nomadDocs(event, parts.slice(2));
      default:
        return this.matrixClient.sendMessage(
          event.room_id,
          `Unknown !nomad subcommand: \`${subCmd}\`. Try \`!nomad status\`, \`!nomad models\`, or \`!nomad docs list\`.`
        );
    }
  }

  /**
   * Handle !room [subcommand] commands.
   * @param {object} event
   */
  async handleRoomCommand(event) {
    const body = (event.content && event.content.body) || '';
    const parts = body.trim().split(/\s+/);
    const subCmd = (parts[1] || '').toLowerCase();

    switch (subCmd) {
      case 'users':
        return this._roomUsers(event);
      case 'stats':
        return this._roomStats(event);
      case 'transcript':
        return this._roomTranscript(event, parseInt(parts[2], 10) || 10);
      default:
        return this.matrixClient.sendMessage(
          event.room_id,
          `Unknown !room subcommand: \`${subCmd}\`. Try \`!room users\`, \`!room stats\`, or \`!room transcript [N]\`.`
        );
    }
  }

  // ─── !nomad handlers ──────────────────────────────────────────────────────

  async _nomadStatus(event) {
    try {
      const res = await fetchFn(`${NOMAD_CC_URL}/api/health`, { timeout: 5000 });
      const data = res.ok ? await res.json() : { status: 'unreachable' };
      await this.matrixClient.sendMessage(
        event.room_id,
        `**NOMAD Status**\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``
      );
    } catch (err) {
      await this.matrixClient.sendMessage(
        event.room_id,
        `⚠️ Could not reach NOMAD Command Center: ${err.message}`
      );
    }
  }

  async _nomadModels(event) {
    try {
      const res = await fetchFn(`${NOMAD_OLLAMA_URL}/api/tags`, { timeout: 5000 });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { models = [] } = await res.json();
      const list = models.map((m) => `- \`${m.name}\``).join('\n') || '_No models found_';
      await this.matrixClient.sendMessage(event.room_id, `**Available Ollama Models**\n${list}`);
    } catch (err) {
      await this.matrixClient.sendMessage(
        event.room_id,
        `⚠️ Could not reach Ollama: ${err.message}`
      );
    }
  }

  async _nomadDocs(event, args) {
    const subSubCmd = (args[0] || '').toLowerCase();
    if (subSubCmd === 'list') {
      try {
        const res = await fetchFn(`${NOMAD_CC_URL}/api/documents`, { timeout: 5000 });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const docs = Array.isArray(data) ? data : (data.documents || []);
        const list = docs.map((d) => `- ${d.name || d.title || d}`).join('\n') || '_No documents uploaded yet_';
        await this.matrixClient.sendMessage(event.room_id, `**NOMAD Documents**\n${list}\n\nUpload docs at http://localhost:8081`);
      } catch (err) {
        await this.matrixClient.sendMessage(
          event.room_id,
          `⚠️ Could not fetch document list: ${err.message}`
        );
      }
    } else {
      await this.matrixClient.sendMessage(
        event.room_id,
        'Usage: `!nomad docs list`'
      );
    }
  }

  // ─── !room handlers ───────────────────────────────────────────────────────

  async _roomUsers(event) {
    try {
      const members = await this.matrixClient.getJoinedMembers(event.room_id);
      const list = Object.entries(members.joined || {})
        .map(([userId, info]) => `- ${info.display_name || userId} (\`${userId}\`)`)
        .join('\n') || '_No members found_';
      await this.matrixClient.sendMessage(event.room_id, `**Room Members**\n${list}`);
    } catch (err) {
      await this.matrixClient.sendMessage(
        event.room_id,
        `⚠️ Could not fetch members: ${err.message}`
      );
    }
  }

  async _roomStats(event) {
    try {
      const stats = await this.matrixClient.getRoomStats(event.room_id);
      await this.matrixClient.sendMessage(
        event.room_id,
        `**Room Stats**\n\`\`\`\nTotal messages: ${stats.total || 0}\nAI queries:     ${stats.ai_triggers || 0}\nFirst message:  ${stats.first_ts ? new Date(stats.first_ts).toISOString() : 'N/A'}\n\`\`\``
      );
    } catch (err) {
      await this.matrixClient.sendMessage(
        event.room_id,
        `⚠️ Could not fetch stats: ${err.message}`
      );
    }
  }

  async _roomTranscript(event, n) {
    try {
      const transcriptStore = this.matrixClient._transcriptStore;
      if (!transcriptStore) throw new Error('TranscriptStore not available');
      const rows = await transcriptStore.getTranscript(event.room_id, Math.min(n, 50));
      const lines = rows.reverse().map((r) => {
        const time = new Date(Number(r.origin_server_ts)).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        return `${r.display_name || r.sender} (${time}): ${r.content_body || ''}`;
      }).join('\n') || '_No messages found_';
      await this.matrixClient.sendMessage(
        event.room_id,
        `**Last ${n} messages**\n\`\`\`\n${lines}\n\`\`\``
      );
    } catch (err) {
      await this.matrixClient.sendMessage(
        event.room_id,
        `⚠️ Could not fetch transcript: ${err.message}`
      );
    }
  }
}

module.exports = CommandRouter;
