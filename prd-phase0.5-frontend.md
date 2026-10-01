# PRD — Wave Propagation Simulator: Phase 0.5 Frontend

## Problem Statement

The existing wave propagation simulation tool is a Unity/.NET 4.8 monolith. Unity — a game engine — is the wrong host for a simulation/analysis platform: it couples UI, computation, and rendering into a single process with no clear service boundaries, making it difficult to deploy, extend, or test. This PRD covers **Phase 0.5 of the rewrite: the complete frontend application**.

---

## Solution

Build a React 19 + Vite 6 + TypeScript 5 single-page application with:

- A **schema-driven form** that fetches field definitions from the backend at runtime and validates using ajv 8 against the same JSON Schema files used by the C# backend — no field definitions hardcoded in frontend code.
- An **interactive MapLibre GL JS 4 map** (offline vector tiles — PMTiles, Protomaps schema, zoom 0–10, ~500 MB — served from `frontend/public/` via Vite static middleware; no backend required, no external tile CDN) with draggable entity markers and per-entity radius circles.
- A **job submission + SSE flow**: POST the scenario, immediately open a native `EventSource` to stream job progress.
- A **height slider with ring-buffer prefetch** (±2 levels) that fetches binary propagation slices and renders them as a custom Deck.gl R32F texture layer with a hardcoded GLSL color ramp.
- A **save/discard run flow**: confirmation dialog before an unsaved result is overwritten; user names and saves a run for permanent storage.

Alongside the frontend, two JSON Schema contract files (`/contracts/entity.schema.json`, `/contracts/scenario.schema.json`) and a REST API contract (`/contracts/api.md`) are produced as the shared source of truth for both the frontend and the C# backend.

---

## User Stories

1. As a developer, I want `/contracts/entity.schema.json` and `/contracts/scenario.schema.json` committed to the repo, so that both the frontend and C# backend validate against a single source of truth without duplicating field definitions.
2. As a developer, I want `/contracts/api.md` to define all endpoint signatures, request/response shapes, status codes, and the binary slice wire format, so that frontend and backend can be developed independently against a stable contract.
3. As a user, I want the map to function with no internet connection, so that the tool is usable in air-gapped or field-deployed environments.
4. As a user, I want to open the application and see an interactive map centered on a default location, so that I can immediately begin placing entities.
5. As a user, I want a scenario panel in a left sidebar, so that I can configure scenario parameters without losing sight of the map.
6. As a user, I want the scenario form fields (name, height range, height step, angular resolution, grid cell size, terrain toggle, combination method) rendered from the JSON Schema served by the backend, so that field changes are reflected in the UI without a frontend rebuild.
7. As a user, I want to add between 2 and 10 entities to a scenario, so that I can simulate multiple emitters simultaneously.
8. As a user, I want each entity form (label, position, frequency, power, azimuth, antenna height, radius) rendered from the entity JSON Schema, so that field additions or constraint changes don't require frontend code changes.
9. As a user, I want to place an entity by clicking on the map, so that I can set its position intuitively without typing coordinates.
10. As a user, I want to drag an entity marker on the map to update its position, so that I can adjust placement quickly.
11. As a user, I want lat/lon coordinate fields in the entity form to stay in bidirectional sync with the map marker, so that I can use either input method interchangeably.
12. As a user, I want each entity's radius visualized as a filled circle on the map, so that I can see its area of interest.
13. As a user, I want the radius circle to update in real time as I change the radius field, so that I can see the effect immediately.
14. As a user, I want numeric fields to show a unit suffix (e.g. MHz, dBm, m, km, °), so that I know what unit to enter.
15. As a user, I want fields with `x-show-if` conditions to hide or show dynamically based on other field values, so that only relevant fields are visible.
16. As a user, I want `numeric-or-file` fields (frequency, power) to let me toggle between an inline value and a file path, so that I can supply either a scalar or a per-range lookup table.
17. As a user, I want form validation (type checks, min/max constraints) to run on blur and on submit, so that I get feedback without waiting until submission.
18. As a user, I want clear inline error messages next to each invalid field, so that I know exactly what to fix.
19. As a user, I want to submit a scenario and immediately see a job progress indicator, so that I know the backend has received my request and is working.
20. As a user, I want job progress to stream in real time via SSE without polling, so that the UI stays responsive during computation.
21. As a user, I want the heatmap overlay to appear automatically when the job completes, so that I don't need to manually trigger rendering.
22. As a user, I want a height slider that lets me scrub through height levels of the propagation output, so that I can explore signal strength at different altitudes.
23. As a user, I want to type a specific height value numerically in addition to using the slider, so that I can jump to a precise altitude.
24. As a user, I want adjacent height levels (±2) prefetched in the background, so that scrubbing feels smooth without waiting for each level to load.
25. As a user, I want the heatmap rendered as a GPU-accelerated R32F texture using a custom Deck.gl layer, so that large grids render at interactive frame rates.
26. As a user, I want null cells (outside any entity radius) to render as transparent, so that only the valid propagation area is shown.
27. As a user, I want the heatmap positioned correctly on the map using the bounding box from the slice header, so that I can correlate signal strength with terrain features.
28. As a user, I want to save a completed run by giving it a name, so that I can preserve results before re-running with different parameters.
29. As a user, I want a confirmation dialog before an unsaved run is deleted, so that I don't accidentally lose results.
30. As a user, I want to re-run a scenario after modifying parameters, so that I can iterate on configurations.
31. As a developer, I want `evaluateShowIf` to be a pure function with no side effects, so that it can be unit tested without a DOM or form context.
32. As a developer, I want `SliceParser` to be a pure function that takes a raw `ArrayBuffer` and returns a typed result, so that it can be unit tested without network or browser APIs.
33. As a developer, I want `SchemaFormRenderer` to accept a schema object and react-hook-form `control` as props, so that it can be tested in isolation with a fixture schema.
34. As a developer, I want Zustand stores instantiated via factory functions, so that each test gets a fresh store without global state leaking.
35. As a developer, I want integration tests covering the full flow (form fill → validation → POST → SSE → heatmap render), so that the golden path is verified without mocking internal implementation details.

