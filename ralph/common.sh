#!/bin/bash

REPO_ROOT=$(git rev-parse --show-toplevel)
IMAGE="ralph-sandbox:v2"

# Last 5 RALPH-tagged commits, so the agent's handoff notes aren't crowded out by human commits
ralph_commits() {
  git log --grep="^RALPH:" -n 5 --format="%H%n%ad%n%B---" --date=short 2>/dev/null || true
}

# One line per open AFK issue (number, title, labels). The agent fetches the full body of
# only the issue it picks, so the injected context doesn't grow with the backlog.
ralph_issue_index() {
  gh issue list --state open --label AFK --limit 100 --json number,title,labels \
    -q '.[] | "#\(.number) \(.title) [\([.labels[].name] | join(","))]"'
}

# Ralph commits and pushes only to its own branch. Reuses the current branch if it is
# already a ralph/ branch (resuming a run), otherwise branches off HEAD. Prints the name.
ralph_branch() {
  local current branch
  current=$(git branch --show-current)
  if [[ "$current" == ralph/* ]]; then
    echo "$current"
    return
  fi
  if [ -n "$(git status --porcelain)" ]; then
    echo "Working tree not clean; commit or stash before starting Ralph." >&2
    return 1
  fi
  branch="ralph/$(date +%Y%m%d-%H%M%S)"
  git switch -q -c "$branch" >&2
  echo "$branch"
}

require_image() {
  if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
    echo "Image '$IMAGE' not found. Please run:"
    echo "  ./ralph/setup.sh"
    exit 1
  fi
}

# docker --env-file keeps \r, quotes and spaces as part of the value, so normalise .env first.
# Prints the path of a cleaned copy; caller deletes it.
clean_env_file() {
  local out
  out=$(mktemp)
  sed 's/\r$//' "$REPO_ROOT/.env" | tr '\r' '\n' \
    | sed -E 's/^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*=[[:space:]]*/\1=/; s/[[:space:]]+$//' \
    | sed -E "s/^([A-Za-z_][A-Za-z0-9_]*)=\"(.*)\"$/\1=\2/; s/^([A-Za-z_][A-Za-z0-9_]*)='(.*)'$/\1=\2/" \
    | grep -E '^[A-Za-z_][A-Za-z0-9_]*=.' > "$out" || true
  echo "$out"
}

# The container's installed dependencies live in named volumes mounted over the repo paths,
# so they never land in the shared folder: the host keeps its own native node_modules/.venv
# (Windows can't use Linux binaries or the container's symlinks), and the container avoids the
# slow bind mount for dependency I/O. The pnpm store and uv cache persist across --rm runs.
RALPH_VOLUMES=(
  "ralph-root-node-modules:/workspace/node_modules"
  "ralph-frontend-node-modules:/workspace/frontend/node_modules"
  "ralph-backend-venv:/workspace/backend/.venv"
  "ralph-pnpm-store:/home/agent/.pnpm-store"
  "ralph-uv-cache:/home/agent/.cache/uv"
)

# New named volumes are root-owned; hand them to the container's agent user once.
ensure_volumes() {
  local spec name args=() missing=0
  for spec in "${RALPH_VOLUMES[@]}"; do
    name=${spec%%:*}
    docker volume inspect "$name" >/dev/null 2>&1 || missing=1
    args+=(-v "$name:/vol/$name")
  done
  [ "$missing" = 0 ] && return
  MSYS_NO_PATHCONV=1 docker run --rm -u root "${args[@]}" "$IMAGE" chown -R agent:agent /vol >/dev/null
}

# Install/refresh the container's dependencies (no-op when already up to date).
install_deps() {
  run_in_container bash -c 'pnpm install --frozen-lockfile --reporter=silent && cd backend && uv sync --locked --quiet'
}

# Run a command in a throwaway container that can only see the repo (mounted at /workspace).
# Git inside the container needs: the mount marked safe (owned by a different uid),
# the host's line-ending setting (else every file shows as modified), and a commit identity.
# Pushes authenticate through gh (GH_TOKEN from .env) and are limited by the image's
# pre-push hook to $RALPH_BRANCH.
run_in_container() {
  local env_file rc spec vols=()
  ensure_volumes
  for spec in "${RALPH_VOLUMES[@]}"; do vols+=(-v "$spec"); done
  env_file=$(clean_env_file)

  MSYS_NO_PATHCONV=1 docker run --rm \
    -v "$(cd "$REPO_ROOT" && (pwd -W 2>/dev/null || pwd)):/workspace" \
    "${vols[@]}" \
    -e npm_config_store_dir=/home/agent/.pnpm-store \
    -w /workspace \
    --env-file "$(cygpath -w "$env_file" 2>/dev/null || echo "$env_file")" \
    -e IS_SANDBOX=1 \
    -e GIT_CONFIG_COUNT=4 \
    -e GIT_CONFIG_KEY_0=safe.directory -e GIT_CONFIG_VALUE_0='*' \
    -e GIT_CONFIG_KEY_1=core.autocrlf -e GIT_CONFIG_VALUE_1="$(git config core.autocrlf || echo false)" \
    -e GIT_CONFIG_KEY_2=credential.https://github.com.helper -e GIT_CONFIG_VALUE_2='!gh auth git-credential' \
    -e GIT_CONFIG_KEY_3=core.hooksPath -e GIT_CONFIG_VALUE_3=/etc/ralph-hooks \
    -e RALPH_BRANCH="${RALPH_BRANCH:-}" \
    -e GIT_AUTHOR_NAME="$(git config user.name)" -e GIT_AUTHOR_EMAIL="$(git config user.email)" \
    -e GIT_COMMITTER_NAME="$(git config user.name)" -e GIT_COMMITTER_EMAIL="$(git config user.email)" \
    "$IMAGE" "$@"
  rc=$?

  rm -f "$env_file"
  return $rc
}
