#!/bin/bash
# Attended single run on the host: acceptEdits still prompts before shell commands.
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
cd "$REPO_ROOT"
RALPH_BRANCH=$(ralph_branch) || exit 1

issues=$(ralph_issue_index)
commits=$(ralph_commits)
prompt=$(cat ralph/prompt.md)

claude --permission-mode acceptEdits \
  "<ralph_branch>$RALPH_BRANCH</ralph_branch>

<previous_ralph_commits>
${commits:-No RALPH commits yet}
</previous_ralph_commits>

<open_afk_issues>
$issues
</open_afk_issues>

$prompt"
