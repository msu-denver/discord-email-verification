/**
 * Tests for src/storage.js — LocalStorage backend
 *
 * Uses real filesystem operations in a temp directory so we're testing
 * actual I/O behavior, not just mock wiring.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { LocalStorage } from '../src/storage.js';

let tmpDir;
let storage;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-test-'));
  storage = new LocalStorage(tmpDir);
  await storage.initialize();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------- initialize ----------

describe('initialize', () => {
  it('creates required directories', () => {
    expect(fs.existsSync(path.join(tmpDir, 'pending_codes'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'used_codes'))).toBe(true);
  });

  it('creates an empty allowed_domains.json if none exists', () => {
    const domainsPath = path.join(tmpDir, 'allowed_domains.json');
    expect(fs.existsSync(domainsPath)).toBe(true);
    expect(JSON.parse(fs.readFileSync(domainsPath, 'utf-8'))).toEqual([]);
  });
});

// ---------- domains ----------

describe('domain management', () => {
  it('starts with no allowed domains', () => {
    expect(storage.getAllowedDomains()).toEqual([]);
  });

  it('saves and retrieves domains', async () => {
    await storage.saveAllowedDomains(['msudenver.edu', 'example.com']);
    expect(storage.getAllowedDomains()).toEqual(['msudenver.edu', 'example.com']);
  });

  it('persists domains across instances', async () => {
    await storage.saveAllowedDomains(['msudenver.edu']);

    const storage2 = new LocalStorage(tmpDir);
    await storage2.initialize();
    expect(storage2.getAllowedDomains()).toEqual(['msudenver.edu']);
  });

  it('checks allowed domain correctly', async () => {
    await storage.saveAllowedDomains(['msudenver.edu']);
    expect(storage.isAllowedDomain('student@msudenver.edu')).toBe(true);
    expect(storage.isAllowedDomain('student@gmail.com')).toBe(false);
  });
});

// ---------- getStorageInfo ----------

describe('getStorageInfo', () => {
  it('returns Local for all storage types', () => {
    const info = storage.getStorageInfo();
    expect(info.domains).toBe('Local');
    expect(info.pendingCodes).toBe('Local');
    expect(info.usedCodes).toBe('Local');
  });
});

// ---------- pending codes ----------

describe('saveCodeToStorage', () => {
  it('saves a pending code as a JSON file', async () => {
    await storage.saveCodeToStorage('user123', 'student@test.edu', 'ABCD1234');

    const filePath = path.join(tmpDir, 'pending_codes', 'user123.json');
    expect(fs.existsSync(filePath)).toBe(true);

    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(data.userId).toBe('user123');
    expect(data.email).toBe('student@test.edu');
    expect(data.code).toBe('ABCD1234');
  });
});

// ---------- moveToUsedCodes ----------

describe('moveToUsedCodes', () => {
  it('removes pending file and creates used file', async () => {
    await storage.saveCodeToStorage('user123', 'student@test.edu', 'ABCD1234');
    await storage.moveToUsedCodes('user123', 'student@test.edu', 'ABCD1234');

    const pendingPath = path.join(tmpDir, 'pending_codes', 'user123.json');
    expect(fs.existsSync(pendingPath)).toBe(false);

    const usedFiles = fs.readdirSync(path.join(tmpDir, 'used_codes'));
    expect(usedFiles.length).toBe(1);

    const data = JSON.parse(
      fs.readFileSync(path.join(tmpDir, 'used_codes', usedFiles[0]), 'utf-8')
    );
    expect(data.email).toBe('student@test.edu');
    expect(data.code).toBe('ABCD1234');
  });
});

// ---------- getEmailVerificationCount ----------

describe('getEmailVerificationCount', () => {
  it('returns 0 for unknown email', async () => {
    expect(await storage.getEmailVerificationCount('nobody@test.edu')).toBe(0);
  });

  it('counts verified emails correctly', async () => {
    await storage.saveCodeToStorage('user1', 'student@test.edu', 'CODE1');
    await storage.moveToUsedCodes('user1', 'student@test.edu', 'CODE1');

    await storage.saveCodeToStorage('user2', 'student@test.edu', 'CODE2');
    await storage.moveToUsedCodes('user2', 'student@test.edu', 'CODE2');

    expect(await storage.getEmailVerificationCount('student@test.edu')).toBe(2);
  });

  it('is case-insensitive', async () => {
    await storage.saveCodeToStorage('user1', 'Student@Test.EDU', 'CODE1');
    await storage.moveToUsedCodes('user1', 'Student@Test.EDU', 'CODE1');

    expect(await storage.getEmailVerificationCount('student@test.edu')).toBe(1);
  });
});

// ---------- resetEmail ----------

describe('resetEmail', () => {
  it('deletes all records for the given email', async () => {
    await storage.saveCodeToStorage('user1', 'student@test.edu', 'CODE1');
    await storage.moveToUsedCodes('user1', 'student@test.edu', 'CODE1');

    await storage.saveCodeToStorage('user2', 'student@test.edu', 'CODE2');
    await storage.moveToUsedCodes('user2', 'student@test.edu', 'CODE2');

    const result = await storage.resetEmail('student@test.edu');
    expect(result.success).toBe(true);
    expect(result.deletedCount).toBe(2);

    expect(await storage.getEmailVerificationCount('student@test.edu')).toBe(0);
  });

  it('returns failure for unknown email', async () => {
    const result = await storage.resetEmail('nobody@test.edu');
    expect(result.success).toBe(false);
    expect(result.reason).toContain('No verification records');
  });

  it('does not affect other emails', async () => {
    await storage.saveCodeToStorage('user1', 'a@test.edu', 'CODE1');
    await storage.moveToUsedCodes('user1', 'a@test.edu', 'CODE1');

    await storage.saveCodeToStorage('user2', 'b@test.edu', 'CODE2');
    await storage.moveToUsedCodes('user2', 'b@test.edu', 'CODE2');

    await storage.resetEmail('a@test.edu');

    expect(await storage.getEmailVerificationCount('a@test.edu')).toBe(0);
    expect(await storage.getEmailVerificationCount('b@test.edu')).toBe(1);
  });
});
