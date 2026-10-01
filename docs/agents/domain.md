# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root, if it exists.
- **`docs/adr/`** — read ADRs that touch the area you're about to work in.
- **`research/*/research.md`** — pre-ADR technology research (backend language, frontend stack, tile delivery, etc.). Treat conclusions here as the default unless superseded by an ADR.
- **`system-plan.md`** and **`prd-phase1-frontend.md`** — architecture and prior PRD context.
- **`docs/agents/frontend-style.md`** — CSS architecture, design tokens, and layout rules. Read before writing any frontend component styling.

If `CONTEXT.md` or `docs/adr/` don't exist yet, **proceed silently**. Don't flag their absence; don't suggest creating them upfront.

## File structure

Single-context repo (this repo is single-context, not a monorepo):

```
/
├── CONTEXT.md          (not yet created)
├── docs/adr/            (not yet created)
├── research/            (pre-ADR technology research, by topic)
└── system-plan.md
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md` once it exists, or the terminology already used in `system-plan.md` / `research/`.

## Flag ADR conflicts

If your output contradicts an existing ADR or a `research/` conclusion, surface it explicitly rather than silently overriding:

> _Contradicts research/backend-language/research.md (Python/FastAPI recommendation) — but worth reopening because…_