---

## Implementation Decisions

### Contracts

- `/contracts/entity.schema.json` and `/contracts/scenario.schema.json` — JSON Schema draft-07 with `x-` extension properties. Single source of truth for frontend (ajv 8) and C# backend (NJsonSchema). No field definitions live in either codebase.
- `/contracts/api.md` — defines all REST endpoints, request/response shapes, status codes, and the binary slice wire format. Fixed for Phase 1.
- The backend serves schema files at runtime: `GET /api/schema/entity`, `GET /api/schema/scenario`. No schema is bundled into the frontend build.
- `x-ui-component` values: `coordinate`, `range`, `matrix`, `numeric-or-file`. Fields without `x-ui-component` fall back to type-based rendering (`number` → `NumberField`, `string` → `StringField`, `string+enum` → `EnumField`, `boolean` → `BooleanField`).
- `x-show-if` supports `and`/`or` top-level operators with `{ field, op, value }` entries. Ops: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`. Field references are scoped to the same object.
- `x-unit` is display-only — a suffix shown next to the input, not included in the submitted value.

### Modules

**`evaluateShowIf(condition, formValues) → boolean`** — Pure function. No React dependencies. Takes the `x-show-if` object and current form values; returns whether the field should be shown.

**`SliceParser(buffer: ArrayBuffer) → SliceResult`** — Pure function. Validates the 56-byte magic/version header, returns `{ width, height, minVal, maxVal, bounds: { west, south, east, north }, data: Float32Array }`. Throws a typed `SliceParseError` on malformed input.

**`SchemaFormRenderer`** — Generic React component. Props: `schema`, `control`, `watch`. Iterates `schema.properties` in key order, evaluates `x-show-if` per field, mounts the correct field renderer. No hardcoded field names.

**Field renderers** — One component per widget type: `NumberField`, `StringField`, `EnumField`, `BooleanField`, `FileField`, `CoordinateField`, `RangeField`, `MatrixField`, `ValueOrFileField`. Each receives `name`, `label`, schema-level props, and react-hook-form `control`. Each registers via `Controller`.

**`CoordinateField`** — Bidirectional sync via Zustand `mapStore`. Form position change → `mapStore.setMarker`. Map marker drag → react-hook-form `setValue`.

**Map component** — MapLibre GL JS 4 via react-map-gl v7. Offline vector tiles via PMTiles: the `pmtiles` protocol handler is registered once at app initialisation (`maplibregl.addProtocol('pmtiles', ...)`); the MapLibre style JSON at `/style.json` references `pmtiles:///tiles/tiles.pmtiles` as its tile source, `/fonts/{fontstack}/{range}.pbf` for glyphs, and `/sprites/sprite` for sprites — all served from `frontend/public/` by Vite's static middleware. No backend and no external CDN required. Entity markers as `<Marker>` (draggable). Radius circles as a GeoJSON `fill` layer, updated reactively from `mapStore`.

**Heatmap layer** — Custom Deck.gl layer. Uploads `Float32Array` into a WebGL R32F texture. GLSL fragment shader applies a hardcoded linear color ramp (NaN → transparent, min → black, max → yellow). Georeferenced via `bounds` from the slice header.

