/**
 * Tests for src/events.js
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------- Helpers ----------

/**
 * Load src/events.js with a controllable ENABLE_PLAINTEXT_COMMAND_NUDGE.
 * The flag is read through a module-level import, so each variation needs a
 * fresh module registry rather than a mutated mock object.
 */
async function loadSetupEventHandlers({ nudgeEnabled = true } = {}) {
  vi.resetModules();

  vi.doMock('../src/config.js', () => ({
    VERIFICATION_CHANNEL_ID: 'verification-channel',
    QUARANTINE_ROLE_ID: 'quarantine-role',
    SERVER_ID: 'server-1',
    SERVER_NAME: 'TestServer',
    ENABLE_PLAINTEXT_COMMAND_NUDGE: nudgeEnabled,
  }));
  vi.doMock('../src/commands/verify.js', () => ({
    handleVerifyCommand: vi.fn(),
    handleVerifyCodeCommand: vi.fn(),
  }));
  vi.doMock('../src/commands/admin.js', () => ({ handleAdminCommand: vi.fn() }));
  vi.doMock('../src/utils.js', () => ({ writeHeartbeat: vi.fn() }));
  vi.doMock('../src/storage.js', () => ({
    default: {
      getStorageInfo: () => ({ domains: 'd', pendingCodes: 'p', usedCodes: 'u' }),
    },
  }));

  const mod = await import('../src/events.js');
  return mod.default;
}

/** Minimal client that records the handler registered for each event. */
function createMockClient() {
  const handlers = new Map();
  return {
    handlers,
    on: vi.fn((event, fn) => handlers.set(event, fn)),
    once: vi.fn((event, fn) => handlers.set(event, fn)),
    isReady: () => true,
  };
}

function createMockMessage({ content = '', isBot = false } = {}) {
  return {
    content,
    author: {
      bot: isBot,
      tag: 'TestUser#0001',
      toString: () => '<@user-1>',
    },
    reply: vi.fn().mockResolvedValue(undefined),
  };
}

/** Wire up handlers and hand back the messageCreate listener. */
async function getMessageCreateHandler({ nudgeEnabled = true } = {}) {
  const setupEventHandlers = await loadSetupEventHandlers({ nudgeEnabled });
  const client = createMockClient();
  setupEventHandlers(client);
  return client.handlers.get('messageCreate');
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------- guildMemberAdd (welcome message) ----------

describe('guildMemberAdd', () => {
  function createMockMember() {
    const channel = { send: vi.fn().mockResolvedValue(undefined) };
    return {
      member: {
        user: { tag: 'NewUser#0002' },
        roles: { add: vi.fn().mockResolvedValue(undefined) },
        guild: {
          roles: { cache: { get: vi.fn().mockReturnValue({ id: 'quarantine-role' }) } },
          channels: { cache: { get: vi.fn().mockReturnValue(channel) } },
        },
      },
      channel,
    };
  }

  it('assigns the quarantine role to a new member', async () => {
    const setupEventHandlers = await loadSetupEventHandlers();
    const client = createMockClient();
    setupEventHandlers(client);

    const { member } = createMockMember();
    await client.handlers.get('guildMemberAdd')(member);

    expect(member.roles.add).toHaveBeenCalledWith({ id: 'quarantine-role' });
  });

  it('tells new members to pick the command from the menu', async () => {
    const setupEventHandlers = await loadSetupEventHandlers();
    const client = createMockClient();
    setupEventHandlers(client);

    const { member, channel } = createMockMember();
    await client.handlers.get('guildMemberAdd')(member);

    const { content } = channel.send.mock.calls[0][0];
    expect(content).toMatch(/menu/i);
    expect(content).toMatch(/will not work/i);
  });

  it('does not present a copy-pasteable command line', async () => {
    // Regression guard: the original wording showed a full
    // "/verify email:..." example, which students pasted as plain text.
    const setupEventHandlers = await loadSetupEventHandlers();
    const client = createMockClient();
    setupEventHandlers(client);

    const { member, channel } = createMockMember();
    await client.handlers.get('guildMemberAdd')(member);

    const { content } = channel.send.mock.calls[0][0];
    expect(content).not.toMatch(/`\/verify email:/);
  });
});

// ---------- messageCreate (plain-text command nudge) ----------

describe('messageCreate plain-text command nudge', () => {
  it('replies when a user types /verify as plain text', async () => {
    const handler = await getMessageCreateHandler();
    const message = createMockMessage({ content: '/verify email:someone@test.edu' });

    await handler(message);

    expect(message.reply).toHaveBeenCalledTimes(1);
    expect(message.reply.mock.calls[0][0].content).toMatch(/pick it from the menu/i);
  });

  it('replies for a plain-text /verifycode too', async () => {
    const handler = await getMessageCreateHandler();
    const message = createMockMessage({ content: '/verifycode ABC12345' });

    await handler(message);

    expect(message.reply).toHaveBeenCalledTimes(1);
  });

  it('matches regardless of surrounding whitespace and case', async () => {
    const handler = await getMessageCreateHandler();
    const message = createMockMessage({ content: '   /VERIFY email:someone@test.edu  ' });

    await handler(message);

    expect(message.reply).toHaveBeenCalledTimes(1);
  });

  it('ignores messages from bots so two bots cannot loop', async () => {
    const handler = await getMessageCreateHandler();
    const message = createMockMessage({ content: '/verify email:a@test.edu', isBot: true });

    await handler(message);

    expect(message.reply).not.toHaveBeenCalled();
  });

  it('ignores ordinary conversation', async () => {
    const handler = await getMessageCreateHandler();
    const message = createMockMessage({ content: 'how do I verify my account?' });

    await handler(message);

    expect(message.reply).not.toHaveBeenCalled();
  });

  it('ignores words that merely start with verify', async () => {
    const handler = await getMessageCreateHandler();
    const message = createMockMessage({ content: '/verifying my setup' });

    await handler(message);

    expect(message.reply).not.toHaveBeenCalled();
  });

  it('ignores an empty content string (intent not granted)', async () => {
    // Without the MessageContent intent Discord delivers every message with
    // content: '', so the handler must stay silent rather than reply to all.
    const handler = await getMessageCreateHandler();
    const message = createMockMessage({ content: '' });

    await handler(message);

    expect(message.reply).not.toHaveBeenCalled();
  });

  it('warns about the exposed address when the message contains an email', async () => {
    const handler = await getMessageCreateHandler();
    const message = createMockMessage({ content: '/verify email:someone@test.edu' });

    await handler(message);

    expect(message.reply.mock.calls[0][0].content).toMatch(/visible to this channel/i);
  });

  it('omits the privacy warning when no email is present', async () => {
    const handler = await getMessageCreateHandler();
    const message = createMockMessage({ content: '/verify' });

    await handler(message);

    expect(message.reply.mock.calls[0][0].content).not.toMatch(/visible to this channel/i);
  });

  it('stays silent when the nudge is disabled', async () => {
    const handler = await getMessageCreateHandler({ nudgeEnabled: false });
    const message = createMockMessage({ content: '/verify email:someone@test.edu' });

    await handler(message);

    expect(message.reply).not.toHaveBeenCalled();
  });

  it('swallows reply failures instead of rejecting', async () => {
    // An unhandled rejection here would surface as a gateway-level error.
    const handler = await getMessageCreateHandler();
    const message = createMockMessage({ content: '/verify email:someone@test.edu' });
    message.reply.mockRejectedValue(new Error('Missing Permissions'));

    await expect(handler(message)).resolves.toBeUndefined();
  });
});
