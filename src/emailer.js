/**
 * Discord Email Verification Bot - Email Functionality (Amazon SES)
 *
 * Replaces the original SendGrid implementation with AWS SES.
 * The interface remains identical: sendVerificationEmail(email, code) → boolean
 *
 * Original author: Luke J Farchione | J4eva | 2/25/2025
 * Migrated to AWS SES by MSU Denver CyberBridge
 * @license MIT
 */

import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { SES_FROM_EMAIL, SES_FROM_NAME, SERVER_NAME, AWS_REGION } from './config.js';

// Create SES client — uses credentials from the environment / instance profile
const sesClient = new SESClient({ region: AWS_REGION });

/**
 * Send a verification email via Amazon SES.
 * @param {string} email - Recipient email address
 * @param {string} code  - Verification code
 * @returns {Promise<boolean>} True if the email was sent successfully
 */
export async function sendVerificationEmail(email, code) {
  console.log(`[sendVerificationEmail] Sending code ${code} to ${email}`);

  const subject = `Your ${SERVER_NAME} Discord Verification Code`;

  const text = [
    `Your verification code is: ${code}`,
    '',
    'This code will expire in 30 minutes.',
    '',
    "If you didn't request this code, please ignore this email.",
  ].join('\n');

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #00447c;">${SERVER_NAME} Discord Verification</h2>
      <p>Hi there! Thanks for joining our ${SERVER_NAME} Discord community!</p>
      <p>Your verification code is:</p>
      <div style="font-size: 24px; font-weight: bold; background-color: #f5f5f5; padding: 10px; margin: 15px 0; border-radius: 4px; text-align: center;">
        ${code}
      </div>
      <p>This code will expire in 30 minutes.</p>
      <p>Simply return to Discord and use the <strong>/verifycode</strong> command with this code to get full access to the server.</p>
      <p>If you didn't request this code, please ignore this email.</p>
      <p style="color: #777; font-size: 12px; margin-top: 20px;">
        This is an automated message from ${SERVER_NAME}.
        Please check your spam folder if you don't see this email in your inbox.
      </p>
    </div>
  `;

  const params = {
    Source: `${SES_FROM_NAME} <${SES_FROM_EMAIL}>`,
    Destination: {
      ToAddresses: [email],
    },
    Message: {
      Subject: { Data: subject, Charset: 'UTF-8' },
      Body: {
        Text: { Data: text, Charset: 'UTF-8' },
        Html: { Data: html, Charset: 'UTF-8' },
      },
    },
  };

  try {
    await sesClient.send(new SendEmailCommand(params));
    console.log(`[sendVerificationEmail] Email sent to ${email}`);
    return true;
  } catch (error) {
    console.error('[sendVerificationEmail] Error:', error.message);
    return false;
  }
}
