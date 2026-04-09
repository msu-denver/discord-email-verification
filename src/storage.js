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
  async saveCodeToStorage(userId, email, code) {
    try {
      await this.docClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            PK: `CODE#${code}`,
            SK: `USER#${userId}`,
            email,
            code,
            userId,
            createdAt: new Date().toISOString(),
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
          Key: { PK: `CODE#${code}`, SK: `USER#${userId}` },
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

    if (fs.existsSync(this.domainsPath)) {
      const raw = fs.readFileSync(this.domainsPath, 'utf-8');
      this.allowedDomains = JSON.parse(raw);
    } else {
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
  async saveCodeToStorage(userId, email, code) {
    try {
      const filePath = path.join(this.codesDir, `${userId}.json`);
      const data = { userId, email, code, createdAt: new Date().toISOString() };
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      return true;
    } catch (err) {
      console.error('[LocalStorage] Error saving code:', err.message);
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
