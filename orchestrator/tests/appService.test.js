'use strict';

const AppService = require('../src/appService');

// Minimal logger stub
const logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

// Disable real DB/Redis for unit tests
beforeEach(() => {
  delete process.env.DATABASE_URL;
  delete process.env.REDIS_URL;
});

describe('AppService', () => {
  test('initializes without DATABASE_URL or REDIS_URL', async () => {
    const svc = new AppService(logger);
    await expect(svc.init()).resolves.not.toThrow();
    expect(svc.pool).toBeNull();
    expect(svc.redis).toBeNull();
  });

  test('handleTransaction deduplicates via in-memory cache', async () => {
    const svc = new AppService(logger);
    await svc.init();

    // Replace eventHandler with a spy
    const processSpy = jest.fn().mockResolvedValue(undefined);
    svc.eventHandler = { process: processSpy };

    const event = {
      type: 'm.room.message',
      event_id: '$evt1',
      room_id: '!room:localhost',
      sender: '@alice:localhost',
      content: { msgtype: 'm.text', body: 'Hello' },
      origin_server_ts: Date.now(),
    };

    await svc.handleTransaction('txn-001', [event]);
    expect(processSpy).toHaveBeenCalledTimes(1);

    // Second call with same txnId — should be deduplicated
    await svc.handleTransaction('txn-001', [event]);
    expect(processSpy).toHaveBeenCalledTimes(1); // still 1
  });

  test('handleTransaction skips self-sent events', async () => {
    process.env.MATRIX_BOT_LOCALPART = 'hermes-orchestrator';
    process.env.MATRIX_SERVER_NAME = 'localhost';

    const svc = new AppService(logger);
    await svc.init();

    const processSpy = jest.fn().mockResolvedValue(undefined);
    svc.eventHandler = { process: processSpy };

    const selfEvent = {
      type: 'm.room.message',
      event_id: '$self1',
      room_id: '!room:localhost',
      sender: '@hermes-orchestrator:localhost',
      content: { msgtype: 'm.text', body: 'Bot reply' },
      origin_server_ts: Date.now(),
    };

    await svc.handleTransaction('txn-002', [selfEvent]);
    expect(processSpy).not.toHaveBeenCalled();
  });

  test('handleTransaction ignores non-message events', async () => {
    const svc = new AppService(logger);
    await svc.init();

    const processSpy = jest.fn().mockResolvedValue(undefined);
    svc.eventHandler = { process: processSpy };

    const stateEvent = {
      type: 'm.room.member',
      event_id: '$member1',
      room_id: '!room:localhost',
      sender: '@alice:localhost',
      content: { membership: 'join' },
      origin_server_ts: Date.now(),
    };

    await svc.handleTransaction('txn-003', [stateEvent]);
    expect(processSpy).not.toHaveBeenCalled();
  });
});
