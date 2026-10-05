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
  "angular_resolution": 0.1,
  "grid_cell_size": 100,
  "terrain_enabled": true,
  "combination_method": "max",
  "entities": [ ...1–10 entity objects... ]
}
```

**Response `201`**
```json
{
  "scenario_id": "uuid",
  "job_id": "uuid"
}
```

**Response `422`** — validation error
```json
{
  "detail": [
    { "field": "string", "message": "string" }
  ]
}
```

---

## Job Endpoints

### `GET /api/scenarios/{scenario_id}/jobs/{job_id}/events`

SSE stream for job progress. Client opens with `EventSource`. Connection closes on `done` or `error` event.

**Event types:**

`progress`
```json
{ "message": "string", "percent": 0–100 }
```

`done`
```json
{ "run_id": "uuid" }
```

`error`
```json
{ "message": "string" }
```

---

## Run Endpoints

### `GET /api/scenarios/{scenario_id}/runs/{run_id}/slices/{height_m}`

Fetch a single height slice of the propagation output.

- `height_m` — height in metres (integer or float, must fall within the scenario's `height_range`)

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

```json
{
  "error": "string",
  "detail": "string | null"
}
```