**`HeightSlider`** — Range input + numeric text input kept in sync. On change: fetch `GET /api/scenarios/{id}/runs/{run_id}/slices/{height}` → parse with `SliceParser` → push to heatmap layer. Ring buffer: 5-slot circular buffer, prefetches ±2 adjacent levels in background. Buffer size controlled by a single constant.

**SSE client** — Thin `EventSource` wrapper. Opened immediately after scenario POST (receives `scenario_id` and `job_id` from response). Dispatches events into `jobStore`. Closed on `done` or `error`. No reconnection logic in Phase 1.

**Zustand stores**:
- `mapStore` — `markers: { [entityId]: { lat, lon } }`, `scenarioBounds`
- `jobStore` — `jobId`, `scenarioId`, `runId`, `status: idle | running | done | error`, `progressMessage`
- `uiStore` — `heightValue`, `panelOpen`

**Save/Discard modal** — Shown when the user triggers a re-run with an unsaved run in `jobStore`. Two actions: "Save & Re-run" (POST `/save` with `{ name }`, then submit new run) or "Discard & Re-run" (DELETE run, then submit new run). "Cancel" closes with no action.

### Data Flow

- Schema fetched on app mount via SWR (cached). Forms render only after schema resolves.
- Scenario form: `useForm` + ajv 8 resolver (`@hookform/resolvers/ajv`). Entity list: `useFieldArray`.
- Submit: `POST /api/scenarios` → `{ scenario_id, job_id }` → stored in `jobStore` → open `EventSource` to `/api/scenarios/{scenario_id}/jobs/{job_id}/events`.
- SSE `done` event → fetch default height slice → render heatmap.

### Layout

Hardcoded shell: left sidebar (scenario panel, full height) + right full-height map. Height slider is a bottom overlay on the map. Layout is not schema-driven.

---

## Testing Decisions

**What makes a good test**: Tests verify external behavior — inputs in, observable outputs out. No testing of internal state, private methods, or implementation details. A test must survive a refactor that preserves behavior.

**Modules with tests:**

- `evaluateShowIf` — unit tests. Input: condition objects + form value objects. Output: boolean. No mocking. Covers `and`/`or`, all six ops, missing fields, nested objects.
- `SliceParser` — unit tests. Input: `ArrayBuffer` fixtures (valid data, wrong magic, truncated buffer, zero-size grid, NaN cells). Output: parsed result or `SliceParseError`.
- `SchemaFormRenderer` + field renderers — unit tests with React Testing Library. Render with fixture schemas; assert correct field types rendered, `x-show-if` hides/shows fields live, validation errors appear on submit, `numeric-or-file` toggle works.
- Scenario form → submit → SSE → heatmap — integration tests. MSW mocks the HTTP layer. Fill the form, submit, simulate SSE events, assert heatmap layer receives correct `Float32Array` and bounds. Tests the wiring between `SchemaFormRenderer`, `jobStore`, `HeightSlider`, and `SliceParser` without mocking any of those modules internally.

**Prior art**: No existing tests in this codebase — these are the first.

---

## Out of Scope

- Backend implementation (FastAPI or C#) — separate PRD
- Color scale UI (configurable colors, dBm thresholds, stop count) — Phase 2+
- PMTiles vector tile serving — Phase 2+ (Phase 1 uses MBTiles raster served from the backend)
- Real terrain data (Copernicus COG, rasterio, pyproj) — Phase 2+
- Real MATLAB MCR integration — Phase 2+
- Authentication — not planned for Phase 1
- 3D terrain visualization (Cesium.js) — Phase 3+
- Remote MATLAB compute server — Phase 3+
- Side-by-side comparison of saved runs — Phase 2+
- Docker-compose full stack — Phase 3+
- Satellite/raster imagery — deferred

---

## Further Notes

- The frontend must remain backend-language-agnostic. All validation derives from the served JSON Schema; no field definitions are hardcoded in frontend code.
- The C# backend must be able to serve `/contracts/` schema files and validate against them using NJsonSchema without any frontend changes.
- The binary slice wire format (56-byte header + `Float32Array`) is defined in `contracts/api.md` and fixed for Phase 1. Changes require parallel updates to `SliceParser` and the API contract.
- The map must work with no internet connection. All tile requests go to the local backend (`/api/tiles/{z}/{x}/{y}.png`), which serves a pre-downloaded MBTiles file. No external tile CDN is used at any point, including during development.
- The PMTiles vector migration expected in Phase 2 must not require changes to the heatmap layer or form system — only the tile URL and source type in the Map component change.
- The ring-buffer size (±2 levels) is controlled by a single constant — not scattered through fetch logic — so it can be tuned without refactoring.
