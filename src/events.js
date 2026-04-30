/**
 * Discord Email Verification Bot - Event Handlers
 *
 * Original author: Luke J Farchione | J4eva | 2/25/2025
 * Migrated to discord.js v14 by MSU Denver CyberBridge
 * @license MIT
 */

import {
  VERIFICATION_CHANNEL_ID,
  QUARANTINE_ROLE_ID,
  SERVER_ID,
  SERVER_NAME,
} from './config.js';
import { handleVerifyCommand, handleVerifyCodeCommand } from './commands/verify.js';
import { handleAdminCommand } from './commands/admin.js';
import { writeHeartbeat } from './utils.js';

// 30-second cadence; the Dockerfile HEALTHCHECK requires the file to be
// modified within the last 90 seconds (so a single missed tick is OK,
// but a real disconnect surfaces in ~3 minutes via 3 retries).
const HEARTBEAT_INTERVAL_MS = 30 * 1000;

/**
 * Set up all Discord event handlers on the client.
 * @param {import('discord.js').Client} client
 */
export default function setupEventHandlers(client) {
  // Bot ready
  client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}`);

    // Dynamic import to avoid circular dependency at module load time
    const storage = (await import('./storage.js')).default;
    const storageInfo = storage.getStorageInfo();
    console.log('Storage Configuration:');
    console.log(`- Domains storage: ${storageInfo.domains}`);
    console.log(`- Pending codes storage: ${storageInfo.pendingCodes}`);
    console.log(`- Used codes storage: ${storageInfo.usedCodes}`);

    try {
      const guild = client.guilds.cache.get(SERVER_ID);
      if (guild) {
        const commands = await guild.commands.fetch();
        console.log(`[ready] Loaded ${commands.size} slash commands`);
      }
    } catch (error) {
      console.error('[ready] Error fetching commands:', error);
    }

    // Start the heartbeat so the Docker HEALTHCHECK can detect a silent
    // gateway disconnect. Touch immediately, then on every interval — but
    // only while the WebSocket is actually ready. If discord.js drops and
    // tries to reconnect, isReady() returns false and the file goes stale.
    writeHeartbeat();
    setInterval(() => {
      if (client.isReady()) writeHeartbeat();
    }, HEARTBEAT_INTERVAL_MS);
  });

  // New member join — assign quarantine role and send welcome prompt
  client.on('guildMemberAdd', async (member) => {
    try {
      const quarantineRole = member.guild.roles.cache.get(QUARANTINE_ROLE_ID);
      if (quarantineRole) {
        await member.roles.add(quarantineRole);
        console.log(`[guildMemberAdd] Quarantined new member: ${member.user.tag}`);

        const verificationChannel = member.guild.channels.cache.get(VERIFICATION_CHANNEL_ID);
        if (verificationChannel) {
          await verificationChannel.send({
            content:
              `Welcome to ${SERVER_NAME}'s Discord community, ${member}!\n\n` +
              'To get verified, please use the `/verify` command with your school email address.\n\n' +
              'Example: `/verify email:your.name@msudenver.edu`',
          });
        }
      }
    } catch (error) {
      console.error('[guildMemberAdd] Error:', error);
    }
  });

  // Slash command interactions — discord.js v14 uses isChatInputCommand()
  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    try {
      switch (commandName) {
        case 'admin':
          await handleAdminCommand(interaction);
          break;
        case 'verify':
          await handleVerifyCommand(interaction);
          break;
        case 'verifycode':
          await handleVerifyCodeCommand(interaction);
          break;
        default:
          await interaction.reply({
            content: `Unknown command: ${commandName}`,
            ephemeral: true,
          });
      }
    } catch (error) {
      console.error(`[interactionCreate] Error handling "${commandName}":`, error);

      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: 'An error occurred while processing your command. Please try again later or contact a server admin.',
          ephemeral: true,
        });
      } else if (interaction.deferred && !interaction.replied) {
        await interaction.editReply({
          content: 'An error occurred while processing your command. Please try again later or contact a server admin.',
        });
      }
    }
  });

  client.on('error', (error) => {
    console.error('Discord client error:', error);
  });
}
