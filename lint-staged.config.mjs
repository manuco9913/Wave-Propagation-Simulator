// Pre-commit checks on staged files. For a partly staged file, lint-staged hides the unstaged
// hunks while it runs, so the checks see what is being committed. The project-wide typechecks
// (the `() =>` entries) still see unstaged edits in other files; CI checks the commit itself.
// Globs don't overlap: lint-staged runs separate globs concurrently.
export default {
  "frontend/**/*.{ts,tsx}": [
    "prettier --write",
    "pnpm --dir frontend exec oxlint",
    () => "pnpm --dir frontend typecheck",
  ],
  "frontend/**/*.{js,jsx,mjs,css,json,html}": "prettier --write",
  "backend/**/*.py": [
    "uv run --project backend ruff format",
    "uv run --project backend ruff check --fix",
    () => "pyright -p backend",
  ],
};
