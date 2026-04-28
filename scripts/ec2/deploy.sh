#!/usr/bin/env bash
# scripts/ec2/deploy.sh
#
# Deploy script that runs ON the EC2 instance.
#
# - First boot: invoked by cloud-init UserData with no arg (defaults to :latest).
# - Subsequent deploys: invoked by SSM RunCommand from CI with an image tag arg.
#
# Steps:
#   1. Read all SSM parameters under /discord-bot/<env>/* into /etc/discord-bot.env
#      (decrypts SecureString values using the EC2 instance role).
#   2. ECR login.
#   3. docker pull the requested tag.
#   4. Stop and remove any existing container.
#   5. docker run the new image with --env-file, --restart=unless-stopped,
#      --log-driver=awslogs.
#
# This script is generated and installed at /usr/local/bin/deploy.sh by the
# CloudFormation UserData. Keeping a copy here in source control for review
# and historical diffing.
#
# Required env at script-execution time:
#   AWS_REGION                  e.g. us-east-1
#   ECR_REPOSITORY_URI          e.g. 1234.dkr.ecr.us-east-1.amazonaws.com/foo/bar
#   SSM_PARAMETER_PATH_PREFIX   e.g. /discord-bot/production
#   CLOUDWATCH_LOG_GROUP        e.g. /aws/ec2/discord-bot
#   CONTAINER_NAME              e.g. discord-bot
#
# Usage:
#   /usr/local/bin/deploy.sh                # deploy :latest
#   /usr/local/bin/deploy.sh main-abc1234   # deploy a specific image tag

set -euo pipefail

IMAGE_TAG="${1:-latest}"

: "${AWS_REGION:?must be set}"
: "${ECR_REPOSITORY_URI:?must be set}"
: "${SSM_PARAMETER_PATH_PREFIX:?must be set}"
: "${CLOUDWATCH_LOG_GROUP:?must be set}"
: "${CONTAINER_NAME:?must be set}"

ENV_FILE=/etc/discord-bot.env

echo "==> Deploying image tag: $IMAGE_TAG"
echo "==> ECR repo:           $ECR_REPOSITORY_URI"
echo "==> SSM prefix:         $SSM_PARAMETER_PATH_PREFIX"
echo ""

# ---------------------------------------------------------------------------
# Step 1: Fetch SSM parameters into /etc/discord-bot.env
#
# get-parameters-by-path with --with-decryption returns plaintext for
# SecureString values. The instance role grants ssm:GetParameters
# (scoped to this prefix) and kms:Decrypt (scoped to the alias used
# by SSM's default key).
#
# Output format: KEY=value, one per line, no surrounding quotes (so docker's
# --env-file parses correctly).
# ---------------------------------------------------------------------------
echo "==> Fetching SSM parameters..."
TMP_ENV=$(mktemp)
trap 'rm -f "$TMP_ENV"' EXIT

aws ssm get-parameters-by-path \
  --path "$SSM_PARAMETER_PATH_PREFIX" \
  --recursive \
  --with-decryption \
  --region "$AWS_REGION" \
  --query 'Parameters[].[Name,Value]' \
  --output text \
  | while IFS=$'\t' read -r name value; do
      key="${name##*/}"
      printf '%s=%s\n' "$key" "$value"
    done > "$TMP_ENV"

# Atomically install the new env file (so a partial fetch can never leave
# /etc/discord-bot.env in a broken state).
chmod 600 "$TMP_ENV"
chown root:root "$TMP_ENV"
mv "$TMP_ENV" "$ENV_FILE"
trap - EXIT

PARAM_COUNT=$(wc -l < "$ENV_FILE")
echo "    Wrote $PARAM_COUNT parameters to $ENV_FILE"

# ---------------------------------------------------------------------------
# Step 2: ECR login
# ---------------------------------------------------------------------------
ECR_REGISTRY="${ECR_REPOSITORY_URI%%/*}"
echo "==> Logging into ECR ($ECR_REGISTRY)..."
aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$ECR_REGISTRY"

# ---------------------------------------------------------------------------
# Step 3: Pull the requested image tag
# ---------------------------------------------------------------------------
echo "==> Pulling ${ECR_REPOSITORY_URI}:${IMAGE_TAG}..."
docker pull "${ECR_REPOSITORY_URI}:${IMAGE_TAG}"

# ---------------------------------------------------------------------------
# Step 4: Stop and remove any existing container
# ---------------------------------------------------------------------------
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo "==> Stopping existing container..."
  docker stop "$CONTAINER_NAME" || true
  docker rm "$CONTAINER_NAME" || true
fi

# ---------------------------------------------------------------------------
# Step 5: Run the new container
#
# - --restart=unless-stopped: survives crashes and host reboots, but respects
#   intentional `docker stop`.
# - --log-driver=awslogs: stdout/stderr go to CloudWatch.
# - --env-file: loads the SSM-derived config.
# - No port mappings — the bot only opens outbound WebSocket to Discord.
# - --read-only: the container's root filesystem is read-only. We give it a
#   small tmpfs for /tmp in case any library writes there.
# ---------------------------------------------------------------------------
echo "==> Starting container..."
docker run -d \
  --name "$CONTAINER_NAME" \
  --restart unless-stopped \
  --env-file "$ENV_FILE" \
  --log-driver awslogs \
  --log-opt "awslogs-region=$AWS_REGION" \
  --log-opt "awslogs-group=$CLOUDWATCH_LOG_GROUP" \
  --log-opt "awslogs-stream=$(hostname)" \
  --log-opt "awslogs-create-group=false" \
  --read-only \
  --tmpfs /tmp:size=64M \
  "${ECR_REPOSITORY_URI}:${IMAGE_TAG}"

echo ""
echo "==> Deploy complete. Container status:"
docker ps --filter "name=^${CONTAINER_NAME}$" --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'
