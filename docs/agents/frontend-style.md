# Frontend Style Guide

Status: **look decided — "Dense Technical Instrument Panel"** (chosen from four mocks). Color, font, and shape values below are final; spacing and type-size numbers are the original placeholders, confirmed as-is. Structure (token names, scale shape, rules) is unchanged.

## Visual language

Dense technical instrument panel: reads as a defense/avionics console, not a generic SaaS form. Flat, square, monospace-forward, high information density.

- **Square everything** — `--radius: 0`, no rounded corners anywhere (inputs, buttons, panels, map pins, slider thumb).
- **Hairline structure** — 1px borders in a dark olive-charcoal (`--color-border`), not light gray. Borders do the work shadows would do elsewhere.
- **Type pairing** — IBM Plex Sans Condensed for UI text and headings (headings uppercase, `letter-spacing: .02em`); IBM Plex Mono for all numeric/data text: units, lat/lon, legend scale, slider value, status lines, buttons.
- **Bracketed labels** — section labels and buttons render as `[ LABEL ]` (brackets via `::before`/`::after`, not in the markup). Section labels use `--color-accent` + mono.
- **HUD framing** (map + app frame only): 2px accent corner brackets at the four corners of the app frame; crosshair reticle and ruler ticks along the map's top/left edges; and the real-distance map grid (see "Map grid" below).
- **Map markers** — entity pins are 45°-rotated squares (diamond blips), radius rings are 1px dashed accent circles, slider thumb is square.
- **Status lines** — job progress text is mono, accent-colored, with a blinking `_` cursor.
- **Floating elements** (legend, height slider, map toolbar, modals) have no shadow; they separate from the map with a 1px `--color-border` border. Modals add a scrim behind them.

**Visual baseline:** open [`design-reference/technical-panel.html`](design-reference/technical-panel.html) in a browser. It is a static mock of the main screen (sidebar form + entity cards, map with pins/rings/heatmap/legend, height slider, job status) in this exact look, with a token readout at the bottom. Treat it as the target to match, not as code to copy: it is one self-contained file with inline CSS, whereas the app uses CSS Modules + `tokens.css`. If the mock and the values in this doc disagree, this doc wins.

Rejected directions (don't revisit unless asked): bold/graphic, refined premium minimal, soft layered depth. The original "bland" feedback was about shapes and hierarchy, not color — palette swaps on a plain boxy layout will not satisfy it.

## CSS approach

- Plain CSS + CSS Modules (native to Vite, zero extra tooling).
- One file per component, colocated: `Button.tsx` + `Button.module.css` in the same folder.
- No `id` selectors for styling — `id` is reserved for accessibility/JS hooks only. Encapsulation comes from CSS Modules' auto-scoped class names, not specificity tricks.
- No `!important`, ever. If you reach for it, the actual problem is a selector fighting another selector it shouldn't be able to see — fix the scoping, don't override it.
- No shared component library for now (no `Button`/`Input`/`Panel` primitives yet). Before styling a new instance of something that already exists elsewhere (a button, an input), look at how the existing one is styled and match it, using the tokens below. Revisit "shared primitives" if visible drift shows up.

## Design tokens

All tokens live in one file, `src/styles/tokens.css`, imported once at the app root. Nothing else defines a color, size, or spacing value directly — everything references a token.

### Color (final)

Light, slightly green-tinted paper neutrals with an olive accent.

```
--color-bg:           #f1f2ec;
--color-surface:      #f8f9f4;   /* panels, cards */
--color-border:       #3a3f35;
--color-text:         #20241d;
--color-text-muted:   #5f6456;   /* 5.7:1 on surface */
--color-accent:       #55713f;   /* primary interactive; 5.5:1 with white text */
--color-accent-hover: #44592f;
--color-success:      #3f8f52;
--color-warning:      #c98a1b;
--color-danger:       #b3412c;
```

Map base colors used in the mock (water `#e7e9df`, land `#eceee3`, contour `#8a9178`, road `#6c7360`) are illustrative only — map styling is handled with the map/heatmap work, not this file.

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

### Typography — 5 steps (sizes confirmed; fonts final)

```
--font-ui:   'IBM Plex Sans Condensed', sans-serif;
--font-mono: 'IBM Plex Mono', monospace;
```

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
--radius: 0;           /* single value, applied uniformly to inputs/buttons/panels */
--shadow-float: none;  /* floating things use a 1px border (+ scrim for modals) instead */
```

No shadow on static panels/cards — flat by default. Rounding and shadow are both single values, not scales — this isn't a system that needs many levels of elevation. `--shadow-float` stays as a token (set to `none`) so a shadow can be introduced later without touching components.

### Map grid (required)

A checkered grid is always drawn over the map, anchored to real ground distance, not screen pixels. Not user-toggleable.

- **Cell size** comes from the current zoom and snaps to round steps (10 m, 20 m, 50 m, 100 m, 200 m, 500 m, 1 km, 2 km, 5 km, 10 km, …), aiming for roughly 80–160 px per cell. **10 m is the smallest cell**: clamp there even if zoomed in further (cells then exceed 160 px). The scale bar shows the current cell size.
- **Stacking**: drawn over the heatmap but **below the entity pins and radius rings**, so markers stay crisp and draggable. Also below UI chrome (legend, height slider, toolbar). Lines are 1px with `pointer-events: none`.
- **Re-render on every zoom and pan** (the map's `move` event). Meters per pixel = `156543.03 × cos(lat) / 2^zoom`; pick the nearest round step. Anchor lines to fixed world coordinates, not the screen, so they stay put when the map pans. A fixed CSS grid cannot do this.
- **Projection**: lat/lon lines are not equal distances apart, and east-west vs north-south spacing diverges with latitude. For a true "1 km cell" grid, draw it in a local metric frame (UTM zone or a local east/north frame) around the scenario. This also matches the simulator's 100 m output cells and per-entity radius in km.
- **Implementation layer**: the heatmap is a Deck.gl layer, so a MapLibre line layer would render underneath it. Draw the grid as a Deck.gl layer added after the heatmap layer (or a canvas/SVG overlay above the heatmap), and keep the pins and rings above it. Do not put it in the MapLibre style — that also keeps it unchanged through the PMTiles swap.
- **Color**: `--color-border` (olive-charcoal) at roughly `.2`–`.3` opacity. An accent-colored line at `.08` disappears on the saturated red/yellow heatmap areas. Verify against the heatmap's reds and blues.
- **Reference mock**: `design-reference/technical-panel.html` uses a fixed 96px CSS grid purely as a stand-in for weight and stacking order. It does not demonstrate real-distance scaling.

### Scope boundaries

- No responsive breakpoints — desktop-only is explicitly out of scope for this build.
- Dark mode not built now, but token-based structure means it's a second `tokens.css` variant later, not a rewrite.
