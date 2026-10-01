# Frontend Style Guide

Status: colors, font family, and exact numeric values are **placeholders** pending a separate design pass. Structure (token names, scale shape, rules) is final.

## For the design pass

Everything else in this doc — what the product does, who uses it, the research docs — is in the rest of the repo; read that instead of relying on this file for context.

Two things this doc can't tell you that aren't derivable by reading the repo:

- **Taste call**: should read as a polished product, not a bare engineering tool — flat and minimal is the direction (see rules below), but "flat" shouldn't mean "default browser styling."
- **Deliverable**: a hex value for each color token below, one font choice (or a heading/body pairing), and a pass over the placeholder spacing/type numbers — confirm or adjust them. Return it as a filled-in `tokens.css` (or the equivalent values mapped to the token names below) so it drops in directly.

## CSS approach

- Plain CSS + CSS Modules (native to Vite, zero extra tooling).
- One file per component, colocated: `Button.tsx` + `Button.module.css` in the same folder.
- No `id` selectors for styling — `id` is reserved for accessibility/JS hooks only. Encapsulation comes from CSS Modules' auto-scoped class names, not specificity tricks.
- No `!important`, ever. If you reach for it, the actual problem is a selector fighting another selector it shouldn't be able to see — fix the scoping, don't override it.
- No shared component library for now (no `Button`/`Input`/`Panel` primitives yet). Before styling a new instance of something that already exists elsewhere (a button, an input), look at how the existing one is styled and match it, using the tokens below. Revisit "shared primitives" if visible drift shows up.

## Design tokens

All tokens live in one file, `src/styles/tokens.css`, imported once at the app root. Nothing else defines a color, size, or spacing value directly — everything references a token.

### Color (placeholder values — real palette TBD)

Roles needed, not final hex values:

```
--color-bg
--color-surface        /* panels, cards */
--color-border
--color-text
--color-text-muted
--color-accent          /* primary interactive */
--color-accent-hover
--color-success
--color-warning
--color-danger
```

Light theme only for v1. Heatmap/map colors are **out of this system** — handled separately per `research/frontend/research.md`'s resolved decision (fixed palette, user-adjustable breakpoints) and the dataviz skill.

### Spacing — 7 steps, `rem`-based (placeholder values)

| Token | Placeholder | Typical use |
|---|---|---|
| `--space-xs` | 0.25rem (4px) | icon-to-label gap, label-to-input gap |
| `--space-sm` | 0.5rem (8px) | gap between adjacent buttons; field-to-error-message |
| `--space-md` | 0.75rem (12px) | padding inside small controls (button, input) |
| `--space-lg` | 1rem (16px) | default gap between stacked form fields |
| `--space-xl` | 1.5rem (24px) | gap between distinct groups within a panel |
| `--space-2xl` | 2rem (32px) | panel edge padding; gap between sidebar and map |
| `--space-3xl` | 3rem (48px) | rare — empty-state breathing room |

**Rule:** use `gap` on flex/grid containers for spacing between siblings — never manual `margin` on children. This is what keeps adding/removing a UI element automatic and correct.

**Rule:** layout regions use flexible sizing, not fixed widths — e.g. sidebar width as `clamp(280px, 22vw, 400px)`, not a fixed `px`.

### Typography — 5 steps (placeholder values, font-family TBD)

| Token | Placeholder | Use |
|---|---|---|
| `--font-size-sm` | 12px | helper text, units, timestamps |
| `--font-size-base` | 14px | body text, labels, inputs |
| `--font-size-md` | 16px | section headings within a panel |
| `--font-size-lg` | 20px | panel titles |
| `--font-size-xl` | 28px | page-level heading, if any |

```
--line-height-tight: 1.2   /* headings */
--line-height-normal: 1.5  /* body text */
```

### Shape

```
--radius            /* single value, applied uniformly to inputs/buttons/panels */
--shadow-float       /* single value, used only for things that float above the page: modals, dropdowns */
```

No shadow on static panels/cards — flat by default. Rounding and shadow are both single values, not scales — this isn't a system that needs many levels of elevation.

### Scope boundaries

- No responsive breakpoints — desktop-only is explicitly out of scope for this build.
- Dark mode not built now, but token-based structure means it's a second `tokens.css` variant later, not a rewrite.
