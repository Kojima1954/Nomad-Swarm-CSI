'use strict';

const TranscriptStore = require('../src/transcriptStore');

const logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

function makeEvent(overrides = {}) {
  return {
    event_id: `$evt-${Math.random()}`,
    room_id: '!room:localhost',
    sender: '@alice:localhost',
    type: 'm.room.message',
    content: { msgtype: 'm.text', body: 'Hello world' },
    origin_server_ts: Date.now(),
    ...overrides,
  };
}

describe('TranscriptStore — no-op when pool is null', () => {
  const store = new TranscriptStore(null, logger);

  test('saveEvent returns without error', async () => {
    await expect(store.saveEvent(makeEvent())).resolves.toBeUndefined();
  });

  test('getTranscript returns empty array', async () => {
    const rows = await store.getTranscript('!room:localhost', 20);
    expect(rows).toEqual([]);
  });

  test('getRoomStats returns zero object', async () => {
    const stats = await store.getRoomStats('!room:localhost');
    expect(stats).toEqual({ total: 0, ai_triggers: 0, first_ts: null });
  });

  test('searchEvents returns empty array', async () => {
    const rows = await store.searchEvents('!room:localhost', 'solar');
    expect(rows).toEqual([]);
  });
});

describe('TranscriptStore — with mocked pool', () => {
  function makePool(queryFn) {
    return {
      query: queryFn,
      connect: jest.fn().mockResolvedValue({
        query: queryFn,
        release: jest.fn(),
      }),
    };
  }

  test('saveEvent calls INSERT with correct parameters', async () => {
    const queryFn = jest.fn().mockResolvedValue({ rows: [] });
    const pool = makePool(queryFn);
    const store = new TranscriptStore(pool, logger);

    const event = makeEvent({
      event_id: '$abc',
      room_id: '!test:localhost',
      sender: '@user:localhost',
      content: { msgtype: 'm.text', body: '!hermes hello' },
      origin_server_ts: 1700000000000,
    });

    await store.saveEvent(event);

    expect(queryFn).toHaveBeenCalled();
    const [sql, params] = queryFn.mock.calls[0];
    expect(sql).toContain('INSERT INTO room_events');
    expect(params[0]).toBe('$abc');        // event_id
    expect(params[1]).toBe('!test:localhost'); // room_id
    expect(params[5]).toBe('!hermes hello');   // content_body
    expect(params[8]).toBe(true);              // is_ai_trigger
  });

  test('saveEvent sets is_ai_trigger=false for regular messages', async () => {
    const queryFn = jest.fn().mockResolvedValue({ rows: [] });
    const pool = makePool(queryFn);
    const store = new TranscriptStore(pool, logger);

    await store.saveEvent(makeEvent({ content: { msgtype: 'm.text', body: 'Just a normal message' } }));

    const [, params] = queryFn.mock.calls[0];
    expect(params[8]).toBe(false); // is_ai_trigger
  });

  test('getTranscript calls SELECT with room_id and limit', async () => {
    const queryFn = jest.fn().mockResolvedValue({ rows: [{ event_id: '$x', content_body: 'test' }] });
    const pool = makePool(queryFn);
    const store = new TranscriptStore(pool, logger);

    const rows = await store.getTranscript('!room:localhost', 10);

    expect(queryFn).toHaveBeenCalled();
    const [sql, params] = queryFn.mock.calls[0];
    expect(sql).toContain('SELECT');
    expect(params[0]).toBe('!room:localhost');
    expect(params[1]).toBe(10);
    expect(rows).toHaveLength(1);
  });

  test('getRoomStats returns aggregated values', async () => {
    const queryFn = jest.fn().mockResolvedValue({
      rows: [{ total: 100, ai_triggers: 15, first_ts: 1700000000000 }],
    });
    const pool = makePool(queryFn);
    const store = new TranscriptStore(pool, logger);

    const stats = await store.getRoomStats('!room:localhost');

    expect(stats.total).toBe(100);
    expect(stats.ai_triggers).toBe(15);
  });
});
