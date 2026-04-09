/**
 * Tests for src/utils.js
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock config before importing utils
vi.mock('../src/config', () => ({
  ADMIN_ROLE_ID: 'admin-role-123',
}));

// Use dynamic import so the mock is in place first
const { formatTimeLeft, generateVerificationCode, hasAdminRole, isValidEmail } =
  await import('../src/utils.js');

// ---------- formatTimeLeft ----------

describe('formatTimeLeft', () => {
  it('formats seconds only', () => {
    expect(formatTimeLeft(45000)).toBe('45 seconds');
  });

  it('formats single second', () => {
    expect(formatTimeLeft(1000)).toBe('1 second');
  });

  it('formats minutes only', () => {
    expect(formatTimeLeft(120000)).toBe('2 minutes');
  });

  it('formats single minute', () => {
    expect(formatTimeLeft(60000)).toBe('1 minute');
  });

  it('formats minutes and seconds', () => {
    expect(formatTimeLeft(90000)).toBe('1 minute and 30 seconds');
  });

  it('formats 0 milliseconds as 0 seconds', () => {
    expect(formatTimeLeft(0)).toBe('0 seconds');
  });
});

// ---------- generateVerificationCode ----------

describe('generateVerificationCode', () => {
  it('returns an 8-character string', () => {
    expect(generateVerificationCode()).toHaveLength(8);
  });

  it('returns uppercase hex characters', () => {
    expect(generateVerificationCode()).toMatch(/^[0-9A-F]{8}$/);
  });

  it('generates different codes on successive calls', () => {
    const codes = new Set(Array.from({ length: 10 }, () => generateVerificationCode()));
    expect(codes.size).toBeGreaterThan(1);
  });
});

// ---------- hasAdminRole ----------

describe('hasAdminRole', () => {
  it('returns true when member has the admin role', () => {
    const member = { roles: { cache: { has: (id) => id === 'admin-role-123' } } };
    expect(hasAdminRole(member)).toBe(true);
  });

  it('returns false when member does not have the admin role', () => {
    const member = { roles: { cache: { has: () => false } } };
    expect(hasAdminRole(member)).toBe(false);
  });
});

// ---------- isValidEmail ----------

describe('isValidEmail', () => {
  it('accepts a valid email', () => {
    expect(isValidEmail('student@msudenver.edu')).toBe(true);
  });

  it('accepts emails with dots and hyphens', () => {
    expect(isValidEmail('first.last@my-university.edu')).toBe(true);
  });

  it('rejects missing @', () => {
    expect(isValidEmail('studentmsudenver.edu')).toBe(false);
  });

  it('rejects missing domain', () => {
    expect(isValidEmail('student@')).toBe(false);
  });

  it('rejects missing local part', () => {
    expect(isValidEmail('@msudenver.edu')).toBe(false);
  });

  it('rejects spaces', () => {
    expect(isValidEmail('stu dent@msudenver.edu')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidEmail('')).toBe(false);
  });
});
