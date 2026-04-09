/**
 * Discord Email Verification Bot - Admin Command Handlers
 *
 * Original author: Luke J Farchione | J4eva | 2/25/2025
 * Migrated by MSU Denver CyberBridge
 * @license MIT
 */

import { hasAdminRole } from '../utils.js';
import storage from '../storage.js';
import { MAX_VERIFICATIONS_PER_EMAIL } from '../config.js';

/**
 * Handle all /admin subcommands.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function handleAdminCommand(interaction) {
  if (!hasAdminRole(interaction.member)) {
    return interaction.reply({
      content: 'Sorry, only server administrators can use these commands.',
      ephemeral: true,
    });
  }

  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case 'storage-info':
      return handleStorageInfo(interaction);
    case 'domain-add':
      return handleDomainAdd(interaction);
    case 'domain-remove':
      return handleDomainRemove(interaction);
    case 'domain-list':
      return handleDomainList(interaction);
    case 'checkemail':
      return handleCheckEmail(interaction);
    case 'resetemail':
      return handleResetEmail(interaction);
    default:
      return interaction.reply({
        content: `Unknown subcommand: ${subcommand}`,
        ephemeral: true,
      });
  }
}

async function handleStorageInfo(interaction) {
  const info = storage.getStorageInfo();
  let message = '**Storage Configuration**\n\n';
  message += `- Domains: **${info.domains}**\n`;
  message += `- Pending Codes: **${info.pendingCodes}**\n`;
  message += `- Used Codes: **${info.usedCodes}**\n`;

  if (info.tableName) {
    message += `\n**DynamoDB Table:** \`${info.tableName}\`\n`;
  }
  if (info.localDomainsPath) {
    message += '\n**Local Storage Paths:**\n';
    message += `- Domains: \`${info.localDomainsPath}\`\n`;
    message += `- Pending Codes: \`${info.localCodesDir}\`\n`;
    message += `- Used Codes: \`${info.localUsedCodesDir}\`\n`;
  }

  return interaction.reply({ content: message, ephemeral: true });
}

async function handleDomainAdd(interaction) {
  const domain = interaction.options.getString('domain')?.toLowerCase().trim();
  if (!domain) {
    return interaction.reply({ content: 'Please provide a valid domain name (e.g., msudenver.edu).', ephemeral: true });
  }

  if (!domain.includes('.') || domain.startsWith('.') || domain.endsWith('.')) {
    return interaction.reply({ content: 'Invalid domain format. Please provide a valid domain like "msudenver.edu".', ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  const allowedDomains = storage.getAllowedDomains();
  if (allowedDomains.includes(domain)) {
    return interaction.editReply({ content: `The domain "${domain}" is already in the allowed list.` });
  }

  const newDomains = [...allowedDomains, domain];
  const success = await storage.saveAllowedDomains(newDomains);

  if (success) {
    return interaction.editReply({ content: `Successfully added "${domain}" to the allowed domains list.` });
  }
  return interaction.editReply({ content: 'Error adding domain. Please try again or check the logs.' });
}

async function handleDomainRemove(interaction) {
  const domain = interaction.options.getString('domain')?.toLowerCase().trim();
  if (!domain) {
    return interaction.reply({ content: 'Please provide a domain to remove.', ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  const allowedDomains = storage.getAllowedDomains();
  if (!allowedDomains.includes(domain)) {
    return interaction.editReply({ content: `The domain "${domain}" is not in the allowed list.` });
  }

  if (allowedDomains.length === 1) {
    return interaction.editReply({ content: 'Cannot remove the last domain. Add another domain first.' });
  }

  const newDomains = allowedDomains.filter((d) => d !== domain);
  const success = await storage.saveAllowedDomains(newDomains);

  if (success) {
    return interaction.editReply({ content: `Successfully removed "${domain}" from the allowed domains list.` });
  }
  return interaction.editReply({ content: 'Error removing domain. Please try again or check the logs.' });
}

async function handleDomainList(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const allowedDomains = storage.getAllowedDomains();
  if (allowedDomains.length === 0) {
    return interaction.editReply({ content: 'No domains are currently allowed. Please add at least one domain.' });
  }

  const domainList = allowedDomains.map((d) => `- ${d}`).join('\n');
  return interaction.editReply({ content: `**Currently Allowed Email Domains:**\n${domainList}` });
}

async function handleCheckEmail(interaction) {
  const email = interaction.options.getString('email')?.toLowerCase().trim();
  if (!email) {
    return interaction.reply({ content: 'Please provide an email address to check.', ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  const verifiedCount = await storage.getEmailVerificationCount(email);

  let reply = `**Email:** ${email}\n`;
  reply += `**Total Verifications:** ${verifiedCount}/${MAX_VERIFICATIONS_PER_EMAIL}\n`;
  reply += `**Storage Method:** ${storage.getStorageInfo().usedCodes}\n`;

  const domain = email.split('@')[1]?.toLowerCase();
  if (domain) {
    const isAllowed = storage.isAllowedDomain(email);
    reply += `**Domain Status:** ${isAllowed ? 'Allowed' : 'Not Allowed'}\n`;
  }

  if (verifiedCount >= MAX_VERIFICATIONS_PER_EMAIL) {
    reply += '\nThis email has reached its maximum verification limit.';
  }

  return interaction.editReply({ content: reply });
}

async function handleResetEmail(interaction) {
  const email = interaction.options.getString('email')?.toLowerCase().trim();
  if (!email) {
    return interaction.reply({ content: 'Please provide an email address to reset.', ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });
  const result = await storage.resetEmail(email);

  if (result.success) {
    return interaction.editReply({
      content: `Successfully reset verification for ${email}! Deleted ${result.deletedCount} record(s). This email can now be used for verification again.`,
    });
  }
  return interaction.editReply({
    content: `Unable to reset ${email}: ${result.reason || 'Unknown error'}`,
  });
}
