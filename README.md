# Discord Email Verification Bot

[![CI](https://github.com/msu-denver/discord-email-verification/actions/workflows/ci.yml/badge.svg)](https://github.com/msu-denver/discord-email-verification/actions/workflows/ci.yml)
[![CodeQL](https://github.com/msu-denver/discord-email-verification/actions/workflows/codeql.yml/badge.svg)](https://github.com/msu-denver/discord-email-verification/actions/workflows/codeql.yml)
[![Tests](https://img.shields.io/badge/tests-78%20passing-brightgreen)](./tests)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org/)
[![discord.js](https://img.shields.io/badge/discord.js-v14-5865F2)](https://discord.js.org/)
[![Vitest](https://img.shields.io/badge/tested%20with-vitest%204-6e9f18)](https://vitest.dev/)
[![Deployed](https://img.shields.io/badge/deployed-AWS%20EC2%20%2B%20DynamoDB%20%2B%20SES-orange)](./docs/DEPLOYMENT.md)
[![Security](https://img.shields.io/badge/security-OIDC%20%7C%20least--privilege%20IAM%20%7C%20SSM%20Parameter%20Store-blue)](./docs/SECURITY.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

A Discord bot that verifies members using their educational email addresses. Built for the MSU Denver Computer Science Department Discord server.

**Operational docs:** [SECURITY.md](./docs/SECURITY.md) (threat model + audit checklist) · [DEPLOYMENT.md](./docs/DEPLOYMENT.md) (runbook).

## How It Works

1. A new member joins the Discord server and is automatically assigned a **quarantine role** (limited access)
2. The member uses `/verify email:student@msudenver.edu` to request a verification code
3. The bot validates the email domain and sends a code via **Amazon SES**
4. The member uses `/verifycode code:ABC12345` to submit the code
5. On success, the quarantine role is removed and a **verified role** is added

## Commands

| Command | Description |
|---------|-------------|
| `/verify email:<address>` | Request a verification code |
| `/verifycode code:<code>` | Submit your verification code |
| `/admin domain-add <domain>` | Add an allowed email domain |
| `/admin domain-remove <domain>` | Remove an allowed email domain |
| `/admin domain-list` | List allowed email domains |
| `/admin checkemail <email>` | Check verification history for an email |
| `/admin resetemail <email>` | Reset an email's verification count |
| `/admin storage-info` | Display storage configuration |

## Prerequisites

- **Node.js** 20+ (22 recommended)
- **Docker** (for local email testing with LocalStack)
- **AWS Account** with SES and DynamoDB access (production only)
- **Discord Bot Application** created in the [Developer Portal](https://discord.com/developers/applications)

## Quick Start (Local Development)

```bash
# Clone the repo
git clone https://github.com/msu-denver/discord-email-verification.git
cd discord-email-verification

# Install dependencies
npm install

# Copy and configure environment variables
cp .env.example .env
# Edit .env with your Discord and AWS credentials

# For local development, set these in .env:
#   USE_LOCAL_STORAGE=true       (uses local JSON files instead of DynamoDB)
#   AWS_ENDPOINT_URL=http://localhost:4566  (routes SES to LocalStack)

# Run the bot
npm start

# Run tests
npm test

# Run tests with coverage
npm run test:coverage
```

### Local Email Testing with LocalStack

To test email sending locally without a real AWS account, we use [LocalStack](https://localstack.cloud/) to simulate Amazon SES. This requires [Docker](https://www.docker.com/).

```bash
# Start the LocalStack container (simulates SES on localhost:4566)
docker compose up -d

# The seed script automatically verifies email identities for local dev.
# You can verify it's working:
docker exec verification-bot-localstack awslocal ses list-identities

# Make sure your .env has:
#   AWS_ENDPOINT_URL=http://localhost:4566
#   SES_FROM_EMAIL=verification@msudenver.edu

# Start the bot
npm start

# After a user runs /verify, inspect the captured email:
docker exec verification-bot-localstack ls /var/lib/localstack/state/ses/
docker exec verification-bot-localstack cat /var/lib/localstack/state/ses/<email-id>.json

# Stop LocalStack when done
docker compose down
```

LocalStack captures all sent emails as JSON files, so you can verify email content, formatting, and delivery without sending real emails.

## Environment Variables

See `.env.example` for a fully documented list. Key variables:

| Variable | Description |
|----------|-------------|
| `DISCORD_BOT_TOKEN` | Bot token from Discord Developer Portal |
| `SERVER_ID` | Your Discord server (guild) ID |
| `QUARANTINE_ROLE_ID` | Role assigned to unverified members |
| `VERIFIED_ROLE_ID` | Role assigned after email verification |
| `ADMIN_ROLE_ID` | Role required for admin commands |
| `SES_FROM_EMAIL` | Verified sender email in Amazon SES |
| `USE_LOCAL_STORAGE` | `true` for local file storage, `false` for DynamoDB |
| `AWS_ENDPOINT_URL` | LocalStack endpoint for local dev (e.g., `http://localhost:4566`) |

## Architecture

```
src/
  index.js          Entry point — initializes storage, events, and login
  config.js         Centralized configuration from environment variables
  emailer.js        Amazon SES email delivery
  storage.js        DynamoDB + LocalStorage backends (strategy pattern)
  events.js         Discord event handlers (ready, memberJoin, interactions)
  utils.js          Utility functions (code generation, validation)
  commands/
    index.js        Slash command registration with Discord API
    verify.js       /verify and /verifycode handlers
    admin.js        /admin subcommand handlers
```

```
infrastructure/
  template.yaml     CloudFormation template for AWS deployment
scripts/
  localstack/
    seed_ses.sh     Auto-seeds SES email identities for local dev
docker-compose.yml  LocalStack container for local SES simulation
```

### Storage Backends

- **DynamoDB** (production): Single-table design with PK/SK pattern. Pay-per-request billing.
- **Local files** (development): JSON files in a `data/` directory. Set `USE_LOCAL_STORAGE=true`.

## AWS Deployment

### Using CloudFormation

The `infrastructure/template.yaml` CloudFormation template creates everything needed:

- DynamoDB table
- SES email identity
- EC2 instance (t3.micro) with PM2
- IAM role with least-privilege permissions
- Security group (SSH only)
- SSM Parameter Store for the bot token

```bash
aws cloudformation deploy \
  --template-file infrastructure/template.yaml \
  --stack-name discord-verification-bot \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    KeyPairName=your-key-pair \
    SESFromEmail=verification@yourdomain.edu \
    DiscordBotToken=your-bot-token \
    ServerID=your-server-id \
    QuarantineRoleID=your-role-id \
    VerifiedRoleID=your-role-id \
    AdminRoleID=your-role-id \
    VerificationChannelID=your-channel-id \
    WelcomeChannelID=your-channel-id
```

### SES Sandbox

New AWS accounts start in the SES **sandbox**, which only allows sending to verified email addresses. For testing, verify your test recipient emails. For production, [request production access](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html).

## Discord Bot Setup

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application** and name it
3. Go to **Bot** tab > enable **Server Members Intent** and **Message Content Intent**
4. Copy the bot **token** for your `.env`
5. Go to **OAuth2 > URL Generator**
6. Select scopes: `bot`, `applications.commands`
7. Select permissions: `Manage Roles`, `Send Messages`, `Read Message History`
8. Open the generated URL to invite the bot to your server

### Bot Role Hierarchy

The bot's role must be **above** the Quarantine and Verified roles in your server's role list. Otherwise it will get a "Missing Permissions" error when trying to add/remove roles. Go to Server Settings > Roles and drag the bot's role above the roles it needs to manage.

### Getting Discord IDs

Enable **Developer Mode** in Discord (User Settings > Advanced > Developer Mode), then right-click any role, channel, or server to copy its ID.

## Testing

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
npm run test:coverage # Coverage report (target: 80%+)
```

## Security Features

- 30-minute code expiration
- Maximum 3 attempts per code
- Maximum 2 verifications per email address
- 5-minute throttle between code requests
- Email domain whitelist enforcement
- Admin role required for management commands

## Contributing

We welcome contributions. Start with [`.github/CONTRIBUTING.md`](./.github/CONTRIBUTING.md) for the development setup and PR flow, and our [Code of Conduct](./.github/CODE_OF_CONDUCT.md). For vulnerability reports, see [`.github/SECURITY.md`](./.github/SECURITY.md) — please do not open public issues for security bugs.

## Credits

- **Original bot**: Luke J Farchione (2025)
- **Migration & enhancements**: MSU Denver CS Department (2026)

## License

[MIT](./LICENSE), with dual copyright (Luke J Farchione 2025 + Metropolitan State University of Denver 2026).
