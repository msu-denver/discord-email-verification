/**
 * Tests for src/commands/verify.js
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------- Mocks (must be before imports) ----------

vi.mock('../../src/config.js', () => ({
  QUARANTINE_ROLE_ID: 'quarantine-role',
  VERIFIED_ROLE_ID: 'verified-role',
  WELCOME_CHANNEL_ID: 'welcome-channel',
  CODE_EXPIRATION: 30 * 60 * 1000,
  MAX_VERIFICATIONS_PER_EMAIL: 2,
  SERVER_NAME: 'TestServer',
}));

const mockStorage = {
  isAllowedDomain: vi.fn(),
  getAllowedDomains: vi.fn().mockReturnValue(['test.edu']),
  getEmailVerificationCount: vi.fn(),
  saveCodeToStorage: vi.fn(),
  moveToUsedCodes: vi.fn(),
};
vi.mock('../../src/storage.js', () => ({ default: mockStorage }));

const mockSendEmail = vi.fn();
vi.mock('../../src/emailer.js', () => ({
  sendVerificationEmail: mockSendEmail,
}));

vi.mock('../../src/utils.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    generateVerificationCode: vi.fn().mockReturnValue('TEST1234'),
  };
});

// Dynamic import ensures mocks are in place
const { handleVerifyCommand, handleVerifyCodeCommand, pendingVerifications } =
  await import('../../src/commands/verify.js');

// ---------- Helpers ----------

function createMockInteraction({ hasQuarantineRole = true } = {}) {
  return {
    user: { id: 'user-1', tag: 'TestUser#0001', username: 'TestUser' },
    member: {
      roles: {
        cache: { has: (id) => (hasQuarantineRole && id === 'quarantine-role') },
        add: vi.fn(),
        remove: vi.fn(),
      },
      guild: {
        roles: { cache: { get: vi.fn().mockReturnValue({ id: 'verified-role' }) } },
        channels: { cache: { get: vi.fn().mockReturnValue({ send: vi.fn() }) } },
      },
      user: { tag: 'TestUser#0001', username: 'TestUser' },
    },
    options: { getString: vi.fn() },
    reply: vi.fn(),
    editReply: vi.fn(),
    replied: false,
    deferred: false,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  pendingVerifications.clear();
  mockStorage.isAllowedDomain.mockReturnValue(true);
  mockStorage.getEmailVerificationCount.mockResolvedValue(0);
  mockStorage.saveCodeToStorage.mockResolvedValue(true);
  mockStorage.moveToUsedCodes.mockResolvedValue(true);
  mockSendEmail.mockResolvedValue(true);
});

// ---------- /verify ----------

describe('handleVerifyCommand', () => {
  it('replies already verified if user has no quarantine role', async () => {
    const interaction = createMockInteraction({ hasQuarantineRole: false });

    await handleVerifyCommand(interaction);
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('already verified') })
    );
  });

  it('rejects disallowed domain', async () => {
    mockStorage.isAllowedDomain.mockReturnValue(false);
    const interaction = createMockInteraction();
    interaction.options.getString.mockReturnValue('user@gmail.com');

    await handleVerifyCommand(interaction);
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('only accept email') })
    );
  });

  it('rejects when email has reached max verifications', async () => {
    mockStorage.getEmailVerificationCount.mockResolvedValue(2);
    const interaction = createMockInteraction();
    interaction.options.getString.mockReturnValue('user@test.edu');

    await handleVerifyCommand(interaction);
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('maximum') })
    );
  });

  it('throttles rapid requests from same user', async () => {
    pendingVerifications.set('user-1', {
      email: 'user@test.edu',
      code: 'OLD12345',
      timestamp: Date.now(),
      attempts: 0,
    });

    const interaction = createMockInteraction();
    interaction.options.getString.mockReturnValue('user@test.edu');

    await handleVerifyCommand(interaction);
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('wait') })
    );
  });

  it('sends verification email on happy path', async () => {
    const interaction = createMockInteraction();
    interaction.options.getString.mockReturnValue('user@test.edu');

    await handleVerifyCommand(interaction);

    expect(mockSendEmail).toHaveBeenCalledWith('user@test.edu', 'TEST1234');
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('sent a verification code') })
    );
  });

  it('rejects email with local-part longer than 64 chars', async () => {
    const interaction = createMockInteraction();
    const longLocal = 'a'.repeat(65) + '@test.edu';
    interaction.options.getString.mockReturnValue(longLocal);

    await handleVerifyCommand(interaction);
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('not in a valid format') })
    );
    // Should be rejected before any storage/SES work happens.
    expect(mockStorage.getEmailVerificationCount).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('rejects email with no local-part (starts with @)', async () => {
    const interaction = createMockInteraction();
    interaction.options.getString.mockReturnValue('@test.edu');

    await handleVerifyCommand(interaction);
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('not in a valid format') })
    );
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('keeps throttle entry if email send fails so the user cannot retry immediately', async () => {
    mockSendEmail.mockResolvedValue(false);
    const interaction = createMockInteraction();
    interaction.options.getString.mockReturnValue('user@test.edu');

    await handleVerifyCommand(interaction);

    // Entry must survive an SES failure — otherwise a user could spam /verify
    // by picking an address that always errors and bypass the 5-min throttle.
    expect(pendingVerifications.has('user-1')).toBe(true);
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('error sending') })
    );
  });
});

// ---------- /verifycode ----------

describe('handleVerifyCodeCommand', () => {
  it('rejects when no pending verification exists', async () => {
    const interaction = createMockInteraction();
    interaction.options.getString.mockReturnValue('ANYCODE1');

    await handleVerifyCodeCommand(interaction);
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('pending verification') })
    );
  });

  it('rejects expired code', async () => {
    pendingVerifications.set('user-1', {
      email: 'user@test.edu',
      code: 'EXPIRED1',
      timestamp: Date.now() - 31 * 60 * 1000,
      attempts: 0,
    });

    const interaction = createMockInteraction();
    interaction.options.getString.mockReturnValue('EXPIRED1');

    await handleVerifyCodeCommand(interaction);
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('expired') })
    );
  });

  it('rejects wrong code and tracks attempts', async () => {
    pendingVerifications.set('user-1', {
      email: 'user@test.edu',
      code: 'RIGHT123',
      timestamp: Date.now(),
      attempts: 0,
    });

    const interaction = createMockInteraction();
    interaction.options.getString.mockReturnValue('WRONG999');

    await handleVerifyCodeCommand(interaction);
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining("doesn't match") })
    );
  });

  it('locks out after too many attempts', async () => {
    pendingVerifications.set('user-1', {
      email: 'user@test.edu',
      code: 'RIGHT123',
      timestamp: Date.now(),
      attempts: 3,
    });

    const interaction = createMockInteraction();
    interaction.options.getString.mockReturnValue('WRONG999');

    await handleVerifyCodeCommand(interaction);
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('too many') })
    );
    expect(pendingVerifications.has('user-1')).toBe(false);
  });

  it('rejects malformed code without burning an attempt', async () => {
    pendingVerifications.set('user-1', {
      email: 'user@test.edu',
      code: 'RIGHT123',
      timestamp: Date.now(),
      attempts: 0,
    });

    const interaction = createMockInteraction();
    // 200-char "code" — way past anything we'd ever generate.
    interaction.options.getString.mockReturnValue('A'.repeat(200));

    await handleVerifyCodeCommand(interaction);
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('not in a valid format') })
    );
    // Junk submissions must NOT count toward the 3-attempt cap.
    expect(pendingVerifications.get('user-1').attempts).toBe(0);
  });

  it('verifies user on correct code', async () => {
    pendingVerifications.set('user-1', {
      email: 'user@test.edu',
      code: 'GOOD1234',
      timestamp: Date.now(),
      attempts: 0,
    });

    const interaction = createMockInteraction();
    interaction.options.getString.mockReturnValue('GOOD1234');

    await handleVerifyCodeCommand(interaction);

    expect(interaction.member.roles.remove).toHaveBeenCalledWith('quarantine-role');
    expect(interaction.member.roles.add).toHaveBeenCalled();
    expect(mockStorage.moveToUsedCodes).toHaveBeenCalledWith('user-1', 'user@test.edu', 'GOOD1234');
    expect(pendingVerifications.has('user-1')).toBe(false);
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Verification successful') })
    );
  });
});
