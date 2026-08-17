/**
 * Discord Email Verification Bot - Storage Module
 *
 * This module was missing from the original repository and has been written
 * from scratch. It implements two storage backends:
 *
 *   1. DynamoDBStorage — for production use on AWS
 *   2. LocalStorage    — for local development (no AWS needed)
 *
 * A factory function selects the backend based on the USE_LOCAL_STORAGE config.
 *
 * @author MSU Denver CyberBridge
 * @license MIT
 */

import fs from 'fs';
import path from 'path';
import { DynamoDBClient, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import pkg from '@aws-sdk/lib-dynamodb';
const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
  BatchWriteCommand,
} = pkg;
import {
  AWS_REGION,
  USE_LOCAL_STORAGE,
  DYNAMODB_TABLE_NAME,
} from './config.js';
import { ensureDirectoryExists } from './utils.js';

// Pending verifications are keyed by user, not by code, because every read is
// "what is this user waiting on?" (a /verifycode submission, an expiry check).
// A constant sort key keeps one pending verification per user, matching the
// in-memory map that a second /verify overwrites.
const PENDING_SK = 'PENDING';

// ---------------------------------------------------------------------------
// DynamoDB Storage
// ---------------------------------------------------------------------------

/**
 * DynamoDB-backed storage for production use on AWS.
 * Uses a single-table design with PK/SK key pattern.
 */
export class DynamoDBStorage {
  /**
   * @param {string} tableName - DynamoDB table name
   * @param {string} region - AWS region
   */
  constructor(tableName, region) {
    this.tableName = tableName;
    const client = new DynamoDBClient({ region });
    this.docClient = DynamoDBDocumentClient.from(client);
    this.allowedDomains = [];
  }

