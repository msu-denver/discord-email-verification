/**
 * Discord Email Verification Bot - Utility Functions
 *
 * Original author: Luke J Farchione | J4eva | 2/25/2025
 * Migrated by MSU Denver CyberBridge
 * @license MIT
 */

import fs from 'fs';
import crypto from 'crypto';
import { ADMIN_ROLE_ID } from './config.js';

/**
 * Format milliseconds into a human-readable time string.
 * @param {number} milliseconds
 * @returns {string}
 */
export function formatTimeLeft(milliseconds) {
  const minutes = Math.floor(milliseconds / 60000);
  const seconds = Math.floor((milliseconds % 60000) / 1000);

  if (minutes > 0) {
    return `${minutes} minute${minutes !== 1 ? 's' : ''}${seconds > 0 ? ` and ${seconds} second${seconds !== 1 ? 's' : ''}` : ''}`;
  }
  return `${seconds} second${seconds !== 1 ? 's' : ''}`;
}

/**
 * Ensure a directory exists, creating it recursively if needed.
 * @param {string} dirPath
 */
export function ensureDirectoryExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`[ensureDirectoryExists] Created directory: ${dirPath}`);
  }
}

/**
 * Generate an 8-character uppercase hex verification code.
 * @returns {string}
 */
export function generateVerificationCode() {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

/**
 * Check whether a Discord guild member holds the admin role.
 * @param {import('discord.js').GuildMember} member
 * @returns {boolean}
 */
export function hasAdminRole(member) {
  return member.roles.cache.has(ADMIN_ROLE_ID);
}

// Email format check based on the WHATWG/HTML5 `<input type="email">` regex.
// Stricter than the previous "anything-with-a-dot" check: rejects bare TLDs,
// labels starting/ending with hyphens, missing local part, etc. We layer an
// extra "no consecutive dots in local part" rule on top, which the HTML5
// regex permits but valid SMTP addresses don't (RFC 5322).
const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

/**
 * Format-validate an email address. Used as a defensive check alongside the
 * domain whitelist; not a full RFC 5322 parser.
 * @param {string} email
 * @returns {boolean}
 */
export function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const at = email.indexOf('@');
  if (at < 1) return false;
  const local = email.slice(0, at);
  // RFC 5322 forbids consecutive dots and leading/trailing dots in the
  // local part. Easy to enforce up front.
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
  return EMAIL_REGEX.test(email);
}

// Heartbeat path that the Docker HEALTHCHECK reads. Written by the bot's
// 'ready' event handler on a setInterval; if the WebSocket disconnects, the
// file's mtime stops advancing and the healthcheck eventually fails.
//
// The container runs --read-only with tmpfs mounted at /tmp, so this path
// is writable in production and ephemeral by design (cleared on restart).
export const BOT_HEARTBEAT_FILE = '/tmp/discord-bot-heartbeat';

/**
 * Touch the heartbeat file with the current timestamp. Tolerant of write
 * failures so a transient I/O issue doesn't crash the bot — the next
 * interval tick will retry, and the healthcheck will catch a sustained
 * outage on its own.
 *
 * @param {string} [filePath=BOT_HEARTBEAT_FILE] override for testing
 */
export function writeHeartbeat(filePath = BOT_HEARTBEAT_FILE) {
  try {
    fs.writeFileSync(filePath, String(Date.now()));
  } catch (error) {
    console.error('[writeHeartbeat] Failed to write heartbeat:', error.message);
  }
}
