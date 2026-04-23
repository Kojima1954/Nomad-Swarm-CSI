'use strict';

const CommandRouter = require('./commandRouter');
const ContextInjector = require('./contextInjector');
const HermesClient = require('./hermesClient');
const RateLimiter = require('./rateLimiter');
const MatrixClient = require('./matrixClient');

const AI_TRIGGER_PREFIX = process.env.AI_TRIGGER_PREFIX || '!hermes';
const SERVER_NAME = process.env.MATRIX_SERVER_NAME || 'localhost';
const HERMES_BOT_ID = `@hermes-bot:${SERVER_NAME}`;

class EventHandler {
  /**
   * @param {import('./transcriptStore')} transcriptStore
   * @param {import('winston').Logger} logger
   */
  constructor(transcriptStore, logger) {
    this.transcriptStore = transcriptStore;
    this.logger = logger;

    this.matrixClient = new MatrixClient(logger);
    this.commandRouter = new CommandRouter(this.matrixClient, logger);
    this.contextInjector = new ContextInjector(transcriptStore, logger);
    this.hermesClient = new HermesClient(this.matrixClient, logger);
    this.rateLimiter = new RateLimiter(logger);
  }

  /**
   * Process a single Matrix m.room.message event.
   *
   * @param {object} event - Raw Matrix event
   */
  async process(event) {
    const body = (event.content && event.content.body) ? event.content.body.trim() : '';

    // 1. Persist to transcript store (best-effort)
    try {
      await this.transcriptStore.saveEvent(event);
    } catch (err) {
      this.logger.warn({ msg: 'Failed to save event to transcript', eventId: event.event_id, err: err.message });
    }

    if (!body) return;

    // 2. Route by command prefix
    if (body.startsWith('!nomad')) {
      return this.commandRouter.handleNomadCommand(event);
    }

    if (body.startsWith('!room')) {
      return this.commandRouter.handleRoomCommand(event);
    }

    if (body.startsWith('!help')) {
      return this._sendHelp(event);
    }

    // 3. AI triggers: !hermes prefix OR @hermes-bot mention
    const isHermesTrigger = body.startsWith(AI_TRIGGER_PREFIX) ||
      body.includes(HERMES_BOT_ID) ||
      body.toLowerCase().includes('@hermes-bot');

    if (isHermesTrigger) {
      const allowed = await this.rateLimiter.check(event.room_id);
      if (!allowed) {
        await this.matrixClient.sendMessage(
          event.room_id,
          `⏱️ Rate limit reached. Please wait a moment before asking Hermes again (max ${process.env.AI_RATE_LIMIT_PER_MINUTE || 10} requests/min).`
        );
        return;
      }

      try {
        const payload = await this.contextInjector.buildPayload(event);
        await this.hermesClient.query(payload, event.room_id);
      } catch (err) {
        this.logger.error({ msg: 'Hermes query error', err: err.message });
        await this.matrixClient.sendMessage(
          event.room_id,
          `⚠️ Hermes encountered an error: ${err.message}`
        ).catch(() => {});
      }
    }
  }

  async _sendHelp(event) {
    const help = `**NOMAD-Hermes Node — Command Reference**

| Command | Effect |
|---|---|
| \`!hermes [question]\` | Ask Hermes a general question |
| \`!hermes search:docs [query]\` | Search NOMAD's document KB |
| \`!hermes search:wiki [query]\` | Search NOMAD's offline Wikipedia |
| \`!hermes summarize last [N]\` | Summarize last N messages |
| \`!hermes remember [note]\` | Save persistent memory note |
| \`@hermes-bot [message]\` | Mention the bot directly |
| \`!nomad status\` | Show NOMAD/Ollama service health |
| \`!nomad models\` | List available AI models |
| \`!nomad docs list\` | List uploaded documents |
| \`!room users\` | List room members |
| \`!room stats\` | Room usage statistics |
| \`!room transcript [N]\` | Last N messages summary |
| \`!help\` | Show this command list |

Upload documents to NOMAD at http://localhost:8081`;

    await this.matrixClient.sendMessage(event.room_id, help);
  }
}

module.exports = EventHandler;
