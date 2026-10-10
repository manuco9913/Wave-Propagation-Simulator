# Contracts

Schema contract between frontend and backend. Tech stack in `system-plan.md`.

## Format & Delivery

JSON Schema draft-07 + `x-` extension properties for UI hints.

Files live in `/contracts/`. Backend serves them at runtime — no rebuild needed on schema change:
- `GET /api/schema/entity`
- `GET /api/schema/scenario`

Frontend validates at runtime using **ajv 8** directly against the served JSON Schema (via `@hookform/resolvers/ajv`).
Backend (Python) validates request bodies directly against the same JSON Schema files with the
`jsonschema` library — no field definitions duplicated in backend code.

---

## Type System

| `x-ui-component` | JSON Schema expression | Renders as |
|---|---|---|
| — | `type: string` | Text input |
| — | `type: number` | Numeric input + `x-unit` suffix |
| — | `type: string, enum: [...]` | Dropdown |
| — | `type: boolean` | Toggle |
| `file` | `type: string` | File path input |
| `coordinate` | `type: object, properties: {lat, lon}` | Lat/lon inputs + map marker |
| `range` | `type: object, properties: {min, max}` | Dual min/max input |
| `matrix` | `type: string` | File upload + read-only preview |
| `numeric-or-file` | `oneOf: [{type: number}, {type: string}]` | Inline value with toggle to file upload |
| — | `type: object, properties: {...}` | Grouped section (bbox); each property renders with its own UI component; arbitrary nesting |

---

## Conditional Visibility

Any field may declare `x-show-if`. Conditions reference fields within the same object only.

```json
"x-show-if": {
  "and": [
    { "field": "terrain_enabled", "op": "eq", "value": true },
    { "field": "angular_resolution", "op": "lt", "value": 1.0 }
  ]
}
```

Supported ops: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`
Top-level key is `and` or `or`. Each entry is `{ field, op, value }`.

---

## Recalculation Level (`x-recalc`)

Every field declares what a change to it costs once a run exists (#43):

| `x-recalc` | Meaning | What happens |
|---|---|---|
| `engine` | MATLAB must compute again | browser shows "recompute needed"; `POST /api/scenarios/{id}/runs` creates a new run |
| `slice` | server reprocesses stored data | browser re-requests slices with the new value as a query parameter; no new run |
| `view` | browser only | applied to the slice already loaded; no server call |
| `none` | text only | no effect on results |

Browser-only settings that aren't schema fields (colour ramp, opacity) are `view` level.

---

## Entity Schema Fields

| Field | Type / widget | Constraints |
|---|---|---|
| `label` | string | — |
| `position` | coordinate | lat: −90–90, lon: −180–180 |
| `frequency` | numeric-or-file | x-unit: MHz |
| `power` | numeric-or-file | x-unit: dBm |
| `azimuth` | number | min: 0, max: 360, x-unit: ° |
| `beam_width` | number | vertical half-power beamwidth; min: 1, max: 180, x-unit: °; optional (omitted = isotropic) |
| `tilt` | number | min: −90, max: 90, default: 0, x-unit: ° (negative = downtilt) |
| `antenna_height` | number | min: 0, x-unit: m |
| `radius` | number | min: 0.1, x-unit: km |

## Scenario Schema Fields

| Field | Type / widget | Constraints |
|---|---|---|
| `name` | string | — |
| `height_range` | range | x-unit: m |
| `height_step` | number | min: 1, x-unit: m |
| `height_reference` | enum | ground \| sea_level, default: ground |
| `angular_resolution` | number | min: 0.01, max: 2.0, default: 0.1, x-unit: ° |
| `distance_step` | number | min: 10, default: 100, x-unit: m |
| `grid_cell_size` | number | default: 100, x-unit: m |
| `terrain_enabled` | boolean | default: true |
| `combination_method` | enum | max \| mean \| sum, default: max |
| `entities` | array of entity | 1–10 items |

---

## File-sourced Fields

When a `numeric-or-file` field (`frequency`, `power`) uses file mode:
- The browser uploads the file to `POST /api/files` (see `contracts/api.md`); the server parses
  and validates it immediately, so errors show next to the field before submit.
- The field's string value is the returned `file_id` (content hash). Stored files never change,
  so a run always refers to exactly the table it was computed with.
- The file is a per-angle table: at entity angle *x*, the value is *y*. Exact format is TBD
  (see `system-plan.md`).