  /**
   * Verify the DynamoDB table exists and load allowed domains into memory.
   */
  async initialize() {
    try {
      await this.docClient.send(
        new DescribeTableCommand({ TableName: this.tableName })
      );
    } catch (err) {
      if (err.name === 'ResourceNotFoundException') {
        console.warn(
          `[DynamoDBStorage] Table "${this.tableName}" not found. ` +
          'Create it via CloudFormation or the AWS console.'
        );
      } else {
        throw err;
      }
    }

    const result = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: 'CONFIG', SK: 'DOMAINS' },
      })
    );
    this.allowedDomains = result.Item?.domains ?? [];
    console.log(`[DynamoDBStorage] Loaded ${this.allowedDomains.length} allowed domain(s)`);
  }

  /** @returns {{ domains: string, pendingCodes: string, usedCodes: string, tableName: string }} */
  getStorageInfo() {
    return {
      domains: 'DynamoDB',
      pendingCodes: 'DynamoDB',
      usedCodes: 'DynamoDB',
      tableName: this.tableName,
    };
  }

  /** @returns {string[]} Copy of the cached allowed domains list. */
  getAllowedDomains() {
    return [...this.allowedDomains];
  }

  /**
   * Check if an email's domain is in the allowed list.
   * @param {string} email
   * @returns {boolean}
   */
  isAllowedDomain(email) {
    const domain = email.split('@')[1]?.toLowerCase();
    return this.allowedDomains.includes(domain);
  }

  /**
   * Persist the allowed domains list and update the in-memory cache.
   * @param {string[]} domains
   * @returns {Promise<boolean>}
   */
  async saveAllowedDomains(domains) {
    try {
      await this.docClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: { PK: 'CONFIG', SK: 'DOMAINS', domains },
        })
      );
      this.allowedDomains = [...domains];
      return true;
    } catch (err) {
      console.error('[DynamoDBStorage] Error saving domains:', err.message);
      return false;
    }
  }

  /**
   * Save a pending verification code.
   * @param {string} userId - Discord user ID
   * @param {string} email - Email address being verified
   * @param {string} code - Generated verification code
   * @returns {Promise<boolean>}
   */
  async saveCodeToStorage(userId, email, code, expiresAtEpochSeconds) {
    try {
      await this.docClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            PK: `PENDING#${userId}`,
            SK: PENDING_SK,
            email,
            code,
            userId,
            attempts: 0,
            createdAt: new Date().toISOString(),
            // Drives the table's TTL. DynamoDB deletes expired items on its own
            // schedule (typically hours, guaranteed only within 48h), so this
            // reclaims abandoned rows but must never be the expiry check the
            // user experiences -- handleVerifyCodeCommand still compares
            // timestamps itself.
            expiresAt: expiresAtEpochSeconds,
          },
        })
      );
      return true;
    } catch (err) {
      console.error('[DynamoDBStorage] Error saving code:', err.message);
      return false;
    }
  }

  /**
   * Read back a user's pending verification. Lets /verifycode survive a bot
   * restart, which drops the in-memory map but leaves this row intact.
   * @param {string} userId
   * @returns {Promise<{email: string, code: string, attempts: number, createdAt: string} | null>}
   */
  async getPendingCode(userId) {
    try {
      const result = await this.docClient.send(
        new GetCommand({
          TableName: this.tableName,
          Key: { PK: `PENDING#${userId}`, SK: PENDING_SK },
        })
      );
      if (!result.Item) return null;

      const { email, code, attempts, createdAt } = result.Item;
      return { email, code, attempts: attempts ?? 0, createdAt };
    } catch (err) {
      console.error('[DynamoDBStorage] Error reading pending code:', err.message);
      return null;
    }
  }

  /**
   * Persist the failed-attempt counter so the 3-strike limit is not silently
   * reset by a restart.
   * @param {string} userId
   * @param {number} attempts
   * @returns {Promise<boolean>}
   */
  async updatePendingAttempts(userId, attempts) {
    try {
      await this.docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { PK: `PENDING#${userId}`, SK: PENDING_SK },
          UpdateExpression: 'SET attempts = :a',
          // Do not resurrect a row that expiry, exhaustion, or a successful
          // verification already deleted.
          ConditionExpression: 'attribute_exists(PK)',
          ExpressionAttributeValues: { ':a': attempts },
        })
      );
      return true;
    } catch (err) {
      if (err.name === 'ConditionalCheckFailedException') return false;
      console.error('[DynamoDBStorage] Error updating attempts:', err.message);
      return false;
    }
  }

  /**
   * Drop a pending verification that ended without success (expired, or too
   * many wrong codes), so it cannot be rehydrated after a restart.
   * @param {string} userId
   * @returns {Promise<boolean>}
   */
  async deletePendingCode(userId) {
    try {
      await this.docClient.send(
        new DeleteCommand({
          TableName: this.tableName,
          Key: { PK: `PENDING#${userId}`, SK: PENDING_SK },
        })
      );
      return true;
    } catch (err) {
      console.error('[DynamoDBStorage] Error deleting pending code:', err.message);
      return false;
    }
  }

  /**
   * Count how many times an email has been used for verification.
   * @param {string} email
   * @returns {Promise<number>}
   */
  async getEmailVerificationCount(email) {
    try {
      const result = await this.docClient.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'PK = :pk',
          ExpressionAttributeValues: { ':pk': `USED#${email.toLowerCase()}` },
          Select: 'COUNT',
        })
      );
      return result.Count ?? 0;
    } catch (err) {
      console.error('[DynamoDBStorage] Error counting verifications:', err.message);
      return 0;
    }
  }

  /**
   * Move a verification code from pending to used (marks verification complete).
   * @param {string} userId
   * @param {string} email
   * @param {string} code
   * @returns {Promise<boolean>}
   */
  async moveToUsedCodes(userId, email, code) {
    const now = new Date().toISOString();
    try {
      await this.docClient.send(
        new DeleteCommand({
          TableName: this.tableName,
          Key: { PK: `PENDING#${userId}`, SK: PENDING_SK },
        })
      );
      await this.docClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            PK: `USED#${email.toLowerCase()}`,
            SK: now,
            email: email.toLowerCase(),
            code,
            userId,
            verifiedAt: now,
          },
        })
      );
      return true;
    } catch (err) {
      console.error('[DynamoDBStorage] Error moving code:', err.message);
      return false;
    }
  }

  /**
   * Delete all verification records for an email, allowing it to be reused.
   * @param {string} email
   * @returns {Promise<{ success: boolean, deletedCount?: number, reason?: string }>}
   */
  async resetEmail(email) {
    try {
      const result = await this.docClient.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'PK = :pk',
          ExpressionAttributeValues: { ':pk': `USED#${email.toLowerCase()}` },
        })
      );

      const items = result.Items ?? [];
      if (items.length === 0) {
        return { success: false, reason: 'No verification records found for this email.' };
      }

      const batches = [];
      for (let i = 0; i < items.length; i += 25) {
        batches.push(items.slice(i, i + 25));
      }

      for (const batch of batches) {
        await this.docClient.send(
          new BatchWriteCommand({
            RequestItems: {
              [this.tableName]: batch.map((item) => ({
                DeleteRequest: { Key: { PK: item.PK, SK: item.SK } },
              })),
            },
          })
        );
      }

      return { success: true, deletedCount: items.length };
    } catch (err) {
      console.error('[DynamoDBStorage] Error resetting email:', err.message);
      return { success: false, reason: err.message };
    }
  }
}

