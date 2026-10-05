FROM docker/sandbox-templates:claude-code

USER agent

# Upgrade Claude Code to latest (must run as agent, installs to ~/.local/)
RUN curl -fsSL https://claude.ai/install.sh | bash

USER root

# Load tokens from .env for non-interactive shells (how the agent runs commands)
ENV BASH_ENV=/home/agent/.env_loader
RUN cat > /home/agent/.env_loader <<'EOF'
if [ -f .env ]; then
  for _var in GH_TOKEN; do
    _val=$(grep "^${_var}=" .env | cut -d= -f2-)
    if [ -n "$_val" ]; then export "${_var}=${_val}"; fi
  done
  unset _var _val
fi
EOF

# Wrapper that injects CLAUDE_CODE_OAUTH_TOKEN before claude starts.
# Placed in /usr/local/bin which won't be touched by claude auto-updates.
# The real binary lives at ~/.local/bin/claude.
RUN cat > /usr/local/bin/claude <<'WRAPPER'
#!/bin/bash
if [ -z "$CLAUDE_CODE_OAUTH_TOKEN" ] && [ -f .env ]; then
  CLAUDE_CODE_OAUTH_TOKEN=$(grep "^CLAUDE_CODE_OAUTH_TOKEN=" .env | cut -d= -f2-)
  export CLAUDE_CODE_OAUTH_TOKEN
fi
exec /home/agent/.local/bin/claude "$@"
WRAPPER
RUN chmod +x /usr/local/bin/claude

# pnpm is the only JS package manager this repo uses
RUN npm install -g pnpm@10

# Push guard, enabled via core.hooksPath in run_in_container (common.sh): the agent may
# only push to the run branch the host script created and passed in as RALPH_BRANCH.
RUN mkdir -p /etc/ralph-hooks && cat > /etc/ralph-hooks/pre-push <<'HOOK' && chmod +x /etc/ralph-hooks/pre-push
#!/bin/sh
while read -r local_ref local_sha remote_ref remote_sha; do
  if [ -z "$RALPH_BRANCH" ] || [ "$remote_ref" != "refs/heads/$RALPH_BRANCH" ]; then
    echo "ralph pre-push: refusing to push to $remote_ref (only refs/heads/${RALPH_BRANCH:-<unset>} allowed)" >&2
    exit 1
  fi
done
exit 0
HOOK

# Prepend /usr/local/bin so wrapper is found before ~/.local/bin
ENV PATH=/usr/local/bin:$PATH

USER agent