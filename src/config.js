/**
 * Discord Email Verification Bot - Configuration
 *
 * Centralizes all configuration from environment variables and creates
 * the Discord client with the correct intents for discord.js v14.
 *
 * Original author: Luke J Farchione | J4eva | 2/25/2025
 * Migrated to discord.js v14 + AWS SES + DynamoDB by MSU Denver CyberBridge
 * @license MIT
 */

import { Client, GatewayIntentBits, Partials } from 'discord.js';
import dotenv from 'dotenv';

dotenv.config();

// Reply to messages where a user typed "/verify" as plain text instead of
// selecting the slash command. Reading message text requires the MessageContent
// PRIVILEGED intent, which must ALSO be enabled in the Discord Developer Portal
// (Bot -> Privileged Gateway Intents -> Message Content Intent). Requesting the
// intent here while the portal toggle is off makes client.login() reject with
// DisallowedIntents and the bot never starts, so this stays opt-in: turn the
// portal toggle on first, then set this to true.
export const ENABLE_PLAINTEXT_COMMAND_NUDGE =
  process.env.ENABLE_PLAINTEXT_COMMAND_NUDGE === 'true';

// Discord Bot client — discord.js v14 uses GatewayIntentBits enum instead of Intents.FLAGS
export const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    // Privileged; only requested when the nudge is switched on (see above).
    ...(ENABLE_PLAINTEXT_COMMAND_NUDGE ? [GatewayIntentBits.MessageContent] : []),
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
// Optional. When set, every SendEmail call carries ConfigurationSetName,
// which routes bounce/complaint events to the SES configuration set's
// SNS destinations (see infrastructure/app.yaml). Leave empty for local
// dev / LocalStack -- the bot then sends without a configuration set.
export const SES_CONFIGURATION_SET = process.env.SES_CONFIGURATION_SET || '';

// Verification settings
export const CODE_EXPIRATION = 30 * 60 * 1000; // 30 minutes
export const MAX_VERIFICATIONS_PER_EMAIL = 2;