// ---------------------------------------------------------------------------
// Local File Storage (for development)
// ---------------------------------------------------------------------------

/**
 * File-based storage for local development. Stores data as JSON files
 * in a configurable directory. No AWS credentials needed.
 */
export class LocalStorage {
  /**
   * @param {string} [baseDir] - Base directory for storage files (defaults to ./data)
   */
  constructor(baseDir) {
    this.baseDir = baseDir || path.join(process.cwd(), 'data');
    this.domainsPath = path.join(this.baseDir, 'allowed_domains.json');
    this.codesDir = path.join(this.baseDir, 'pending_codes');
    this.usedCodesDir = path.join(this.baseDir, 'used_codes');
    this.allowedDomains = [];
  }

  /**
   * Create storage directories and load allowed domains from disk.
   */
  async initialize() {
    ensureDirectoryExists(this.codesDir);
    ensureDirectoryExists(this.usedCodesDir);

    // Read-or-create-empty without a TOCTOU window. The previous
    // existsSync→readFileSync pattern let an attacker (theoretical here,
    // since this backend is dev-only) swap the file between check and
    // read. Catch ENOENT instead — atomic w.r.t. the filesystem.
    try {
      const raw = fs.readFileSync(this.domainsPath, 'utf-8');
      this.allowedDomains = JSON.parse(raw);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      this.allowedDomains = [];
      fs.writeFileSync(this.domainsPath, JSON.stringify([], null, 2));
    }
    console.log(`[LocalStorage] Loaded ${this.allowedDomains.length} allowed domain(s)`);
  }

  /** @returns {{ domains: string, pendingCodes: string, usedCodes: string, localDomainsPath: string, localCodesDir: string, localUsedCodesDir: string }} */
  getStorageInfo() {
    return {
      domains: 'Local',
      pendingCodes: 'Local',
      usedCodes: 'Local',
      localDomainsPath: this.domainsPath,
      localCodesDir: this.codesDir,
      localUsedCodesDir: this.usedCodesDir,
    };
  }

  /** @returns {string[]} Copy of the cached allowed domains list. */
  getAllowedDomains() {
    return [...this.allowedDomains];
  }

  /**
   * Check if an email's domain is in the allowed list.
   * @param {string} email
   * @returns {boolean}
   */
  isAllowedDomain(email) {
    const domain = email.split('@')[1]?.toLowerCase();
    return this.allowedDomains.includes(domain);
  }

  /**
   * Persist the allowed domains list to disk and update the in-memory cache.
   * @param {string[]} domains
   * @returns {Promise<boolean>}
   */
  async saveAllowedDomains(domains) {
    try {
      fs.writeFileSync(this.domainsPath, JSON.stringify(domains, null, 2));
      this.allowedDomains = [...domains];
      return true;
    } catch (err) {
      console.error('[LocalStorage] Error saving domains:', err.message);
      return false;
    }
  }

  /**
   * Save a pending verification code as a JSON file.
   * @param {string} userId - Discord user ID
   * @param {string} email - Email address being verified
   * @param {string} code - Generated verification code
   * @returns {Promise<boolean>}
   */
  async saveCodeToStorage(userId, email, code, expiresAtEpochSeconds) {
    try {
      const filePath = path.join(this.codesDir, `${userId}.json`);
      const data = {
        userId,
        email,
        code,
        attempts: 0,
        createdAt: new Date().toISOString(),
        // Mirrors the DynamoDB TTL attribute for parity. Nothing sweeps these
        // files in local development; the expiry the user experiences is the
        // timestamp check in handleVerifyCodeCommand, same as production.
        expiresAt: expiresAtEpochSeconds,
      };
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      return true;
    } catch (err) {
      console.error('[LocalStorage] Error saving code:', err.message);
      return false;
    }
  }

