#!/usr/bin/env bash
# scripts/build/deploy-to-ec2.sh
#
# Trigger a deploy on the bot's EC2 instance via SSM Run Command.
# Calls /usr/local/bin/deploy.sh on the instance with the new image tag.
#
# Used by GitHub Actions on push to main (after the build-and-push step
# has uploaded a fresh image to ECR with tag main-<short-sha> + latest).
#
# Required env:
#   AWS_REGION       — region of the EC2 instance
#   EC2_INSTANCE_ID  — the target instance ID (set as a GitHub repo variable)
#   IMAGE_TAG        — tag to deploy, e.g. main-abc1234
#
# This script does NOT exit successfully until the on-instance deploy
# succeeds, so the CI step's pass/fail accurately reflects the deploy.

set -euo pipefail

: "${AWS_REGION:?must be set}"
: "${EC2_INSTANCE_ID:?must be set}"
: "${IMAGE_TAG:?must be set}"

echo "==> Sending deploy command to $EC2_INSTANCE_ID"
echo "    Image tag: $IMAGE_TAG"

# Send the deploy command. The shell is sourced via /etc/discord-bot.envrc
# (written by UserData) so deploy.sh has the env vars it needs.
COMMAND_ID=$(aws ssm send-command \
  --instance-ids "$EC2_INSTANCE_ID" \
  --document-name AWS-RunShellScript \
  --comment "GitHub Actions deploy of $IMAGE_TAG" \
  --parameters "commands=['set -a && . /etc/discord-bot.envrc && set +a && /usr/local/bin/deploy.sh $IMAGE_TAG 2>&1']" \
  --region "$AWS_REGION" \
  --query 'Command.CommandId' \
  --output text)

echo "    Command ID: $COMMAND_ID"
echo ""
echo "==> Polling for completion..."

# Wait until the command transitions out of pending/in-progress.
# Sleep 5 between polls.
while true; do
  STATUS=$(aws ssm get-command-invocation \
    --command-id "$COMMAND_ID" \
    --instance-id "$EC2_INSTANCE_ID" \
    --region "$AWS_REGION" \
    --query 'Status' \
    --output text 2>/dev/null || echo "Pending")

  case "$STATUS" in
    Success)
      echo "    Status: SUCCESS"
      break
      ;;
    Failed|Cancelled|TimedOut)
      echo "    Status: $STATUS"
      echo ""
      echo "==> Deploy failed. Last output:"
      aws ssm get-command-invocation \
        --command-id "$COMMAND_ID" \
        --instance-id "$EC2_INSTANCE_ID" \
        --region "$AWS_REGION" \
        --query 'StandardErrorContent' \
        --output text
      echo ""
      echo "==> Stdout:"
      aws ssm get-command-invocation \
        --command-id "$COMMAND_ID" \
        --instance-id "$EC2_INSTANCE_ID" \
        --region "$AWS_REGION" \
        --query 'StandardOutputContent' \
        --output text
      exit 1
      ;;
    Pending|InProgress|Delayed)
      echo "    Status: $STATUS (still running...)"
      sleep 5
      ;;
    *)
      echo "    Unknown status: $STATUS — continuing to poll"
      sleep 5
      ;;
  esac
done

# Print the deploy log for the CI run record.
echo ""
echo "==> Deploy log from instance:"
aws ssm get-command-invocation \
  --command-id "$COMMAND_ID" \
  --instance-id "$EC2_INSTANCE_ID" \
  --region "$AWS_REGION" \
  --query 'StandardOutputContent' \
  --output text

echo ""
echo "==> Deploy complete: $IMAGE_TAG is now running on $EC2_INSTANCE_ID"
