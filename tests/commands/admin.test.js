/**
 * Tests for src/commands/admin.js
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------- Mocks ----------

vi.mock('../../src/config.js', () => ({
  ADMIN_ROLE_ID: 'admin-role-123',
  MAX_VERIFICATIONS_PER_EMAIL: 2,
}));

const mockHasAdminRole = vi.fn();
vi.mock('../../src/utils.js', () => ({
  hasAdminRole: mockHasAdminRole,
}));

const mockStorage = {
  getStorageInfo: vi.fn().mockReturnValue({
    domains: 'Local',
    pendingCodes: 'Local',
    usedCodes: 'Local',
    localDomainsPath: '/data/domains.json',
    localCodesDir: '/data/pending',
    localUsedCodesDir: '/data/used',
  }),
  getAllowedDomains: vi.fn().mockReturnValue(['test.edu']),
  saveAllowedDomains: vi.fn().mockResolvedValue(true),
  isAllowedDomain: vi.fn(),
  getEmailVerificationCount: vi.fn().mockResolvedValue(0),
  resetEmail: vi.fn(),
};
vi.mock('../../src/storage.js', () => ({ default: mockStorage }));

const { handleAdminCommand } = await import('../../src/commands/admin.js');

// ---------- Helpers ----------

function createAdminInteraction(subcommand, options = {}) {
  return {
    member: { roles: { cache: { has: () => true } } },
    options: {
      getSubcommand: () => subcommand,
      getString: (key) => options[key] ?? null,
    },
    reply: vi.fn(),
    editReply: vi.fn(),
    deferReply: vi.fn(),
    replied: false,
    deferred: false,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockHasAdminRole.mockReturnValue(true);
  mockStorage.getAllowedDomains.mockReturnValue(['test.edu']);
  mockStorage.saveAllowedDomains.mockResolvedValue(true);
});

// ---------- Admin role check ----------

describe('admin role check', () => {
  it('rejects non-admin users', async () => {
    mockHasAdminRole.mockReturnValue(false);
    const interaction = createAdminInteraction('storage-info');

    await handleAdminCommand(interaction);
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('only server administrators') })
    );
  });
});

// ---------- storage-info ----------

describe('storage-info', () => {
  it('returns storage configuration', async () => {
    const interaction = createAdminInteraction('storage-info');

    await handleAdminCommand(interaction);
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Storage Configuration') })
    );
  });
});

// ---------- domain-add ----------

describe('domain-add', () => {
  it('adds a new domain', async () => {
    const interaction = createAdminInteraction('domain-add', { domain: 'newschool.edu' });

    await handleAdminCommand(interaction);
    expect(mockStorage.saveAllowedDomains).toHaveBeenCalledWith(['test.edu', 'newschool.edu']);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Successfully added') })
    );
  });

  it('rejects duplicate domain', async () => {
    const interaction = createAdminInteraction('domain-add', { domain: 'test.edu' });

    await handleAdminCommand(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('already in the allowed list') })
    );
  });

  it('rejects invalid domain format', async () => {
    const interaction = createAdminInteraction('domain-add', { domain: '.invalid.' });

    await handleAdminCommand(interaction);
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Invalid domain') })
    );
  });
});

// ---------- domain-remove ----------

describe('domain-remove', () => {
  it('removes an existing domain', async () => {
    mockStorage.getAllowedDomains.mockReturnValue(['test.edu', 'other.edu']);
    const interaction = createAdminInteraction('domain-remove', { domain: 'test.edu' });

    await handleAdminCommand(interaction);
    expect(mockStorage.saveAllowedDomains).toHaveBeenCalledWith(['other.edu']);
  });

  it('rejects removing non-existent domain', async () => {
    const interaction = createAdminInteraction('domain-remove', { domain: 'nothere.edu' });

    await handleAdminCommand(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('not in the allowed list') })
    );
  });

  it('prevents removing the last domain', async () => {
    mockStorage.getAllowedDomains.mockReturnValue(['test.edu']);
    const interaction = createAdminInteraction('domain-remove', { domain: 'test.edu' });

    await handleAdminCommand(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Cannot remove the last domain') })
    );
  });
});

// ---------- domain-list ----------

describe('domain-list', () => {
  it('lists allowed domains', async () => {
    mockStorage.getAllowedDomains.mockReturnValue(['test.edu', 'school.edu']);
    const interaction = createAdminInteraction('domain-list');

    await handleAdminCommand(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('test.edu') })
    );
  });

  it('handles empty domain list', async () => {
    mockStorage.getAllowedDomains.mockReturnValue([]);
    const interaction = createAdminInteraction('domain-list');

    await handleAdminCommand(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('No domains') })
    );
  });
});

// ---------- checkemail ----------

describe('checkemail', () => {
  it('returns email verification info', async () => {
    mockStorage.getEmailVerificationCount.mockResolvedValue(1);
    mockStorage.isAllowedDomain.mockReturnValue(true);
    const interaction = createAdminInteraction('checkemail', { email: 'student@test.edu' });

    await handleAdminCommand(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('1/2') })
    );
  });
});

// ---------- resetemail ----------

describe('resetemail', () => {
  it('resets email verification on success', async () => {
    mockStorage.resetEmail.mockResolvedValue({ success: true, deletedCount: 2 });
    const interaction = createAdminInteraction('resetemail', { email: 'student@test.edu' });

    await handleAdminCommand(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Successfully reset') })
    );
  });

  it('reports failure reason', async () => {
    mockStorage.resetEmail.mockResolvedValue({ success: false, reason: 'No records found' });
    const interaction = createAdminInteraction('resetemail', { email: 'nobody@test.edu' });

    await handleAdminCommand(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('No records found') })
    );
  });
});
