#!/usr/bin/env bash
# scripts/aws/seed-ssm-parameters.sh
#
# Push the bot's runtime configuration from local .env into AWS SSM
# Parameter Store under /discord-bot/<environment>/<KEY>.
#
# DISCORD_BOT_TOKEN is stored as SecureString (encrypted at rest with the
# AWS-managed KMS key for SSM). Everything else is stored as String.
#
# Why SSM (not CloudFormation parameters):
#   CF parameters appear in stack events, drift reports, and CloudTrail.
#   SSM SecureString values are encrypted at rest, audit-logged separately,
#   and gated by their own IAM permissions. The deploy role (GHA) will NOT
#   have ssm:GetParameter — only the EC2 instance role does — so a CI
#   compromise can't leak the bot token.
#
# Usage:
#   ./scripts/aws/seed-ssm-parameters.sh <environment> [--overwrite]
#
# Examples:
#   ./scripts/aws/seed-ssm-parameters.sh production
#   ./scripts/aws/seed-ssm-parameters.sh production --overwrite
#
# Run from the repo root (so .env is found).
#
# Env overrides:
#   AWS_PROFILE - default: cyberbridge
#   AWS_REGION  - default: us-east-1

set -euo pipefail

ENV_NAME="${1:-}"
OVERWRITE_FLAG=""
[[ "${2:-}" == "--overwrite" ]] && OVERWRITE_FLAG="--overwrite"

PROFILE="${AWS_PROFILE:-cyberbridge}"
REGION="${AWS_REGION:-us-east-1}"

if [[ -z "$ENV_NAME" ]]; then
  cat <<USAGE
Usage: $0 <environment> [--overwrite]

Reads .env (in current directory) and pushes each known key to SSM Parameter
Store under /discord-bot/<environment>/<KEY>.

DISCORD_BOT_TOKEN is stored as SecureString (encrypted at rest).
Everything else is stored as String.

Pass --overwrite to update existing parameters.

Examples:
  $0 production
  $0 production --overwrite

Env overrides:
  AWS_PROFILE (default: cyberbridge)
  AWS_REGION  (default: us-east-1)
USAGE
  exit 1
fi

if [[ ! -f .env ]]; then
  echo "ERROR: .env not found in current directory ($(pwd))" >&2
  echo "Run this script from the repo root." >&2
  exit 1
fi

# Whitelist of keys to push to SSM. Any other keys in .env (USE_LOCAL_STORAGE,
# AWS_ENDPOINT_URL, etc.) are dev-only and are ignored on purpose.
KEYS_TO_SEED=(
  DISCORD_BOT_TOKEN
  SERVER_ID
  QUARANTINE_ROLE_ID
  VERIFIED_ROLE_ID
  ADMIN_ROLE_ID
  VERIFICATION_CHANNEL_ID
  WELCOME_CHANNEL_ID
  SERVER_NAME
  SES_FROM_EMAIL
  SES_FROM_NAME
)

# Read a key's value from .env literally. Does NOT source the file (which
# would execute any shell metacharacters embedded in values). Strips optional
# surrounding double or single quotes.
get_env_value() {
  local key="$1"
  grep -E "^${key}=" .env | head -1 \
    | sed -E -e "s/^${key}=//" -e 's/^"(.*)"$/\1/' -e "s/^'(.*)'$/\1/"
}

ssm_type_for_key() {
  case "$1" in
    DISCORD_BOT_TOKEN) echo "SecureString" ;;
    *)                 echo "String"       ;;
  esac
}

echo "Seeding SSM parameters for environment: $ENV_NAME"
echo "Path prefix: /discord-bot/$ENV_NAME/"
echo "Profile:     $PROFILE"
echo "Region:      $REGION"
[[ -n "$OVERWRITE_FLAG" ]] && echo "Mode:        --overwrite (existing values will be replaced)"
echo ""

seeded=0
skipped=0
failed=0

for key in "${KEYS_TO_SEED[@]}"; do
  value=$(get_env_value "$key")

  if [[ -z "$value" ]]; then
    echo "  SKIP  $key (not found or empty in .env)"
    skipped=$((skipped + 1))
    continue
  fi

  param_path="/discord-bot/$ENV_NAME/$key"
  param_type=$(ssm_type_for_key "$key")

  if aws ssm put-parameter \
       --name "$param_path" \
       --type "$param_type" \
       --value "$value" \
       $OVERWRITE_FLAG \
       --profile "$PROFILE" \
       --region "$REGION" \
       --output text >/dev/null 2>&1; then
    echo "  OK    $key  ($param_type)"
    seeded=$((seeded + 1))
  else
    echo "  FAIL  $key  ($param_type) — already exists? Re-run with --overwrite to update."
    failed=$((failed + 1))
  fi
done

echo ""
echo "Seeded: $seeded   Skipped: $skipped   Failed: $failed"
echo ""
echo "Verify with:"
echo "  aws ssm get-parameters-by-path --path '/discord-bot/$ENV_NAME/' \\"
echo "    --recursive --query 'Parameters[].Name' --profile $PROFILE --region $REGION"

if [[ "$failed" -gt 0 ]]; then
  exit 1
fi
