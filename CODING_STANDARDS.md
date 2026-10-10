# Coding standards

> **DRAFT.** Based on Matt Pocock's `course-video-manager` standards, plus this repo's
> contracts and frontend rules. Open questions are marked **TBD**.

The rules a human or an agent holds in their head while writing and reviewing code here. Where a
rule is enforced by a tool, the tool is named; everything else is checked in review.

Architecture decisions (the simulation engine boundary, the job queue, the stack) live in
`system-plan.md` and the PRDs, not here.

## Enforcement

`pnpm run check` is the one command that decides whether code is acceptable. It runs, in order:

| Step | Frontend | Backend |
|---|---|---|
| `format:check` | Prettier | `ruff format --check` |
| `lint` | oxlint | `ruff check` |
| `typecheck` | `tsc` (strict + extras below) | pyright (strict) |
| `test` | vitest | pytest |

- The **pre-commit hook** (`.githooks/pre-commit`, via `lint-staged.config.mjs`) formats and
  lint-fixes the staged files, then typechecks; it doesn't run tests. CI
  (`.github/workflows/check.yml`) runs all of it on every push and PR. The Ralph loop runs it before
  each commit.
- Never bypass the hook (`--no-verify`) or CI. If a check is wrong, fix the check in its own commit
  and say why.
- `pnpm run format` fixes formatting. Formatting is never a review topic.
- Lint _warnings_ are a standing backlog, not a blocker. Only rules that encode a standard in this
  file are set to `error`. A file you touch should leave with fewer warnings than it came with.
- pnpm only for JS: never npm, npx or yarn (`pnpm dlx` instead of npx). uv only for Python.

## Contracts are the source of truth

Every field in `contracts/*.schema.json` is defined there and only there. Both sides validate
against those files: ajv on the frontend, the schema file directly or a Pydantic model checked
against it on the backend.

- **Never re-declare a field** (name, type, range, unit, default) in TypeScript or Python. Derive
  it from the schema, or load the schema at runtime as `/api/schema/*` does.
- A new field goes into the contract first, then into code. A code change that needs a contract
  change includes both in the same commit.
- **TBD:** how Python models stay in sync with the schemas: hand-written Pydantic plus a test that
  diffs them against the schema, or code generation.

## Module design

### Deep modules

Prefer deep modules: a small interface hiding a large implementation. The interface is the cost;
the implementation is the benefit.

- One concept is one module boundary. Don't spread a single concept across several thin files.
- If a caller has to call several small functions in a specific order, or read the implementation
  to use the module correctly, the module is too shallow. Push the orchestration inside.
- Ask before adding a method or a parameter: can I hide this instead?

### Extract modules, not test hooks

Extract logic into its own module when it is a concept with its own interface: it would exist,
with that signature, even without tests. Test it there. Don't split out a helper just so a test can
reach it; test it through the module that owns it.

For UI, the default test is the rendered component (Testing Library). A reducer or other state
logic gets its own tests only when it is a module in its own right. Example: the show/hide field
logic (a condition plus form values gives visible or not) qualifies; a label-formatting helper
pulled out of a component does not.

### Design for testability

1. **Accept dependencies, don't create them.** Pass the DB connection, clock or `fetch` in; don't
   construct them inside.
2. **Return results, don't produce side effects.** A function that returns a value is easier to
   test than one that mutates state.
3. **Small surface area.** Fewer methods mean fewer tests; fewer parameters mean simpler setup.

## Types

### Every `any` is a leak (TS) / every `Any` is a leak (Python)

An `any` switches the type checker off for every value that flows through it, long after the line
that produced it. Write the type you actually mean:

- A shape you know gets a name: one `interface` / `TypedDict` / Pydantic model, not a cast at each
  call site.
- A shape you don't know yet gets `unknown` (Python: `object`) and is then narrowed. That makes the
  reader prove the shape before using it.
- A shape that varies by caller gets a generic **constrained** to the real thing.
- An unavoidable `any` from a third-party type is cast **once at the edge** into a named type, and
  stays out of every exported signature.

A new `any` needs a reason in the commit message. Enforced by oxlint
(`typescript/no-explicit-any: error`) and pyright strict, whose "partially unknown" errors catch
bare `dict`/`list`.

The tsconfig also enables `noUncheckedIndexedAccess`: `arr[i]` is `T | undefined`. Handle the
`undefined`; don't silence it with `!`.

### Optional parameters

Scrutinise every optional parameter. Forgetting to pass one is a bug that type-checks. Prefer a
required parameter, or separate functions, over a flag that changes behaviour. Prioritise
correctness over backwards compatibility. Nothing here is a published API yet.

## Configuration

Read every environment variable and config value **at startup**, not at the moment of use. A
setting read inside a rarely-run branch turns a missing `.env` line into a failure that appears
minutes into a job. Resolve config in one place at the entry point, fail fast, and name the missing
variable in the error.

## Testing

Tests verify **behaviour through public interfaces**, not implementation details. Code can change
entirely; tests shouldn't break unless behaviour changed.

**Mock at system boundaries only:** external services, time, randomness, and the network between
frontend and backend. A database or filesystem goes in real (a local test instance) when that's
practical. Never mock your own modules. If something is hard to test without mocking an internal,
redesign the interface.

Red flags in review:

- Mocking your own modules, or asserting on call counts or order of internal calls
- Verifying through a side door (querying the DB) instead of through the interface
- A test that breaks on a refactor with no behaviour change
- A test name that describes _how_, not _what_
- Testing a one-liner or a simple mapping, where the test just mirrors the code
- Thin delegation tests for route handlers. Test the module the route calls instead.
- Asserting on pixels or rendered images. Test the data the renderer is given.

Every user-facing flow gets at least one integration test that fakes only the network boundary
between frontend and backend.

### TDD: vertical slices

For behaviour changes, one test at a time:

```
RED→GREEN: test1→impl1
RED→GREEN: test2→impl2
REFACTOR (only when green)
```

Run the new test and **see it fail** before writing the code. Writing all the tests first produces
tests of imagined behaviour. Pure scaffolding and styling have no red step; say so in the commit.

## Frontend

All styling rules (CSS Modules, tokens only, no `id` selectors, no `!important`, `gap` instead of
margins, flexible layout widths) live in [`docs/agents/frontend-style.md`](docs/agents/frontend-style.md).
That doc wins over the design mock.

## Backend

- FastAPI handlers stay thin: parse, call a module, return. The logic lives in the module and is
  tested there.
- Every function has full type annotations (pyright strict enforces this, including tests).
- Ruff rule set: `E F I B UP SIM RUF`. Imports are sorted by Ruff; don't hand-order them.
- **TBD:** async vs. sync conventions for DB and external calls, once the job queue lands.

## Open questions (TBD)

- Contract → Pydantic sync strategy (see above).
- File-size cap (Matt fails commits on files over ~5,500 tokens) and dependency-boundary rules
  (dependency-cruiser / import-linter). Deferred until there is enough code to need them.
- A review pass after each Ralph iteration that checks the diff against this file.
- Once `docs/adr/` exists: "ADRs are binding" as a standing rule here.
