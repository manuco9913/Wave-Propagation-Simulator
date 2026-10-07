# Frontend Plan

Tech stack and visualization decisions in `system-plan.md`. Schema contract in `contracts.md`.

---

## Layout (Hardcoded Shell)

The outer layout is hardcoded React — not schema-driven:

```
┌──────────────────────────────────────┐
│  Scenario panel (left sidebar)       │
│  ├── Scenario fields (schema-driven) │
│  └── Entity list                     │
│      └── Entity form × N (schema)    │
│  Map (right, full height)            │
│  └── Heatmap overlay (Deck.gl)       │
│  Height slider (bottom overlay)      │
└──────────────────────────────────────┘
```

---

## Schema-Driven Form Rendering

Forms for entity and scenario are rendered generically from the JSON Schema served by
the backend (`GET /api/schema/entity`, `GET /api/schema/scenario`).

**`SchemaFormRenderer`** — generic component:
1. Fetches schema on mount (SWR, cached)
2. Iterates `schema.properties` in key order
3. Evaluates `x-show-if` against current `watch()` values — hides/shows fields live
4. Selects renderer by `x-ui-component` or JSON Schema `type`
5. All field renderers register via react-hook-form `Controller`

**Validation**: Zod schema derived at runtime from the JSON Schema (`deriveZod.ts`).
Used as react-hook-form resolver. Fires on blur and on submit.

---

## Field Renderers

One component per type. Each receives: `name`, `label`, field-level schema props
(`min`, `max`, `step`, `enum`, `x-unit`, `default`), and react-hook-form control.

| Renderer | Handles |
|---|---|
| `NumberField` | `type: number` — numeric input + unit suffix |
| `StringField` | `type: string` (no enum) — text input |
| `EnumField` | `type: string, enum: [...]` — dropdown |
| `BooleanField` | `type: boolean` — toggle |
| `FileField` | `x-ui-component: file` — file path input |
| `CoordinateField` | `x-ui-component: coordinate` — lat/lon inputs + map sync |
| `RangeField` | `x-ui-component: range` — dual min/max numeric inputs |
| `MatrixField` | `x-ui-component: matrix` — file upload + read-only data preview |
| `ValueOrFileField` | `x-ui-component: numeric-or-file` — toggle between numeric input and file upload (`POST /api/files` → `file_id`) |

---

## Coordinate Field ↔ Map Sync

Bidirectional via Zustand:
- Form `position` change → update `mapStore.markers[entityId]`
- Map marker drag → `setValue('position', {lat, lon})` in react-hook-form

---

## Entity List

- `useFieldArray` (react-hook-form) — 2–10 entities
- Add / remove buttons; each entity renders `SchemaFormRenderer` with entity schema
- Entity index shown; optional `label` field shown as display name if set

---

## Color Scale (Frontend-only — not in contract)

Global Zustand slice (`colorScaleStore`). Persisted to localStorage.

```ts
{
  minColor: string        // hex — user-picked
  maxColor: string        // hex — user-picked
  stopCount: number       // 2–20
  thresholds: number[]    // dBm, length = stopCount, auto-spaced then user-adjustable
}
```

- Middle colors interpolated between `minColor` and `maxColor` — not individually settable
- `thresholds` auto-recalculated on `stopCount` change, then each is user-editable
- Passed to the Deck.gl R32F shader as uniforms (breakpoint array + color array)
- Adjusting breakpoints or colors updates shader uniforms only — no re-fetch

---

## Height Slider

- Slider + direct numeric input
- Ring-buffer prefetch: ±2 adjacent height levels fetched in background
- On change: `GET /api/scenarios/{id}/runs/{run_id}/slices/{height}` →
  56-byte binary header + `Float32Array` body → uploaded to R32F texture

---

## File Structure

```
frontend/src/
  schema/
    useEntitySchema.ts       # SWR fetch → GET /api/schema/entity
    useScenarioSchema.ts     # SWR fetch → GET /api/schema/scenario
    deriveZod.ts             # JSON Schema → Zod schema at runtime
    evaluateShowIf.ts        # Evaluates x-show-if conditions
    SchemaFormRenderer.tsx   # Generic form renderer
    fieldRenderers/          # One file per type (see table above)
  map/                       # MapLibre + react-map-gl (see system-plan)
  heatmap/                   # Deck.gl R32F layer + GLSL shaders (see system-plan)
  scenario/
    ScenarioPanel.tsx        # Hardcoded sidebar shell
    EntityList.tsx           # useFieldArray wrapper
  store/
    mapStore.ts              # Marker positions, active scenario bounds
    jobStore.ts              # SSE job state
    colorScaleStore.ts       # Color scale (see above)
    uiStore.ts               # Height slider position, panel open/close
```
