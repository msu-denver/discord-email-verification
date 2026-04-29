/**
 * Tests for src/emailer.js
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock config
vi.mock('../src/config', () => ({
  SES_FROM_EMAIL: 'bot@test.edu',
  SES_FROM_NAME: 'Test Bot',
  SERVER_NAME: 'TestServer',
  AWS_REGION: 'us-east-1',
  AWS_ENDPOINT_URL: '',
}));

// Capture what gets sent to SES
const mockSend = vi.fn();

// Vitest 4 requires `function` or `class` syntax for mocks used as constructors.
// Arrow functions can't be used with `new`, so we use class declarations here.
vi.mock('@aws-sdk/client-ses', () => ({
  SESClient: vi.fn().mockImplementation(class {
    send = mockSend;
  }),
  SendEmailCommand: vi.fn().mockImplementation(class {
    constructor(params) {
      Object.assign(this, params);
    }
  }),
}));

const { sendVerificationEmail } = await import('../src/emailer.js');

beforeEach(() => {
  mockSend.mockReset();
});

describe('sendVerificationEmail', () => {
  it('returns true on successful send', async () => {
    mockSend.mockResolvedValueOnce({ MessageId: 'abc123' });
    const result = await sendVerificationEmail('student@test.edu', 'ABCD1234');
    expect(result).toBe(true);
  });

  it('passes correct recipient and source', async () => {
    mockSend.mockResolvedValueOnce({});
    await sendVerificationEmail('student@test.edu', 'ABCD1234');

    const command = mockSend.mock.calls[0][0];
    expect(command.Destination.ToAddresses).toEqual(['student@test.edu']);
    expect(command.Source).toBe('Test Bot <bot@test.edu>');
  });

  it('includes the verification code in the email body', async () => {
    mockSend.mockResolvedValueOnce({});
    await sendVerificationEmail('student@test.edu', 'XYZW9999');

    const command = mockSend.mock.calls[0][0];
    expect(command.Message.Body.Html.Data).toContain('XYZW9999');
    expect(command.Message.Body.Text.Data).toContain('XYZW9999');
  });

  it('includes the server name in the subject', async () => {
    mockSend.mockResolvedValueOnce({});
    await sendVerificationEmail('student@test.edu', 'CODE1234');

    const command = mockSend.mock.calls[0][0];
    expect(command.Message.Subject.Data).toContain('TestServer');
  });

  it('returns false when SES throws an error', async () => {
    mockSend.mockRejectedValueOnce(new Error('SES quota exceeded'));
    const result = await sendVerificationEmail('student@test.edu', 'FAIL0000');
    expect(result).toBe(false);
  });

  it('HTML-escapes the verification code in the HTML body', async () => {
    mockSend.mockResolvedValueOnce({});
    // A code with <script>-like chars shouldn't ever occur (we generate hex),
    // but the escape layer is defense-in-depth for future-proofing.
    await sendVerificationEmail('student@test.edu', '<script>x</script>');

    const html = mockSend.mock.calls[0][0].Message.Body.Html.Data;
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
