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

Follow `CODING_STANDARDS.md` (draft). `pnpm run check` runs format check, lint, typecheck and tests, the same as CI. Backend tests that need PostgreSQL create a throwaway database per test on `TEST_DATABASE_URL` (a user allowed to `CREATE DATABASE`), and are skipped when it is unset; CI sets it and `WPS_REQUIRE_DB=1`, so there they can't be skipped. The backend itself needs `DATABASE_URL` (`pnpm run dev:backend`) and applies `backend/migrations/*.sql` at startup. Terrain-enabled scenarios need the tiles from `python terrain/fetch.py` (in `TERRAIN_DIR`, default `./terrain-cache`); tests use the committed fixture in `terrain/fixtures/`. `pnpm run e2e` runs the end-to-end tests (`frontend/e2e/*.e2e.ts`, Playwright): a real browser against the real backend, which `backend/scripts/e2e_server.py` starts on a throwaway database (needs `TEST_DATABASE_URL`) with the fixture terrain. CI runs it after `check`. The pre-commit hook (`.githooks/`, enabled by `pnpm install`) runs lint-staged on staged files plus typecheck; on a Windows host without `uv` it runs inside the `ralph-sandbox:v2` image. The Ralph container keeps its `node_modules`/`.venv` in Docker volumes (`ralph/common.sh`), so the host's own installs never collide with it.
