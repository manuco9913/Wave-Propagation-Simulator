#!/bin/bash
set -eo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

if docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "Removing local image '$IMAGE'..."
  docker rmi "$IMAGE"
else
  echo "Image '$IMAGE' not found locally, skipping."
fi
