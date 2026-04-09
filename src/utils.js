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

/**
 * Basic email format validation.
 * @param {string} email
 * @returns {boolean}
 */
export function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}
