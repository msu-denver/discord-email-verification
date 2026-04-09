/**
 * Discord Email Verification Bot - Main Entry Point
 *
 * Original author: Luke J Farchione | J4eva | 2/25/2025
 * Migrated to discord.js v14 + AWS SES + DynamoDB by MSU Denver CyberBridge
 * @license MIT
 */

import { client, token } from './config.js';
import storage from './storage.js';
import { registerCommands } from './commands/index.js';
import setupEventHandlers from './events.js';

/**
 * Initialize the bot: connect storage, wire event handlers, log in, and register commands.
 */
async function initialize() {
  console.log('Initializing Discord Email Verification Bot...');

  await storage.initialize();
  setupEventHandlers(client);

  try {
    await client.login(token);
    console.log('Bot logged in successfully');
    await registerCommands(client);
  } catch (error) {
    console.error('Failed to start bot:', error);
    process.exit(1);
  }
}

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});

initialize();
