'use strict';

const ContextInjector = require('../src/contextInjector');

const logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

function makeEvent(body, roomId = '!room:localhost', sender = '@alice:localhost') {
  return {
    type: 'm.room.message',
    event_id: `$${Math.random()}`,
    room_id: roomId,
    sender,
    content: { msgtype: 'm.text', body },
    origin_server_ts: Date.now(),
  };
}

function makeTranscriptStore(rows = []) {
  return {
    getTranscript: jest.fn().mockResolvedValue(rows),
  };
}

describe('ContextInjector — buildPayload', () => {
  test('returns OpenAI-compatible payload', async () => {
    const ts = makeTranscriptStore([]);
    const injector = new ContextInjector(ts, logger);

    const payload = await injector.buildPayload(makeEvent('!hermes what is photosynthesis?'));

    expect(payload).toMatchObject({
      messages: expect.any(Array),
      stream: true,
    });
    expect(payload.messages.length).toBeGreaterThanOrEqual(2);
    expect(payload.messages[0].role).toBe('system');
    expect(payload.messages[1].role).toBe('user');
  });

  test('includes transcript when rows are present', async () => {
    const ts = makeTranscriptStore([
      { sender: '@alice:localhost', display_name: 'Alice', content_body: 'Hello', origin_server_ts: 1700000000000 },
      { sender: '@bob:localhost', display_name: 'Bob', content_body: 'World', origin_server_ts: 1700000001000 },
    ]);
    const injector = new ContextInjector(ts, logger);

    const payload = await injector.buildPayload(makeEvent('!hermes test'));
    const userContent = payload.messages[1].content;

    expect(userContent).toContain('ROOM TRANSCRIPT');
    expect(userContent).toContain('Alice');
    expect(userContent).toContain('Bob');
  });

  test('detects search:docs modifier', async () => {
    const ts = makeTranscriptStore([]);
    const injector = new ContextInjector(ts, logger);

    const payload = await injector.buildPayload(makeEvent('!hermes search:docs solar panels'));
    const userContent = payload.messages[1].content;

    expect(userContent).toContain("NOMAD's uploaded document knowledge base");
  });

  test('detects search:wiki modifier', async () => {
    const ts = makeTranscriptStore([]);
    const injector = new ContextInjector(ts, logger);

    const payload = await injector.buildPayload(makeEvent('!hermes search:wiki photosynthesis'));
    const userContent = payload.messages[1].content;

    expect(userContent).toContain("NOMAD's offline Wikipedia knowledge base");
  });

  test('detects summarize modifier', async () => {
    const ts = makeTranscriptStore([]);
    const injector = new ContextInjector(ts, logger);

    const payload = await injector.buildPayload(makeEvent('!hermes summarize last 5'));
    const userContent = payload.messages[1].content;

    expect(userContent).toContain('3-5 bullet points');
  });

  test('detects remember modifier', async () => {
    const ts = makeTranscriptStore([]);
    const injector = new ContextInjector(ts, logger);

    const payload = await injector.buildPayload(makeEvent('!hermes remember project deadline is Friday'));
    const userContent = payload.messages[1].content;

    expect(userContent).toContain('persistent memory note');
    expect(userContent).toContain('project deadline is Friday');
  });

  test('gracefully handles transcript store failure', async () => {
    const ts = { getTranscript: jest.fn().mockRejectedValue(new Error('DB down')) };
    const injector = new ContextInjector(ts, logger);

    const payload = await injector.buildPayload(makeEvent('!hermes hello'));
    // Should not throw, should still return a valid payload
    expect(payload.messages).toBeDefined();
    expect(payload.messages[0].role).toBe('system');
  });
});
