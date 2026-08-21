/**
 * Discord Email Verification Bot - Verification Command Handlers
 *
 * Original author: Luke J Farchione | J4eva | 2/25/2025
 * Migrated by MSU Denver CyberBridge
 * @license MIT
 */

import { MessageFlags } from 'discord.js';
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
      flags: MessageFlags.Ephemeral,
    });
  }

  const email = interaction.options.getString('email')?.toLowerCase().trim();
  if (!email) {
    return interaction.reply({
      content: 'Please provide a valid email address.',
      flags: MessageFlags.Ephemeral,
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
      flags: MessageFlags.Ephemeral,
    });
  }

  // Domain check
  if (!storage.isAllowedDomain(email)) {
    const domainList = storage.getAllowedDomains().join(', ');
    return interaction.reply({
      content: `Sorry, we only accept email addresses from these domains: ${domainList}. Please use your educational email address.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  // Max-verifications check
  const verifiedCount = await storage.getEmailVerificationCount(email);
  if (verifiedCount >= MAX_VERIFICATIONS_PER_EMAIL) {
    return interaction.reply({
      content:
        `This email has reached the maximum of ${MAX_VERIFICATIONS_PER_EMAIL} verifications.\n\n` +
        '**Need help?** Please contact a server admin. They can use `/admin resetemail` to allow your email to be used again.',
      flags: MessageFlags.Ephemeral,
    });
  }

  // Throttle — 5 minutes between requests.
  //
  // Falls back to storage on a map miss for the same reason /verifycode does:
  // a restart empties the map, and consulting it alone would hand every user
  // whose request preceded the restart a free extra code and email.
  let lastRequestedAt = pendingVerifications.get(interaction.user.id)?.timestamp;
  if (lastRequestedAt === undefined) {
    const stored = await storage.getPendingCode(interaction.user.id);
    // An unreadable createdAt yields NaN, which loses the comparison below and
    // so declines to throttle. That is the opposite of the expiry check in
    // handleVerifyCodeCommand, which treats NaN as already expired, and both
    // point the same way on purpose: a corrupt record must never leave a real
    // student unable to verify. Do not "fix" this into a throttling default.
    if (stored) lastRequestedAt = Date.parse(stored.createdAt);
  }

  if (lastRequestedAt !== undefined) {
    const elapsed = Date.now() - lastRequestedAt;

    if (elapsed < 5 * 60 * 1000) {
      const timeLeft = formatTimeLeft(5 * 60 * 1000 - elapsed);
      return interaction.reply({
        content: `You recently requested a verification code. Please wait ${timeLeft} before requesting a new one.`,
        flags: MessageFlags.Ephemeral,
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

  // Epoch seconds for the storage-side TTL; the user-facing expiry is still
  // enforced against `timestamp` in handleVerifyCodeCommand.
  const expiresAtEpochSeconds = Math.floor((Date.now() + CODE_EXPIRATION) / 1000);
  await storage.saveCodeToStorage(interaction.user.id, email, code, expiresAtEpochSeconds);
  const emailSent = await sendVerificationEmail(email, code);

  if (emailSent) {
    return interaction.reply({
      content:
        `**Great! I've sent a verification code to ${email}**\n\n` +
        `Please check your inbox (and spam/junk folders) for an email from ${SERVER_NAME} Discord Verification.\n\n` +
        'Once you have the code, use the `/verifycode` command to complete your verification.\n\n' +
        'Example: `/verifycode code:ABC123`',
      flags: MessageFlags.Ephemeral,
    });
  }

  // Keep the throttle entry on SES failure so a user can't burn quota by
  // re-calling /verify in a tight loop. They'll be locked out for 5 min,
  // matching the success-path throttle.
  return interaction.reply({
    content: 'There was an error sending the verification email. Please try again later or contact a server admin.',
    flags: MessageFlags.Ephemeral,
  });
}

/**
 * Handle the /verifycode command.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function handleVerifyCodeCommand(interaction) {
  const userId = interaction.user.id;
  let data = pendingVerifications.get(userId);

  // A restart empties this map while the durable row survives, which used to
  // strand anyone holding a valid code in their inbox. Fall back to storage
  // before claiming there is nothing pending, and rehydrate the map so the
  // rest of this request (and any retry) behaves like an uninterrupted run.
  if (!data) {
    const stored = await storage.getPendingCode(userId);
    if (stored) {
      const createdAtMs = Date.parse(stored.createdAt);
      data = {
        email: stored.email,
        code: stored.code,
        // An unparseable timestamp expires the code rather than granting it an
        // unbounded lifetime, since NaN fails every comparison below.
        timestamp: Number.isNaN(createdAtMs) ? 0 : createdAtMs,
        attempts: stored.attempts,
      };
      pendingVerifications.set(userId, data);
    }
  }

  if (!data) {
    return interaction.reply({
      content: "I don't see any pending verification for you. Please use the `/verify` command first to request a verification code.",
      flags: MessageFlags.Ephemeral,
    });
  }

  // Expired?
  if (Date.now() - data.timestamp > CODE_EXPIRATION) {
    pendingVerifications.delete(userId);
    await storage.deletePendingCode(userId);
    return interaction.reply({
      content: 'Your verification code has expired. Please use the `/verify` command again to request a new code.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const submittedCode = interaction.options.getString('code')?.toUpperCase();

  // Reject obviously-malformed input before counting it as an attempt.
  // The code we generate is always 8 hex chars; junk would never match
  // anyway, and shouldn't burn one of the 3 real attempts.
  if (!submittedCode || submittedCode.length > 100) {
    return interaction.reply({
      content: 'That code is not in a valid format. Please check the email and try again.',
      flags: MessageFlags.Ephemeral,
    });
  }

  // Too many attempts?
  data.attempts += 1;
  if (data.attempts > 3) {
    pendingVerifications.delete(userId);
    await storage.deletePendingCode(userId);
    return interaction.reply({
      content: "You've made too many incorrect attempts. Please use the `/verify` command again to request a new code.",
      flags: MessageFlags.Ephemeral,
    });
  }

  if (submittedCode !== data.code) {
    // Persist the counter so a restart cannot hand back a fresh set of guesses.
    await storage.updatePendingAttempts(userId, data.attempts);
    const attemptsLeft = 3 - data.attempts;
    return interaction.reply({
      content:
        `That code doesn't match what we sent you. You have ${attemptsLeft} attempt${attemptsLeft !== 1 ? 's' : ''} left.\n\n` +
        'Please double-check and try again, or use `/verify` to request a new code.',
      flags: MessageFlags.Ephemeral,
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
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    console.error('[verifycode] Error verifying user:', error);
    return interaction.reply({
      content: 'There was an error completing your verification. Please contact a server admin.',
      flags: MessageFlags.Ephemeral,
    });
  }
}
