# REST API Contract

API contract between the frontend and backend (Python / FastAPI).
All request and response bodies are `application/json` unless noted.

---

## Schema Endpoints

### `GET /api/schema/entity`

Returns the entity JSON Schema.

**Response `200`**
```json
{ ...entity.schema.json contents... }
```

---

### `GET /api/schema/scenario`

Returns the scenario JSON Schema.

**Response `200`**
```json
{ ...scenario.schema.json contents... }
```

---

## Scenario Endpoints

### `POST /api/scenarios`

Submit a new scenario for computation.

**Request body** — must validate against `scenario.schema.json`:
```json
{
  "name": "string",
  "height_range": { "min": 0, "max": 1000 },
  "height_step": 10,
  "height_reference": "ground",
  "angular_resolution": 0.1,
  "distance_step": 100,
  "grid_cell_size": 100,
  "terrain_enabled": true,
  "combination_method": "max",
  "entities": [ ...1–10 entity objects... ]
}
```

Validates the scenario, stores it, and queues a **run** (one computation of the scenario).
Returns immediately; terrain preprocessing and the engine run in the worker.

**Response `201`**
```json
{
  "scenario_id": "uuid",
  "run_id": "uuid"
}
```

**Response `422`** — validation error (schema, or checks the schema can't express: height range
order, terrain coverage, unknown `file_id`, estimated output size vs free disk). See *Error format*.

### `GET /api/scenarios`

List scenarios, newest first.

**Response `200`**
```json
[ { "scenario_id": "uuid", "name": "string", "updated_at": "iso8601", "run_count": 2 } ]
```

---

### `GET /api/scenarios/{scenario_id}`

A scenario's current configuration and its runs.

**Response `200`**
```json
{
  "scenario_id": "uuid",
  "config": { ...scenario.schema.json object... },
  "runs": [
    { "run_id": "uuid", "status": "queued | running | done | failed", "saved_name": "string | null",
      "created_at": "iso8601", "finished_at": "iso8601 | null" }
  ]
}
```

**Response `404`** — scenario not found

---

### `POST /api/scenarios/{scenario_id}/runs`

Re-run a scenario after an **engine-level** change (`x-recalc: "engine"`, see `contracts.md`).
Body is the full edited configuration (validates against `scenario.schema.json`); it becomes the
scenario's current configuration and the new run's frozen snapshot.

Query: `discard_unsaved=true` — confirms the current unsaved run may be deleted.

**Response `201`**
```json
{ "run_id": "uuid" }
```

**Response `409`** — `error: "unsaved_run_exists"` with `run_id` of the unsaved run (the client
asks the user, then retries with `discard_unsaved=true`), or `error: "run_in_progress"` (a run is
queued/running — cancel it first).
**Response `422`** — validation error

---

## File Endpoints

### `POST /api/files`

Upload a per-angle table for a `numeric-or-file` field (`frequency`, `power`).
`multipart/form-data` with one `file` part. The server parses and validates it immediately and
stores it by content hash, so the same file uploaded twice gets the same `file_id`.
The entity field's string value is this `file_id`.

File format (columns, angle reference, interpolation): **TBD** — see `system-plan.md`.

**Response `201`**
```json
{ "file_id": "sha256 hex", "rows": 360, "angle_min": 0, "angle_max": 359 }
```

**Response `422`** — file could not be parsed. See *Error format*.

---

## Run Endpoints

A run is one computation of a scenario: its status, progress, and result.

### `GET /api/scenarios/{scenario_id}/runs/{run_id}/events`

SSE stream for run progress. Client opens with `EventSource`. Connection closes on `done` or
`error` event.

On connect, the server first sends one `status` event with the run's current state (so a client
that connects late or reconnects is never stuck), then forwards live events.

**Event types:**

`status` — sent once on connect
```json
{ "status": "queued | running | done | failed", "phase": "terrain | engine | finalizing | null", "percent": 0–100, "message": "string" }
```

`progress`
```json
{ "phase": "terrain | engine | finalizing", "message": "string", "percent": 0–100 }
```

`done`
```json
{}
```

`error`
```json
{ "error": "string (code)", "message": "string", "retryable": true }
```

### `GET /api/scenarios/{scenario_id}/runs/{run_id}/slices/{height_m}`

Fetch a single height slice of the propagation output.

- `height_m` — height in metres (integer or float, must fall within the scenario's `height_range`)
- Optional query parameters override **slice-level** settings (`x-recalc: "slice"`) without a
  new run: `combination_method`, `grid_cell_size`. When absent, the run's view settings apply,
  else the run's snapshot. Nothing derived from an override is stored.

**Response `200`** — `application/octet-stream`

Binary format:

| Offset | Size   | Type    | Field       | Notes                         |
|--------|--------|---------|-------------|-------------------------------|
| 0      | 4      | uint8×4 | magic       | `0x57 0x50 0x53 0x31` ("WPS1") |
| 4      | 2      | uint16  | version     | `1`                           |
| 6      | 4      | uint32  | width       | grid columns                  |
| 10     | 4      | uint32  | height      | grid rows                     |
| 14     | 4      | float32 | min_val     | minimum dBm in grid           |
| 18     | 4      | float32 | max_val     | maximum dBm in grid           |
| 22     | 8      | float64 | west        | bounding box west longitude   |
| 30     | 8      | float64 | south       | bounding box south latitude   |
| 38     | 8      | float64 | east        | bounding box east longitude   |
| 46     | 8      | float64 | north       | bounding box north latitude   |
| 54     | 2      | uint8×2 | reserved    | zero-padded                   |
| 56     | W×H×4 | float32 | data        | row-major, NaN = null cell    |

Total header size: **56 bytes**. Data follows immediately.

Null cells (outside any entity radius) are encoded as `NaN` — rendered as transparent by the shader.

**Response `404`** — scenario or run not found
**Response `422`** — height out of range

---

### `PUT /api/scenarios/{scenario_id}/runs/{run_id}/view`

Save the run's view settings — the slice-level and browser-level settings the user chose
(e.g. combination method, grid cell size, colour ramp, opacity). Only called after the user
confirms "save changes". Settings only; no derived data is ever stored.

**Request body**
```json
{ "combination_method": "max", "grid_cell_size": 100, "color_ramp": { ... }, "opacity": 0.8 }
```

**Response `200`** — the stored view settings
**Response `404`** — scenario or run not found

---

### `POST /api/scenarios/{scenario_id}/runs/{run_id}/save`

Permanently save a run under a user-provided name.

**Request body**
```json
{ "name": "string" }
```

**Response `200`**
```json
{ "run_id": "uuid", "name": "string" }
```

**Response `409`** — run already saved

---

### `DELETE /api/scenarios/{scenario_id}/runs/{run_id}`

Discard an unsaved run. Deletes the associated HDF5 file and metadata.

**Response `204`** — deleted

**Response `409`** — run is saved (saved runs cannot be deleted via this endpoint)

---

## Error format (all non-2xx responses)

One shape for every error, including validation:

```json
{
  "error": "string (machine-readable code, e.g. validation_failed, not_found)",
  "message": "string (human-readable)",
  "fields": [
    { "field": "entities.0.radius", "message": "must be >= 0.1" }
  ]
}
```

`fields` is present only for validation errors (`422`). `field` is the dotted path into the
request body.
