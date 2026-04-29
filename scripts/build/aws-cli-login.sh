#!/usr/bin/env bash
# scripts/build/aws-cli-login.sh
#
# Log Docker into the ECR registry for the bot's account/region using a
# short-lived token from `aws ecr get-login-password`.
#
# Works in two contexts:
#   1. Locally — set AWS_PROFILE to your credentials profile (or rely on the
#      default profile / credentials chain).
#   2. In GitHub Actions — uses the credentials previously set by
#      aws-actions/configure-aws-credentials (OIDC flow).
#
# Required env (or args):
#   AWS_REGION          — AWS region of the ECR repo (default: us-east-1)
#   ECR_REPOSITORY_URI  — full ECR URI, e.g.
#                         123456789012.dkr.ecr.us-east-1.amazonaws.com/foo/bar
#                         (only the registry part — the host before the first
#                         slash — is used here.)

set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
ECR_URI="${ECR_REPOSITORY_URI:-}"

if [[ -z "$ECR_URI" ]]; then
  echo "ERROR: ECR_REPOSITORY_URI is not set" >&2
  echo "Expected format: <account>.dkr.ecr.<region>.amazonaws.com/<repo>" >&2
  exit 1
fi

# The login command needs only the registry host, not the full repo URI.
ECR_REGISTRY="${ECR_URI%%/*}"

# In GitHub Actions, AWS creds are already configured by the previous step.
# Locally, we pass --profile to aws CLI. AWS_PROFILE env var is honored
# automatically, so we don't need to special-case here.
echo "Logging Docker into $ECR_REGISTRY..."
aws ecr get-login-password --region "$REGION" \
  | docker login --username AWS --password-stdin "$ECR_REGISTRY"

echo "Logged in."
