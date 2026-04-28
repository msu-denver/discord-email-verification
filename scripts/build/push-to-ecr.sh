#!/usr/bin/env bash
# scripts/build/push-to-ecr.sh
#
# Build Dockerfile.ecs and push to ECR with two tags:
#   - main-<short-sha>  immutable rollback target
#   - latest            mutable, "what's currently running"
#
# Both tags point at the same image. Pushing both lets us:
#   - Roll back to a known-good revision: docker pull <repo>:main-abc1234
#   - Deploy the newest image: docker pull <repo>:latest
#
# Required env:
#   ECR_REPOSITORY_URI  — full ECR URI, e.g.
#                         123456789012.dkr.ecr.us-east-1.amazonaws.com/foo/bar
#   GIT_SHA             — full or short git SHA. In GitHub Actions, this
#                         is github.sha. Locally we read it from `git rev-parse`.
#
# Optional env:
#   DOCKERFILE          — path to Dockerfile (default: Dockerfile.ecs)
#   PLATFORM            — target platform (default: linux/amd64; EC2 instances
#                         we use are x86_64)
#
# Run from the repo root (so the build context is correct).

set -euo pipefail

ECR_URI="${ECR_REPOSITORY_URI:-}"
DOCKERFILE="${DOCKERFILE:-Dockerfile.ecs}"
PLATFORM="${PLATFORM:-linux/amd64}"

if [[ -z "$ECR_URI" ]]; then
  echo "ERROR: ECR_REPOSITORY_URI is not set" >&2
  exit 1
fi

# Resolve git SHA. In GitHub Actions, $GITHUB_SHA is already set.
# Locally, fall back to `git rev-parse HEAD`.
GIT_SHA="${GIT_SHA:-${GITHUB_SHA:-$(git rev-parse HEAD)}}"
SHORT_SHA="${GIT_SHA:0:7}"
SHA_TAG="main-${SHORT_SHA}"

if [[ ! -f "$DOCKERFILE" ]]; then
  echo "ERROR: $DOCKERFILE not found in $(pwd)" >&2
  exit 1
fi

echo "Building image..."
echo "  Dockerfile: $DOCKERFILE"
echo "  Platform:   $PLATFORM"
echo "  Tags:       $SHA_TAG, latest"
echo "  Repository: $ECR_URI"
echo ""

# --provenance=false suppresses the buildx attestation manifest. Without it
# Docker pushes a manifest list with both the image and the attestation,
# which confuses ECR's image scanning and adds an extra "untagged" image
# to the repo every push.
docker buildx build \
  --platform "$PLATFORM" \
  --file "$DOCKERFILE" \
  --tag "${ECR_URI}:${SHA_TAG}" \
  --tag "${ECR_URI}:latest" \
  --provenance=false \
  --push \
  .

echo ""
echo "Pushed:"
echo "  ${ECR_URI}:${SHA_TAG}"
echo "  ${ECR_URI}:latest"
