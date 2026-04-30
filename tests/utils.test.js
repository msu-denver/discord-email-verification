/**
 * Tests for src/utils.js
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Mock config before importing utils
vi.mock('../src/config', () => ({
  ADMIN_ROLE_ID: 'admin-role-123',
}));

// Use dynamic import so the mock is in place first
const { formatTimeLeft, generateVerificationCode, hasAdminRole, isValidEmail, writeHeartbeat } =
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

  it('accepts plus-tag addresses', () => {
    expect(isValidEmail('student+club@msudenver.edu')).toBe(true);
  });

  it('accepts multi-label TLDs', () => {
    expect(isValidEmail('user@dept.example.co.uk')).toBe(true);
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

  it('rejects trailing dot in domain', () => {
    expect(isValidEmail('student@msudenver.edu.')).toBe(false);
  });

  it('rejects consecutive dots in local part', () => {
    expect(isValidEmail('first..last@msudenver.edu')).toBe(false);
  });

  it('rejects leading dot in local part', () => {
    expect(isValidEmail('.student@msudenver.edu')).toBe(false);
  });

  it('rejects domain label starting with hyphen', () => {
    expect(isValidEmail('user@-bad.edu')).toBe(false);
  });

  it('rejects domain label ending with hyphen', () => {
    expect(isValidEmail('user@bad-.edu')).toBe(false);
  });

  it('rejects non-string input', () => {
    expect(isValidEmail(null)).toBe(false);
    expect(isValidEmail(undefined)).toBe(false);
    expect(isValidEmail(42)).toBe(false);
  });
});

// ---------- writeHeartbeat ----------

describe('writeHeartbeat', () => {
  let tmpFile;

  beforeEach(() => {
    tmpFile = path.join(os.tmpdir(), `heartbeat-test-${process.pid}-${Date.now()}`);
  });

  afterEach(() => {
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      // file may not exist if a test asserted it wasn't written
    }
  });

  it('writes a numeric timestamp to the heartbeat file', () => {
    const before = Date.now();
    writeHeartbeat(tmpFile);
    const after = Date.now();

    const contents = fs.readFileSync(tmpFile, 'utf-8');
    const written = Number(contents);
    expect(Number.isFinite(written)).toBe(true);
    expect(written).toBeGreaterThanOrEqual(before);
    expect(written).toBeLessThanOrEqual(after);
  });

  it('overwrites the file on each call', () => {
    writeHeartbeat(tmpFile);
    const first = fs.readFileSync(tmpFile, 'utf-8');
    // Sleep a tick so timestamps differ.
    const t = Date.now();
    while (Date.now() === t) { /* spin */ }
    writeHeartbeat(tmpFile);
    const second = fs.readFileSync(tmpFile, 'utf-8');
    expect(second).not.toBe(first);
  });

  it('does not throw when the path is unwritable', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // /proc on Linux is read-only; on macOS the path just doesn't exist —
    // either way writeFileSync rejects, and we must swallow the error.
    expect(() => writeHeartbeat('/this/path/definitely/does/not/exist')).not.toThrow();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
