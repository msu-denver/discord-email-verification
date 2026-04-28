/**
 * Discord Email Verification Bot - Configuration
 *
 * Centralizes all configuration from environment variables and creates
 * the Discord client with the correct intents for discord.js v14.
 *
 * Original author: Luke J Farchione | J4eva | 2/25/2025
 * Migrated to discord.js v14 + AWS SES + DynamoDB by MSU Denver CyberBridge
 * Testing for CodeOwners
 * @license MIT
 */

import { Client, GatewayIntentBits, Partials } from 'discord.js';
import dotenv from 'dotenv';

dotenv.config();

// Discord Bot client — discord.js v14 uses GatewayIntentBits enum instead of Intents.FLAGS
export const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
  ],
  partials: [Partials.Channel],
});

// Discord configuration
export const token = process.env.DISCORD_BOT_TOKEN;
export const SERVER_ID = process.env.SERVER_ID;
export const VERIFICATION_CHANNEL_ID = process.env.VERIFICATION_CHANNEL_ID;
export const WELCOME_CHANNEL_ID = process.env.WELCOME_CHANNEL_ID || VERIFICATION_CHANNEL_ID;
export const QUARANTINE_ROLE_ID = process.env.QUARANTINE_ROLE_ID;
export const VERIFIED_ROLE_ID = process.env.VERIFIED_ROLE_ID;
export const SERVER_NAME = process.env.SERVER_NAME || 'CyberBridge';
export const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID;

// AWS configuration
export const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
export const AWS_ENDPOINT_URL = process.env.AWS_ENDPOINT_URL || '';

// Storage configuration
export const USE_LOCAL_STORAGE = process.env.USE_LOCAL_STORAGE === 'true';
export const DYNAMODB_TABLE_NAME = process.env.DYNAMODB_TABLE_NAME || 'discord-verification';

// Email configuration (Amazon SES)
export const SES_FROM_EMAIL = process.env.SES_FROM_EMAIL || 'verification@example.edu';
export const SES_FROM_NAME = process.env.SES_FROM_NAME || 'CyberBridge Discord Verification';

// Verification settings
export const CODE_EXPIRATION = 30 * 60 * 1000; // 30 minutes
export const MAX_VERIFICATIONS_PER_EMAIL = 2;