  /**
   * Read back a user's pending verification.
   * @param {string} userId
   * @returns {Promise<{email: string, code: string, attempts: number, createdAt: string} | null>}
   */
  async getPendingCode(userId) {
    try {
      const filePath = path.join(this.codesDir, `${userId}.json`);
      if (!fs.existsSync(filePath)) return null;

      const { email, code, attempts, createdAt } = JSON.parse(
        fs.readFileSync(filePath, 'utf-8')
      );
      return { email, code, attempts: attempts ?? 0, createdAt };
    } catch (err) {
      console.error('[LocalStorage] Error reading pending code:', err.message);
      return null;
    }
  }

  /**
   * Persist the failed-attempt counter.
   * @param {string} userId
   * @param {number} attempts
   * @returns {Promise<boolean>}
   */
  async updatePendingAttempts(userId, attempts) {
    try {
      const filePath = path.join(this.codesDir, `${userId}.json`);
      if (!fs.existsSync(filePath)) return false;

      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      data.attempts = attempts;
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      return true;
    } catch (err) {
      console.error('[LocalStorage] Error updating attempts:', err.message);
      return false;
    }
  }

  /**
   * Drop a pending verification that ended without success.
   * @param {string} userId
   * @returns {Promise<boolean>}
   */
  async deletePendingCode(userId) {
    try {
      const filePath = path.join(this.codesDir, `${userId}.json`);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return true;
    } catch (err) {
      console.error('[LocalStorage] Error deleting pending code:', err.message);
      return false;
    }
  }

  /**
   * Count how many times an email has been used for verification.
   * @param {string} email
   * @returns {Promise<number>}
   */
  async getEmailVerificationCount(email) {
    try {
      const files = fs.readdirSync(this.usedCodesDir);
      let count = 0;
      for (const file of files) {
        const raw = fs.readFileSync(path.join(this.usedCodesDir, file), 'utf-8');
        const record = JSON.parse(raw);
        if (record.email?.toLowerCase() === email.toLowerCase()) {
          count++;
        }
      }
      return count;
    } catch (err) {
      console.error('[LocalStorage] Error counting verifications:', err.message);
      return 0;
    }
  }

  /**
   * Move a verification code from pending to used (marks verification complete).
   * @param {string} userId
   * @param {string} email
   * @param {string} code
   * @returns {Promise<boolean>}
   */
  async moveToUsedCodes(userId, email, code) {
    try {
      const pendingPath = path.join(this.codesDir, `${userId}.json`);
      if (fs.existsSync(pendingPath)) {
        fs.unlinkSync(pendingPath);
      }

      const now = new Date().toISOString();
      const usedPath = path.join(this.usedCodesDir, `${userId}_${Date.now()}.json`);
      const data = { email: email.toLowerCase(), code, userId, verifiedAt: now };
      fs.writeFileSync(usedPath, JSON.stringify(data, null, 2));
      return true;
    } catch (err) {
      console.error('[LocalStorage] Error moving code:', err.message);
      return false;
    }
  }

  /**
   * Delete all verification records for an email, allowing it to be reused.
   * @param {string} email
   * @returns {Promise<{ success: boolean, deletedCount?: number, reason?: string }>}
   */
  async resetEmail(email) {
    try {
      const files = fs.readdirSync(this.usedCodesDir);
      let deletedCount = 0;

      for (const file of files) {
        const filePath = path.join(this.usedCodesDir, file);
        const raw = fs.readFileSync(filePath, 'utf-8');
        const record = JSON.parse(raw);
        if (record.email?.toLowerCase() === email.toLowerCase()) {
          fs.unlinkSync(filePath);
          deletedCount++;
        }
      }

      if (deletedCount === 0) {
        return { success: false, reason: 'No verification records found for this email.' };
      }
      return { success: true, deletedCount };
    } catch (err) {
      console.error('[LocalStorage] Error resetting email:', err.message);
      return { success: false, reason: err.message };
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Factory function — selects the storage backend based on USE_LOCAL_STORAGE config.
 * @returns {DynamoDBStorage | LocalStorage}
 */
function createStorage() {
  if (USE_LOCAL_STORAGE) {
    return new LocalStorage();
  }
  return new DynamoDBStorage(DYNAMODB_TABLE_NAME, AWS_REGION);
}

const storage = createStorage();
export default storage;
