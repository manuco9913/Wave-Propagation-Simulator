#!/bin/bash
# Builds the local container image afk.sh runs in. No Docker Hub push needed.
set -eo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

SCRIPT_DIR="$(dirname "${BASH_SOURCE[0]}")"

if [ ! -f "$REPO_ROOT/.env" ]; then
  echo "Missing .env with GH_TOKEN and CLAUDE_CODE_OAUTH_TOKEN."
  exit 1
fi

echo "Building $IMAGE..."
docker build -t "$IMAGE" "$SCRIPT_DIR"

echo ""
echo "Checking the container can reach GitHub..."
run_in_container gh auth status