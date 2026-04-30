/**
 * Discord Email Verification Bot - Verification Command Handlers
 *
 * Original author: Luke J Farchione | J4eva | 2/25/2025
 * Migrated by MSU Denver CyberBridge
 * @license MIT
 */

import {
  QUARANTINE_ROLE_ID,
  VERIFIED_ROLE_ID,
  WELCOME_CHANNEL_ID,
  CODE_EXPIRATION,
  MAX_VERIFICATIONS_PER_EMAIL,
  SERVER_NAME,
} from '../config.js';
import storage from '../storage.js';
import { formatTimeLeft, generateVerificationCode, isValidEmail } from '../utils.js';
import { sendVerificationEmail } from '../emailer.js';

// In-memory store for pending verifications.
// Note: if the bot restarts, pending codes are lost — users can request a new one.
export const pendingVerifications = new Map();

/**
 * Handle the /verify command.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function handleVerifyCommand(interaction) {
  const member = interaction.member;

  // Already verified?
  if (!member.roles.cache.has(QUARANTINE_ROLE_ID)) {
    return interaction.reply({
      content: "You're already verified! Enjoy the server!",
      ephemeral: true,
    });
  }

  const email = interaction.options.getString('email')?.toLowerCase().trim();
  if (!email) {
    return interaction.reply({
      content: 'Please provide a valid email address.',
      ephemeral: true,
    });
  }

  // RFC 5321 caps email addresses at 254 chars total and the local-part
  // (before @) at 64 chars. Reject before any expensive operation (storage
  // lookup, log line, DynamoDB key construction). The format check via
  // isValidEmail catches the rest (bad TLD shape, hyphen-edged labels, etc.).
  const atIdx = email.indexOf('@');
  if (
    email.length > 254 ||
    atIdx < 1 ||
    atIdx > 64 ||
    !isValidEmail(email)
  ) {
    return interaction.reply({
      content: 'That email address is not in a valid format. Please check and try again.',
      ephemeral: true,
    });
  }

  // Domain check
  if (!storage.isAllowedDomain(email)) {
    const domainList = storage.getAllowedDomains().join(', ');
    return interaction.reply({
      content: `Sorry, we only accept email addresses from these domains: ${domainList}. Please use your educational email address.`,
      ephemeral: true,
    });
  }

  // Max-verifications check
  const verifiedCount = await storage.getEmailVerificationCount(email);
  if (verifiedCount >= MAX_VERIFICATIONS_PER_EMAIL) {
    return interaction.reply({
      content:
        `This email has reached the maximum of ${MAX_VERIFICATIONS_PER_EMAIL} verifications.\n\n` +
        '**Need help?** Please contact a server admin. They can use `/admin resetemail` to allow your email to be used again.',
      ephemeral: true,
    });
  }

  // Throttle — 5 minutes between requests
  if (pendingVerifications.has(interaction.user.id)) {
    const existing = pendingVerifications.get(interaction.user.id);
    const elapsed = Date.now() - existing.timestamp;

    if (elapsed < 5 * 60 * 1000) {
      const timeLeft = formatTimeLeft(5 * 60 * 1000 - elapsed);
      return interaction.reply({
        content: `You recently requested a verification code. Please wait ${timeLeft} before requesting a new one.`,
        ephemeral: true,
      });
    }
  }

  // Generate code, persist, and send email
  const code = generateVerificationCode();
  pendingVerifications.set(interaction.user.id, {
    email,
    code,
    timestamp: Date.now(),
    attempts: 0,
  });

  await storage.saveCodeToStorage(interaction.user.id, email, code);
  const emailSent = await sendVerificationEmail(email, code);

  if (emailSent) {
    return interaction.reply({
      content:
        `**Great! I've sent a verification code to ${email}**\n\n` +
        `Please check your inbox (and spam/junk folders) for an email from ${SERVER_NAME} Discord Verification.\n\n` +
        'Once you have the code, use the `/verifycode` command to complete your verification.\n\n' +
        'Example: `/verifycode code:ABC123`',
      ephemeral: true,
    });
  }

  // Keep the throttle entry on SES failure so a user can't burn quota by
  // re-calling /verify in a tight loop. They'll be locked out for 5 min,
  // matching the success-path throttle.
  return interaction.reply({
    content: 'There was an error sending the verification email. Please try again later or contact a server admin.',
    ephemeral: true,
  });
}

/**
 * Handle the /verifycode command.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function handleVerifyCodeCommand(interaction) {
  const userId = interaction.user.id;
  const data = pendingVerifications.get(userId);

  if (!data) {
    return interaction.reply({
      content: "I don't see any pending verification for you. Please use the `/verify` command first to request a verification code.",
      ephemeral: true,
    });
  }

  // Expired?
  if (Date.now() - data.timestamp > CODE_EXPIRATION) {
    pendingVerifications.delete(userId);
    return interaction.reply({
      content: 'Your verification code has expired. Please use the `/verify` command again to request a new code.',
      ephemeral: true,
    });
  }

  const submittedCode = interaction.options.getString('code')?.toUpperCase();

  // Reject obviously-malformed input before counting it as an attempt.
  // The code we generate is always 8 hex chars; junk would never match
  // anyway, and shouldn't burn one of the 3 real attempts.
  if (!submittedCode || submittedCode.length > 100) {
    return interaction.reply({
      content: 'That code is not in a valid format. Please check the email and try again.',
      ephemeral: true,
    });
  }

  // Too many attempts?
  data.attempts += 1;
  if (data.attempts > 3) {
    pendingVerifications.delete(userId);
    return interaction.reply({
      content: "You've made too many incorrect attempts. Please use the `/verify` command again to request a new code.",
      ephemeral: true,
    });
  }

  if (submittedCode !== data.code) {
    const attemptsLeft = 3 - data.attempts;
    return interaction.reply({
      content:
        `That code doesn't match what we sent you. You have ${attemptsLeft} attempt${attemptsLeft !== 1 ? 's' : ''} left.\n\n` +
        'Please double-check and try again, or use `/verify` to request a new code.',
      ephemeral: true,
    });
  }

  // Code matches — verify the user
  try {
    const member = interaction.member;
    await member.roles.remove(QUARANTINE_ROLE_ID);

    const verifiedRole = member.guild.roles.cache.get(VERIFIED_ROLE_ID);
    if (verifiedRole) {
      await member.roles.add(verifiedRole);
      console.log(`[verifycode] Verified ${member.user.tag}`);
    } else {
      console.error(`[verifycode] Verified role not found: ${VERIFIED_ROLE_ID}`);
    }

    await storage.moveToUsedCodes(userId, data.email, data.code);
    pendingVerifications.delete(userId);

    // Welcome message
    try {
      const welcomeChannel = member.guild.channels.cache.get(WELCOME_CHANNEL_ID);
      if (welcomeChannel) {
        await welcomeChannel.send({
          content: `Please welcome **${member.user.username}** to the ${SERVER_NAME} community! They've just completed verification and joined our server.`,
        });
      }
    } catch (error) {
      console.error('[verifycode] Error sending welcome message:', error);
    }

    return interaction.reply({
      content: `**Verification successful!** Welcome to the ${SERVER_NAME} Discord community! You now have full access to the server.`,
      ephemeral: true,
    });
  } catch (error) {
    console.error('[verifycode] Error verifying user:', error);
    return interaction.reply({
      content: 'There was an error completing your verification. Please contact a server admin.',
      ephemeral: true,
    });
  }
}
