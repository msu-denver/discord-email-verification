/**
 * Discord Email Verification Bot - Command Registration
 *
 * discord.js v14: SlashCommandBuilder, REST, and Routes are now imported
 * directly from the main 'discord.js' package. API version bumped to '10'.
 *
 * Original author: Luke J Farchione | J4eva | 2/25/2025
 * Migrated to discord.js v14 by MSU Denver CyberBridge
 * @license MIT
 */

import { REST, Routes, SlashCommandBuilder } from 'discord.js';
import { SERVER_ID } from '../config.js';

/**
 * Register slash commands with Discord's API.
 * @param {import('discord.js').Client} client
 */
export async function registerCommands(client) {
  const commands = [
    new SlashCommandBuilder()
      .setName('verify')
      .setDescription('Verify your educational email address')
      .addStringOption((option) =>
        option
          .setName('email')
          .setDescription('Your educational email address')
          .setRequired(true)
      )
      .toJSON(),

    new SlashCommandBuilder()
      .setName('verifycode')
      .setDescription('Submit your verification code')
      .addStringOption((option) =>
        option
          .setName('code')
          .setDescription('Your verification code')
          .setRequired(true)
      )
      .toJSON(),

    new SlashCommandBuilder()
      .setName('admin')
      .setDescription('Admin commands for bot management')
      .addSubcommand((sub) =>
        sub
          .setName('checkemail')
          .setDescription('Check email verification history')
          .addStringOption((opt) =>
            opt.setName('email').setDescription('Email address to check').setRequired(true)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName('resetemail')
          .setDescription('Reset an email to allow verification again')
          .addStringOption((opt) =>
            opt.setName('email').setDescription('Email address to reset').setRequired(true)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName('domain-add')
          .setDescription('Add a new allowed email domain')
          .addStringOption((opt) =>
            opt.setName('domain').setDescription('Email domain to add (e.g., msudenver.edu)').setRequired(true)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName('domain-remove')
          .setDescription('Remove an allowed email domain')
          .addStringOption((opt) =>
            opt.setName('domain').setDescription('Email domain to remove').setRequired(true)
          )
      )
      .addSubcommand((sub) =>
        sub.setName('domain-list').setDescription('List all allowed email domains')
      )
      .addSubcommand((sub) =>
        sub.setName('storage-info').setDescription('Show current storage configuration information')
      )
      .toJSON(),
  ];

  try {
    console.log('Started refreshing application (/) commands.');

    const rest = new REST({ version: '10' }).setToken(client.token);
    await rest.put(Routes.applicationGuildCommands(client.user.id, SERVER_ID), {
      body: commands,
    });

    console.log('Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error('Error registering commands:', error);
    throw error;
  }
}
