# CLAUDE.md

This file provides context for AI assistants working on this codebase.

## Project Overview

Discord email verification bot for the MSU Denver CS Department. Members join the server, get a quarantine role, verify their educational email via a code sent through Amazon SES, and receive a verified role. Built with discord.js v14 and deployed on AWS.

## Tech Stack

- **Runtime**: Node.js 22, ES modules (`"type": "module"` in package.json)
- **Discord**: discord.js v14 (slash commands, GatewayIntentBits, Partials)
- **Email**: Amazon SES via `@aws-sdk/client-ses`
- **Storage**: DynamoDB via `@aws-sdk/lib-dynamodb` (production) or local JSON files (development)
- **Testing**: Vitest with `@vitest/coverage-v8`
- **Local dev**: LocalStack via Docker Compose for SES simulation
- **Infrastructure**: AWS CloudFormation (`infrastructure/template.yaml`)

## Project Structure

```
src/
  index.js            Entry point
  config.js           All env vars centralized here
  emailer.js          SES email sending (supports LocalStack endpoint override)
  storage.js          DynamoDB + LocalStorage backends (strategy pattern)
  events.js           Discord event handlers
  utils.js            Code generation, validation, formatting helpers
  commands/
    index.js          Slash command registration
    verify.js         /verify and /verifycode handlers
    admin.js          /admin subcommand handlers
tests/                Mirrors src/ structure
infrastructure/       CloudFormation template
scripts/localstack/   SES seed script for local dev
```

## Common Commands

```bash
npm start             # Run the bot
npm test              # Run tests (vitest)
npm run test:coverage # Run tests with coverage report
docker compose up -d  # Start LocalStack for local SES
docker compose down   # Stop LocalStack
```

## Key Patterns

- **ESM throughout**: All source files use `import`/`export`. The `@aws-sdk/lib-dynamodb` package is CJS, so storage.js uses `import pkg from '...'` + destructuring.
- **Storage strategy pattern**: `storage.js` exports a singleton created by `createStorage()` which checks `USE_LOCAL_STORAGE`. Both `DynamoDBStorage` and `LocalStorage` implement the same 9-method interface.
- **Config centralization**: All environment variables are read in `config.js` and exported as named constants. No other file reads `process.env`.
- **Pending verifications are in-memory**: The `pendingVerifications` Map in `verify.js` lives in process memory. If the bot restarts, users just request a new code.
- **LocalStack support**: When `AWS_ENDPOINT_URL` is set, the SES client routes to LocalStack with test credentials. Emails are captured as JSON files in the container at `/var/lib/localstack/state/ses/`.

## Testing

Tests use Vitest with `vi.mock()` for module mocking. Key patterns:
- Mock paths must include `.js` extensions (ESM resolution)
- Storage mock needs `{ default: mockStorage }` since it uses `export default`
- `await import('...')` is used for modules under test to ensure mocks are applied before loading
- Storage tests use real filesystem I/O against temp directories (not mocks)

## Environment

Configuration is via `.env` file (see `.env.example`). Key settings for local development:
- `USE_LOCAL_STORAGE=true` — bypasses DynamoDB, uses `data/` directory
- `AWS_ENDPOINT_URL=http://localhost:4566` — routes SES to LocalStack

## Discord Bot Requirements

- **Intents**: GuildMembers, GuildMessages, Guilds
- **Permissions**: Manage Roles, Send Messages, Read Message History
- **Role hierarchy**: Bot role must be above Quarantine and Verified roles in the server's role list
