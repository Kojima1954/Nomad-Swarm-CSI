'use strict';

const CommandRouter = require('../src/commandRouter');

const logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

function makeMatrixClient() {
  return {
    sendMessage: jest.fn().mockResolvedValue(undefined),
    getJoinedMembers: jest.fn().mockResolvedValue({
      joined: {
        '@alice:localhost': { display_name: 'Alice' },
        '@bob:localhost': { display_name: 'Bob' },
      },
    }),
    getRoomStats: jest.fn().mockResolvedValue({ total: 42, ai_triggers: 7, first_ts: 1700000000000 }),
    _transcriptStore: null,
  };
}

function makeEvent(body) {
  return {
    type: 'm.room.message',
    event_id: `$${Math.random()}`,
    room_id: '!room:localhost',
    sender: '@alice:localhost',
    content: { msgtype: 'm.text', body },
    origin_server_ts: Date.now(),
  };
}

describe('CommandRouter — !nomad', () => {
  test('unknown subcommand sends usage hint', async () => {
    const mc = makeMatrixClient();
    const router = new CommandRouter(mc, logger);
    await router.handleNomadCommand(makeEvent('!nomad unknown'));
    expect(mc.sendMessage).toHaveBeenCalledWith(
      '!room:localhost',
      expect.stringContaining('Unknown !nomad subcommand')
    );
  });

  test('!nomad status sends error message when CC unreachable', async () => {
    const mc = makeMatrixClient();
    const router = new CommandRouter(mc, logger);
    // NOMAD CC is not running in unit tests — expect error message
    await router.handleNomadCommand(makeEvent('!nomad status'));
    expect(mc.sendMessage).toHaveBeenCalledWith(
      '!room:localhost',
      expect.stringMatching(/NOMAD Status|Could not reach/i)
    );
  });

  test('!nomad docs without subcommand sends usage', async () => {
    const mc = makeMatrixClient();
    const router = new CommandRouter(mc, logger);
    await router.handleNomadCommand(makeEvent('!nomad docs'));
    expect(mc.sendMessage).toHaveBeenCalledWith(
      '!room:localhost',
      expect.stringContaining('Usage:')
    );
  });
});

describe('CommandRouter — !room', () => {
  test('!room users calls getJoinedMembers and lists them', async () => {
    const mc = makeMatrixClient();
    const router = new CommandRouter(mc, logger);
    await router.handleRoomCommand(makeEvent('!room users'));
    expect(mc.getJoinedMembers).toHaveBeenCalledWith('!room:localhost');
    expect(mc.sendMessage).toHaveBeenCalledWith(
      '!room:localhost',
      expect.stringContaining('Alice')
    );
  });

  test('!room stats calls getRoomStats', async () => {
    const mc = makeMatrixClient();
    const router = new CommandRouter(mc, logger);
    await router.handleRoomCommand(makeEvent('!room stats'));
    expect(mc.getRoomStats).toHaveBeenCalledWith('!room:localhost');
    expect(mc.sendMessage).toHaveBeenCalledWith(
      '!room:localhost',
      expect.stringContaining('42')
    );
  });

  test('unknown !room subcommand sends usage hint', async () => {
    const mc = makeMatrixClient();
    const router = new CommandRouter(mc, logger);
    await router.handleRoomCommand(makeEvent('!room foobar'));
    expect(mc.sendMessage).toHaveBeenCalledWith(
      '!room:localhost',
      expect.stringContaining('Unknown !room subcommand')
    );
  });
});
