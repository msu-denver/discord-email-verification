/**
 * Discord Email Verification Bot - Event Handlers
 *
 * Original author: Luke J Farchione | J4eva | 2/25/2025
 * Migrated to discord.js v14 by MSU Denver CyberBridge
 * @license MIT
 */

import { MessageFlags } from 'discord.js';
import {
  VERIFICATION_CHANNEL_ID,
  QUARANTINE_ROLE_ID,
  SERVER_ID,
  SERVER_NAME,
  ENABLE_PLAINTEXT_COMMAND_NUDGE,
} from './config.js';
import { handleVerifyCommand, handleVerifyCodeCommand } from './commands/verify.js';
import { handleAdminCommand } from './commands/admin.js';
import { writeHeartbeat } from './utils.js';

// 30-second cadence; the Dockerfile HEALTHCHECK requires the file to be
// modified within the last 90 seconds (so a single missed tick is OK,
// but a real disconnect surfaces in ~3 minutes via 3 retries).
const HEARTBEAT_INTERVAL_MS = 30 * 1000;

// A slash command only reaches the bot when the user picks it from Discord's
// command menu. Typing the same characters by hand posts an ordinary message
// that never arrives as an interaction, so the verification silently does
// nothing from the user's point of view. Matches "/verify" and "/verifycode"
// only as whole command words, so "/verifying..." is left alone.
const PLAINTEXT_COMMAND_RE = /^\/verify(code)?\b/i;

// Loose on purpose: this only decides whether to warn someone that they just
// posted their address publicly, so a false positive costs an extra sentence
// and a false negative costs a missed privacy heads-up.
const LOOKS_LIKE_EMAIL_RE = /\S+@\S+\.\S+/;

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
              'To get verified:\n' +
              '1. Type `/` in the message box\n' +
              '2. **Pick `/verify` from the menu that pops up** (typing or pasting the ' +
              'command as plain text will not work, Discord only sends it when you ' +
              'select it from the menu)\n' +
              '3. Fill in the `email` field with your school email, then press Enter',
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
            flags: MessageFlags.Ephemeral,
          });
      }
    } catch (error) {
      console.error(`[interactionCreate] Error handling "${commandName}":`, error);

      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: 'An error occurred while processing your command. Please try again later or contact a server admin.',
          flags: MessageFlags.Ephemeral,
        });
      } else if (interaction.deferred && !interaction.replied) {
        await interaction.editReply({
          content: 'An error occurred while processing your command. Please try again later or contact a server admin.',
        });
      }
    }
  });

  // Rescue users who typed a command instead of selecting it. Without the
  // MessageContent intent every `content` is an empty string, so the pattern
  // never matches and this handler is inert; the flag keeps that intent
  // un-requested unless the portal toggle is on (see config.js).
  client.on('messageCreate', async (message) => {
    if (!ENABLE_PLAINTEXT_COMMAND_NUDGE) return;

    try {
      // Ignore this bot's own nudges (and every other bot) so two bots posting
      // command-shaped text can never answer each other in a loop.
      if (message.author?.bot) return;
      if (!PLAINTEXT_COMMAND_RE.test(message.content?.trim() ?? '')) return;

      console.log(
        `[messageCreate] Plain-text command from ${message.author?.tag}, sending nudge`
      );

      let nudge =
        `${message.author}, that came through as a normal message, so I never ` +
        'received it. Discord only sends a slash command when you pick it from the menu:\n\n' +
        '1. Type `/` in the message box\n' +
        '2. Choose **`/verify`** from the list that appears\n' +
        '3. Fill in the `email` field, then press Enter';

      if (LOOKS_LIKE_EMAIL_RE.test(message.content)) {
        nudge +=
          '\n\nHeads up: because it posted as a normal message, your email address ' +
          'is visible to this channel. You may want to delete it.';
      }

      await message.reply({ content: nudge });
    } catch (error) {
      // Never let a nudge failure (missing permissions, deleted message,
      // rate limit) bubble up and take down the gateway connection.
      console.error('[messageCreate] Error sending plain-text command nudge:', error);
    }
  });

  client.on('error', (error) => {
    console.error('Discord client error:', error);
  });
}
