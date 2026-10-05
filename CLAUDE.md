# CLAUDE.md

Guidance for Claude Code working in this repository.

## Agent skills

### Issue tracker

Issues live as GitHub issues (manuco9913/Wave-Propagation-Simulator), managed via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical roles map onto this repo's existing `AFK`/`HITL` labels plus two new ones (`needs-triage`, `needs-info`) still to be created. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context repo. No `CONTEXT.md` or `docs/adr/` yet — `research/*/research.md` and `system-plan.md` serve that role until they exist. See `docs/agents/domain.md`.

## Code quality

Follow `CODING_STANDARDS.md` (draft). `pnpm run check` runs format check, lint, typecheck and tests, the same as CI. The pre-commit hook (`.githooks/`, enabled by `pnpm install`) runs all but tests; on Windows it runs inside the `ralph-sandbox:v2` image, because the shared `node_modules`/`.venv` hold Linux binaries.
