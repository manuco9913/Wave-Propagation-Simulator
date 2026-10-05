# ISSUES

`<open_afk_issues>` lists open AFK issues, one per line (number, title, labels) — titles only. Pick a task from the list, then fetch only that issue with `gh issue view <N> --comments`. If it says it is blocked by other issues, check those with `gh issue view`; if any are still open, pick another task.

You will work on the AFK issues only, not the HITL ones.

`<previous_ralph_commits>` holds the last 5 RALPH commits (SHA, date, full message). These are the handoff notes from previous iterations. Review them to understand what work has been done.

If all AFK tasks are complete, output <promise>NO MORE TASKS</promise>.

# TASK SELECTION

Pick the next task. Prioritize tasks in this order:

1. Critical bugfixes
2. Development infrastructure

Getting development infrastructure like tests and types and dev scripts ready is an important precursor to building features.

3. Tracer bullets for new features

Tracer bullets are small slices of functionality that go through all layers of the system, allowing you to test and validate your approach early. This helps in identifying potential issues and ensures that the overall architecture is sound before investing significant time in development.

TL;DR - build a tiny, end-to-end slice of the feature first, then expand it out.

4. Polish and quick wins
5. Refactors

# EXPLORATION

Keep exploration targeted — read only what this task needs:

- The chosen issue and its parent PRD issue (if it references one)
- `CLAUDE.md`, plus `system-plan.md` / `research/*/research.md` sections relevant to the task
- Files the issue names, and code you find via grep/glob

Prefer grep and partial reads over reading whole files. Don't survey the whole repo.

# IMPLEMENTATION

Where possible, use a red-green refactor loop:

## RED: Write a single failing test

## GREEN: Write the minimal implementation

## RED: Write another failing test

Repeat until implementation is complete.

# FEEDBACK LOOPS

Follow `CODING_STANDARDS.md`.

Before committing, run `pnpm run check` (format check, lint, typecheck, tests — the same as CI). Run `pnpm run format` to fix formatting. While iterating, run only the tests you're working on.

The pre-commit hook re-runs format/lint/typecheck. Do not commit if anything fails, and never bypass the hook (`--no-verify`) — fix it, or comment on the issue and stop.

# PACKAGE MANAGER

Use pnpm for all JS/TS work — never npm, npx or yarn (use `pnpm dlx` instead of npx). Commit `pnpm-lock.yaml`; never create `package-lock.json` or `yarn.lock`. Any new `package.json` must set `"packageManager": "pnpm@<version>"` (from `pnpm --version`) and include a `"preinstall": "npx only-allow pnpm"` script. 

# COMMIT

Make a git commit. The commit message must:

1. Start with `RALPH:` prefix
2. Include task completed + issue number (and parent PRD, if any)
3. Key decisions made
4. Files changed
5. Blockers or notes for next iteration

Keep it concise.

Then push: `git push -u origin HEAD`. You are already on the branch named in `<ralph_branch>`.

# THE ISSUE

If the task is complete, close the issue after the push succeeds: `gh issue close <N> --comment "Done in <commit SHA> on branch <ralph_branch>"`.

If the task is not complete, leave a comment on the GitHub issue with what was done.

# FINAL RULES

ONLY WORK ON A SINGLE TASK.

Never switch, create or delete branches. Never push anything except the `<ralph_branch>` branch, and never force-push.
