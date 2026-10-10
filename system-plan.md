# Wave Propagation Simulator — System Plan

## Background

Full rewrite of a Unity/.NET 4.8 monolith POC. The pain was Unity — a game engine is
the wrong host for a simulation/analysis platform. This rewrite moves to a proper
web stack with clear service boundaries.

---

## Project Goal

A full-stack platform for simulating and visualizing how waves propagate across
geographic terrain. The wave physics model is generic/abstract (pluggable — not
tied to RF, acoustic, or seismic specifically). Target users: military/defense,
researchers, telecom.

---

## Technology Stack (All Decided)

### Infrastructure


| Concern          | Decision                                       |
| ---------------- | ---------------------------------------------- |
| Containerization | Docker-compose, Linux containers               |
| Deployment modes | Online and offline/air-gapped                  |
| Repo structure   | Monorepo (frontend, backend, infra, contracts) |
| Auth             | None for Phase 1                               |


### Backend

> Python/FastAPI only, per `research/backend-language/research.md` — no parallel implementation in another language (the earlier C# track was dropped; see PRD #23). The JSON Schema contracts in `/contracts/` are the source of truth; the backend validates directly against them.

| Concern              | Decision                                            |
| -------------------- | --------------------------------------------------- |
| Language / framework | Python 3.11+ / FastAPI (ASGI, uvicorn)              |
| PostgreSQL driver    | asyncpg                                             |
| Geodesic math        | pyproj (PROJ C library), numpy                      |
| Raster terrain I/O   | rasterio (GDAL C library)                           |
| Array file I/O       | h5py (HDF5)                                         |
| Run queue            | PostgreSQL `FOR UPDATE SKIP LOCKED`                 |
| Run notifications    | SSE — FastAPI `StreamingResponse` + async generator; pg `NOTIFY` + status snapshot on connect |
| Request validation   | `jsonschema` directly against `contracts/*.schema.json` |
| MATLAB invocation    | Callable function with parameters, one call per entity, inside a killable child process (see *Engine Interface*) |
| MATLAB data exchange | Input: function arguments. Output: HDF5 written by MATLAB |
| Entity parallelism   | `ProcessPoolExecutor` over entities                 |
| Container base image | `ghcr.io/osgeo/gdal:ubuntu-small-latest`            |


### Computation / MATLAB


| Concern             | Decision                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------ |
| Invocation method   | Callable function with parameters, one call per entity, run inside a killable child process (mechanism: Q-M6). MATLAB Engine API itself is incompatible with MCR |
| Input data          | Every scenario + entity parameter, plus `heights` [H], `azimuths` [A], `distances` [D] m, `terrain` [A×D] m above sea level — see *Engine Interface* |
| Output format       | Received power (dBm) `[H×D×A]`, written by MATLAB to HDF5, `ChunkSize=[1, D, A]`, float32; MATLAB returns success/failure |
| Output dataset path | `/propagation`; root attributes: `entity_id`, `scenario_id`, `height_min_m`, `height_max_m`, `height_step_m` |
| HDF5 writer         | MATLAB writes the output file (path given by the worker), with the chunking above                            |
| Write pattern       | Per height: write the slice, then set `/complete[h]` (see *Engine Interface*)                                |
| MCR licensing       | Free, no license server, air-gapped-capable                                                                  |
| Engine abstraction  | One engine interface: fake engine, local MATLAB call, later remote REST (see *Engine Interface*)                        |
| Antenna gain        | Not computed by the engine — applied by the backend per slice request                                        |


### Data Storage


| Concern                  | Decision                                                                |
| ------------------------ | ----------------------------------------------------------------------- |
| Metadata / app data      | PostgreSQL                                                              |
| Matrix storage format    | HDF5                                                                    |
| Matrix chunking          | `ChunkSize = [1, D, A]` (one chunk = one height slice)                  |
| Matrix dtype             | float32 (single precision)                                              |
| Matrix layout            | Per-entity files; combined output computed on-the-fly at serve time     |
| Terrain data             | Copernicus GLO-30 (NASADEM as fallback)                                 |
| Terrain tile format      | Cloud-Optimized GeoTIFF (COG), 1°×1° tiles                              |
| Terrain access pattern   | GDAL VRT mosaic over pre-downloaded tiles, rebuilt at container startup |
| Typical entity file size | ~86 GB (3,000 slices × 2,000 distance × 3,600 angles × 4 bytes)         |


### Frontend

See `frontend-plan.md` for component structure, form rendering, and color scale details.

| Concern           | Decision                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------ |
| Framework         | React 19 + Vite 6 + TypeScript 5                                                           |
| Map library       | MapLibre GL JS 4 via react-map-gl v7+                                                      |
| Map tile format   | PMTiles (vector MVT) served from backend static files                                      |
| Tile generation   | Planetiler (from OSM PBF) or Protomaps pre-built extract                                   |
| Heatmap layer     | Custom Deck.gl layer — R32F texture + GLSL fragment shader                                 |
| Color ramp        | User-defined min/max colors + dBm thresholds per stop (2–20); GPU-only (shader uniforms)  |
| Form management   | react-hook-form 7 + ajv 8; forms schema-driven from `/contracts` (see `contracts.md`)     |
| State management  | Zustand 5                                                                                  |
| SSE client        | Browser-native `EventSource`                                                               |


### Heatmap Slice Delivery


| Concern                  | Decision                                                                          |
| ------------------------ | --------------------------------------------------------------------------------- |
| Wire format              | ~56-byte binary header + raw `Float32Array` body                                  |
| Header fields            | magic, version, width, height, min_val, max_val, west/south/east/north (float64)  |
| Transport compression    | HTTP gzip (server middleware) — ~30–50% size reduction on propagation data        |
| Rendering                | Custom Deck.gl R32F texture from day one; no BitmapLayer phase                    |
| Polar → Cartesian        | `scipy.ndimage.map_coordinates(order=1)` — bilinear, no overshoot                 |
| Coordinate arrays        | Computed on a run's first slice request, cached in memory for the active run; not stored |
| Rasterization timing     | On-the-fly per request, parallelized over entities via `ProcessPoolExecutor`      |
| Multi-entity combination | Element-wise max (default), applied server-side before serving                    |


### Scenario Parameters


| Concern                    | Decision                                                    |
| -------------------------- | ----------------------------------------------------------- |
| Angular resolution default | 0.1°                                                        |
| Angular resolution range   | 0.01° – 2.0° (user-overridable)                             |
| Output grid cell size      | 100 m × 100 m (user-overridable)                            |
| Height axis                | Variable resolution under consideration — decision deferred |


---

## Scenario Model

See `contracts.md` for full field schema. Summary:

- **Name** (string), **1–10 entities**, height range + step, height reference (above ground or above sea level — user's choice), angular resolution (default 0.1°, range 0.01–2.0°), distance step (default 100 m, min 10 m), grid cell size (default 100m), terrain toggle, combination method (max/mean/sum)
- **Entity**: label, position (lat/lon), frequency, power, azimuth, vertical beam width, tilt, antenna_height, radius (km)
- **Per-entity radius**: each entity has its own AOI circle. Combined output = bounding box of all circles. Cells outside an entity's circle = null. Combination applied cell-by-cell per height level.
- **Antenna**: covers the full 360° horizontally; `beam_width` is the **vertical** opening, `tilt` the elevation of the beam axis. Backend always generates full 360° rays. **The engine computes without any antenna gain**; the vertical gain pattern is applied by the backend each time a slice is requested (see *Polar → Cartesian Rasterization*). `azimuth` is kept on the entity.
- **Frequency and power**: a single number, or an uploaded per-angle table (`POST /api/files`): at entity angle *x*, value *y*.
- Angular resolution: `vector_count = 360 / step_angle` (no cap). At 0.1° = 3,600 vectors.

### Runs

A **run** is one computation of a scenario: queued → running → done / failed, with its progress
and its result. There is no separate "job" concept — the queue holds runs.

- Each scenario has at most **one active (unsaved) run**
- If the user reruns without saving, the old result is shown with a confirmation dialog before deletion (HDF5 file is large — must not silently discard)
- User can **explicitly save** a run with a name → permanently stored, never auto-deleted
- Named saves allow comparison across parameter variations
- **No automatic retry** of a failed run.
- **Per-run store**: the scenario snapshot, entity parameters, angles, distances and terrain are
  saved in a **separate HDF5 file per run** (plus MATLAB's output files in the same folder), not
  in PostgreSQL. A slice request reads what it needs from it. See *Per-Run Store*.
- How re-running works, and which changes need a recompute: TBD-2.

---

## Request Validation (API, before queueing)

`POST /api/scenarios` returns `201 {scenario_id, run_id}` in well under a second. Heavy work is
done in the worker. Before queueing, the API rejects with `422` (single error format, see
`contracts/api.md`):

1. **Schema** — body validated directly against `contracts/*.schema.json` (`jsonschema` library;
   no field definitions duplicated in Python).
2. **Checks the schema can't express** — height range min < max; every referenced `file_id`
   exists; terrain tiles cover every entity's radius when terrain is enabled (manifest lookup,
   no raster reads); estimated output size (`entities × H × D × A × 4 B`) fits free disk.

Then one transaction: insert scenario + run (`queued`), `NOTIFY`.

---

## Backend Preprocessing Pipeline

Runs **in the worker**, after the run is claimed and before the engine is invoked. Per entity:

1. **Ray generation** — generate azimuths: `360 / step_angle` (e.g. 3,600 at 0.1°)
2. **Terrain profile** — for each azimuth, march outward in `distance_step` steps (user-selected, min 10 m) to entity radius:
   - `pyproj.Geod.fwd` (vectorized) → lat/lon per step
   - `rasterio` window read on GDAL VRT mosaic → terrain height per step
   - Terrain disabled (flat-ground mode): all heights 0, no raster reads
3. **Engine input** — per entity: `distances` [D] in **metres** (shared by all rays) and `terrain`
   [A × D] in **metres above sea level**; each ray's terrain row has the same length as
   `distances`. Copernicus heights are already above sea level (EGM2008), so no datum conversion.
   Handed to the engine with every other parameter — see *Engine Interface*.
4. Save the scenario snapshot, entity parameters, azimuths, distances and terrain profiles to the
   run's `params.h5` (see *Per-Run Store*).

Coordinate arrays (`r_coords` + `theta_coords`, `[W_grid × H_grid]`, mapping each map cell to
polar coordinates in the entity frame) are **not** computed here: the slice endpoint computes them
on the first slice request and keeps them in memory.

**Scale**: 0.1° step + 200 km radius at 100 m = 3,600 vectors × 2,000 steps = 7.2M terrain
queries/entity; 10 entities → 72M. Measured on the Israel tiles (`terrain/README.md`): ~1.5 s per
7.2M points after a one-off ~9 s tile load. **At the 10 m minimum step this is 10× more** (20,000
steps, 72M points/entity) and the output matrix grows 10× too — the disk-size check above matters.

---

## Polar → Cartesian Rasterization

The engine outputs `[Height × Distance × Angle]` per entity. Slice endpoint serves a Cartesian grid.
On-the-fly at request time:

1. Read polar slice `[D × A]` from HDF5 (h5py hyperslab)
2. Read from the run's `params.h5` what the gain needs: terrain `[A × D]`, distances, entity
   antenna height, ground elevation, beam width, tilt, height reference. Coordinate arrays come
   from the in-memory cache (computed on the run's first slice request).
3. **Apply vertical antenna gain** (cheap, per entity):
   - elevation angle from antenna to each `(distance, height)` point:
     `φ = atan2(point_altitude − antenna_altitude, distance)`, where
     `antenna_altitude = terrain_at_entity + antenna_height` and
     `point_altitude = height` (sea-level reference) or `terrain + height` (ground reference)
   - gain (dB) = `−min(12 · ((φ − tilt) / beam_width)², 30)` — the 3GPP TR 38.901 vertical
     pattern, used as a **placeholder, to be checked** (TBD-8); no `beam_width` → no gain
   - add gain to the slice
4. `scipy.ndimage.map_coordinates(slice, [r_coords, theta_coords], order=1)` → Cartesian `[W × H_grid]` float32
5. All entities in parallel (`ProcessPoolExecutor`)
6. Element-wise combination (max by default); cells outside entity radius → null
7. Serialize: 56-byte header + `Float32Array` → HTTP response

**Target**: ~0.5–1.5 s for 4000×4000 grid, 10 entities, 8 cores. 1–3 s end-to-end.

---

## Computation Flow

```
API process
  User submits scenario
  → Validate (schema + extra checks)                       → 422 on failure
  → Insert scenario + run (queued), NOTIFY; return 201 {scenario_id, run_id}
  → Client opens SSE: GET .../runs/{run_id}/events

Worker process (single engine run at a time — the engine uses all CPU cores)
  → Claim run (PostgreSQL FOR UPDATE SKIP LOCKED) → running
  → phase "terrain" (0–10 %): rays + terrain profiles per entity, saved to the run's
    params.h5
  → phase "engine" (10–95 %): invoke the engine (1–30 min for MATLAB)
  → phase "finalizing" (95–100 %): verify per-entity HDF5 outputs, write run metadata
  → done — or failed with {error code, message, retryable}; no automatic retry

Progress to the browser (each step above)
  → Worker updates the run row (status, phase, percent, message) and sends pg NOTIFY
  → SSE endpoint: on connect sends the current run row as a `status` event,
    then forwards NOTIFYs; closes on done/error

Viewing
  → Height slider fetches slices: read polar slice, apply gain, rasterize, combine, return binary
  → User prompted to save or discard (if unsaved, old run deleted with confirmation)
```

**MATLAB location**: Configurable — same machine (child process) or separate compute
server (REST wrapper). Abstracted behind one engine interface (fake engine first, MATLAB later);
switching requires only a config change. Exact interface: TBD-3.

---

## Per-Run Store (#45)

Everything a run produced, and everything slice-time processing needs, lives in **one folder per
run**. PostgreSQL keeps only the small, queryable state.

```
runs/<run_id>/
  params.h5       written once by the worker during the "terrain" phase, then read-only
    /             attrs: store_version, scenario_id, run_id, created_at,
                         scenario (the exact submitted scenario JSON — the run's snapshot)
    /heights      [H] m
    /grid         attrs: west, south, east, north, width, height, cell_size_m
    /entities/<n> attrs: every entity field + ground_elevation
                  datasets: azimuths [A], distances [D], terrain [A × D] float32,
                            frequency [A] / power [A] when they came from a per-angle file
  entity_<n>.h5   written by MATLAB (see Engine Interface): received power + /complete flags
```

| Decision | Choice |
|---|---|
| Technology | **One HDF5 file per run** (`params.h5`) — mostly large numeric arrays; same format and library as the engine output. This is the "separate database per run". |
| Scope | **Per run**, never per scenario: a run's snapshot must not change when the scenario is edited later. Sharing data between runs is #50's job. |
| PostgreSQL holds | scenarios (current config), runs (id, scenario, status, phase, percent, message, error, saved name, timestamps, folder path). **No arrays.** |
| Coordinate arrays (polar → map grid) | **Not stored.** Computed on the first slice request for a run and kept in memory for the active run (~128 MB per entity at a 4000 × 4000 grid). |
| Self-contained | The folder alone fully describes the result: it can be copied to another machine and viewed there. |
| Writing | Worker writes `params.h5` under a temporary name and renames it when complete, so a crash never leaves a half-written store that looks valid. |
| Save | Nothing moves; the run row is marked saved → never deleted automatically. |
| Discard | Delete the folder and the run row. |
| Failed / cancelled run | **Folder deleted immediately** (may change when #50 designs reuse). |

**Slice request** reads from the store: scenario snapshot (height reference, combination
method), per-entity antenna parameters, ground elevation, distances and terrain (for the gain),
plus one height chunk from each `entity_<n>.h5`.

**Known risk.** The gain needs each entity's whole terrain array on every slider move: ~290 MB
for 10 entities at the 100 m step (fine from memory/OS cache) but **~2.9 GB at the 10 m step**.
Measure when #31/#33 exist; options then include caching the active run's terrain in memory or
limiting the 10 m step to smaller radii.

---

## Engine Interface (#44 — signed off 2026-10-10)

One interface, implemented by the fake engine (first) and the MATLAB engine (#37). The engine
knows nothing about the database, SSE or HTTP — the worker translates.

```
Worker                                    MATLAB function (fake engine: same contract)
calls function(all params) per entity ──▶ computes received power [height × distance × angle]
                                          writes it to an HDF5 file
                                    ◀──── returns success | failure
reads the slices it needs from HDF5 itself (any time later, e.g. per slider move)
```

Decided:
- **Every parameter goes in** (below).
- **One call per entity.** A scenario with N entities means N calls, run one after another.
- **The input is a function call with parameters**, not an input file.
- **The output is a 3D matrix of received power** in dBm, i.e. transmit power minus path loss,
  shape `[H × D × A]`.
- **MATLAB writes the matrix to HDF5 and returns success or failure.** The backend never gets the
  matrix through the call; it reads the slices it needs from the file itself.

> ⚠️ Departs from `research/matlab-mcr/research.md` ("subprocess only", "HDF5 input file").
> The research ruled out the MATLAB *Engine API* because it
> doesn't run on the free MCR. A callable function is still possible on MCR via a package built
> with MATLAB Compiler SDK (e.g. a Python package). Q-M6 confirms which mechanism.

### Inputs — every parameter goes to the engine

Nothing is filtered out: the engine receives every scenario and entity parameter, plus the arrays
the worker derives. The engine uses what it needs; new physics (e.g. TBD-1) never needs an
interface change.

**Scenario parameters** (all fields of `scenario.schema.json`):

| Field | Unit | Note |
|---|---|---|
| scenario id, run id, name | — | for logging and file naming |
| `heights` | m | **list of heights** `[H]`, expanded from `height_range` + `height_step` |
| `height_reference` | `ground` \| `sea_level` | what `heights` are measured from |
| `angular_resolution` | ° | |
| `distance_step` | m | |
| `grid_cell_size` | m | |
| `terrain_enabled` | bool | |
| `combination_method` | `max` \| `mean` \| `sum` | |

**Per entity** (all fields of `entity.schema.json` + derived arrays):

| Field | Unit | Note |
|---|---|---|
| index, `label` | — | |
| `position` | lat/lon ° (WGS84) | |
| `ground_elevation` | m above sea level | terrain at the antenna site (derived) |
| `frequency` | MHz | scalar, or per-ray array `[A]` resolved from the uploaded per-angle file |
| `power` | dBm | scalar, or per-ray array `[A]` resolved from the uploaded per-angle file |
| `azimuth` | ° | |
| `beam_width` | ° | vertical opening (may be absent = isotropic) |
| `tilt` | ° | |
| `antenna_height` | m | |
| `radius` | km | |
| `azimuths` | ° | **list of angles** `[A]` (derived: 0 … 360 by `angular_resolution`) |
| `distances` | m | **list of steps** `[D]` (derived: `distance_step` … `radius`), shared by all rays |
| `terrain` | m above sea level | `[A × D]` — one height per step per ray; all 0 when terrain disabled |

Each call receives the scenario parameters plus **one** entity's parameters and arrays, as
function arguments. Large arrays (`terrain` `[A × D]`) are passed as numeric arrays. The call also
receives the path of the HDF5 file to write.

### Output

Written **by MATLAB**, one HDF5 file per entity (path given by the worker):

- `/propagation` `[H × D × A]` float32 — **received power, dBm**; chunk `[1, D, A]` (one height
  per chunk) so the backend reads one height slice with one chunk read; pre-filled with NaN.
- `/complete` bool `[H]` — set for a height only after that height is fully written. Cancel
  (#51) and reuse (#50) rely on it.

Return value: success, or failure with an error code and message.
The backend later reads slices directly from these files (see *Polar → Cartesian Rasterization*).

### Progress, cancel, errors

- **Progress**: per entity call, plus within a call by counting the heights already flagged in
  `/complete` (or a small progress file, if reading HDF5 while MATLAB writes proves unsafe —
  Q-M7). Worker maps it into the 10–95 % band.
- **Cancel**: the worker makes each MATLAB call inside a dedicated child process, so cancel =
  kill that process group (incl. parallel-pool workers) — a function call can't be interrupted
  otherwise. Fake engine: cooperative stop. Completed heights stay flagged in `/complete`.
- **Errors**: `invalid_input` (not retryable), `engine_crash` (retryable), `timeout` (retryable),
  `out_of_disk` (not retryable), each with a message and the last ~50 lines of the engine log.
- **Timeout**: configurable, default 40 min per engine call.
- **Concurrency**: one engine call at a time per machine (MATLAB uses all cores).

### Fake engine

Deterministic, believable output from the inputs (simple distance/frequency loss with terrain
shadowing), so tests can assert exact values; configurable delay so progress and cancel are
visible; can be told to fail with a given error code so error paths are testable. Writes exactly
the output format above.

### Questions for the MATLAB developer (fake engine uses the default until answered)

| # | Question | Default |
|---|---|---|
| Q-M2 | With `height_reference = sea_level`, does MATLAB take sea-level heights directly, or must we convert to above-ground per step? | MATLAB receives `heights` + `height_reference` and handles both |
| Q-M5 | Is the model deterministic (same input → same output)? Needed by #50. | assume yes |
| Q-M6 | How is the function made callable on the free MCR: MATLAB Compiler SDK package (e.g. Python), or a compiled executable taking arguments? Exact function signature and argument types. | Compiler SDK Python package |
| Q-M7 | Can MATLAB write `/complete` per height as it goes, and is it safe for us to read it meanwhile (HDF5 single-writer/multi-reader)? Otherwise a separate progress file. | per-height `/complete`, read only after the call returns; progress via a small progress file |
| Q-M8 | Startup cost of one call (MCR init) — with one call per entity, ×10 entities. | measure |

Answered by the maintainer: Q-M1 (received power, dBm), Q-M3 (one call per entity), Q-M4 (no
input file — function call with parameters). Also still open from *Deferred Decisions → MATLAB
Interface*: MCR version, DSM vs bare-earth terrain.

---

## TBD — Features To Design Separately

Agreed to exist, but deliberately not designed yet. Each needs its own design pass (a HITL issue) before an
agent implements it.

| # | Topic | What's open |
|---|---|---|
| TBD-1 (#49) | **Beam width and recalculation** | Beam width is part of the recalculation logic (TBD-2): which level a beam-width change triggers, and whether beam width can be edited after a run. Must be reconciled with "gain applied at slice time". |
| TBD-2 (#43) | **Re-run and recalculation levels** | Three levels of change: (1) needs a **recompute** by the engine; (2) needs the **slice re-fetched** and reprocessed server-side; (3) can be applied **in the browser** on the already-loaded slice. Classify every field into a level. Re-run endpoint, and how the "one unsaved run per scenario" conflict is enforced. |
| TBD-3 (#44) | **Engine interface** | **Signed off** — see *Engine Interface*. Decided: every parameter goes in; one call per entity; function call with parameters; output = received-power matrix written by MATLAB to HDF5. Open only: MATLAB-developer questions Q-M2, Q-M5–Q-M8 (fake engine uses defaults). |
| TBD-4 (#50) | **Reusing what a failed/cancelled run left** | Reuse terrain profiles, coordinate arrays and completed engine output from an earlier run when still valid. Open: how validity is checked, disk budget and eviction, whether the MATLAB model is deterministic. |
| TBD-5 (#51) | **Cancel from the browser** | Cancel button next to the progress bar. Open: keep partial results (user's choice?) vs discard; behaviour when queued vs running; killing MATLAB's whole process tree. |
| TBD-6 (#45) | **Per-run parameter store format** | **Decided** — see *Per-Run Store*: one HDF5 file per run, per run (not per scenario), coordinate arrays computed on demand, failed/cancelled folders deleted. |
| TBD-7 (#46) | **Per-angle frequency/power file** | Decided: a table "at entity angle *x*, value *y*", uploaded via `POST /api/files`. Open: file format/columns, whether angles are relative to `azimuth` or true north, interpolation between angles, required coverage of 0–360°. |
| TBD-8 (#47) | **Vertical gain formula** | 3GPP TR 38.901 vertical pattern used as a placeholder — check with the domain expert. Also confirm `antenna_height` is above ground. |
| TBD-9 (#48) | **Database migrations** | How table changes reach an existing database as the app evolves. Proposal: numbered plain-SQL files (`001_create_tables.sql`, `002_…`) applied in order by a small script that records what's applied; vs a library such as Alembic. |

---

## Visualization

- **Phase 1–2**: 2D heatmap overlaid on flat map (custom Deck.gl R32F layer)
- **Height scrubbing**: slider + direct numeric input; ring-buffer prefetch of ±2 adjacent levels
- **Color ramp**: user-defined min/max colors + dBm thresholds (2–20 stops); adjusting updates shader uniforms only — no re-fetch
- **Phase 3+**: 3D terrain visualization (Cesium.js) — not now

---

## Deferred Decisions (Post-Prototype)

These are known unknowns. They will be resolved after the Phase 1 prototype
demonstrates the end-to-end thin slice.

### MATLAB Interface

- Exact CLI argument signature for the compiled MCR executable
- HDF5 input schema: dataset names, shapes, dtypes for entity parameters
- Progress reporting: does the executable emit parseable stdout lines (e.g. `PROGRESS:42`)?
- Partial result signaling: how does the backend identify which height slices are complete?
- MCR version (must match the compiled executable exactly)
- Single-worker enforcement: enforced in PostgreSQL queue, REST wrapper, or both?
- Crash recovery: re-run from scratch or resume from partial results?

### Terrain Pipeline

- Geoid correction: does MATLAB expect AMSL heights (DEM-native) or HAE (GPS-derived)?
Silent mismatch produces incorrect terrain profiles.
- Canopy vs bare earth: Copernicus DEM is a DSM (measures vegetation top), not DTM
(bare earth). Which does the propagation model expect?
- Polar edge tiles: confirm tile naming and manifest structure above ~80° latitude
- VRT rebuild strategy: at every container startup (recommended) vs only on tile set change

### Deployment

- Geographic scope: which regions constitute the operational area? Determines PMTiles extract size
- Maximum map zoom level needed: zoom 14 (neighborhood) vs zoom 15+ (street/building)
- Remote compute server OS (Linux vs Windows — affects process group kill strategy)
- File staging for remote MATLAB deployment: NFS mount vs object store vs SCP

### Frontend / UX

- Satellite / raster imagery requirement (if needed, data pipeline is significantly larger)
- Custom map styling requirements (color scheme, visible feature types)
- Map update cadence (how frequently does OSM tile data need refreshing)
- Axis alignment: is the output grid always north-up? (affects georeferencing in MapLibre)

### Performance Tuning

- Server-side LRU cache for rasterized Cartesian slices (avoids re-rasterization on rapid scrubbing)
- Memory budget for coordinate array cache (10 entities × ~128 MB = ~1.3 GB)
- Adaptive angular resolution: variable step size as function of range (finer at short range)
- Height axis variable resolution: non-uniform step sizes at altitude

---

## Development Phases

### Phase 1 — End-to-End Thin Slice

- React frontend with MapLibre GL JS map (PMTiles, local style)
- Entity placement + per-entity radius circle drawing (MapLibre Marker + GeoJSON fill layer)
- Scenario form (name, entities, signal params, height config, angular resolution,
no-terrain toggle) — react-hook-form + ajv
- FastAPI backend receives scenario, runs **stub preprocessing** (no real terrain),
pre-computes dummy coordinate arrays
- **Dummy MATLAB** — returns synthetic 3D matrix (random values) in correct HDF5 format
- HDF5 stored, metadata in PostgreSQL; coordinate arrays pre-computed
- SSE push on completion (PostgreSQL LISTEN/NOTIFY → FastAPI StreamingResponse)
- Frontend height slider → fetches binary slice → custom R32F Deck.gl layer renders heatmap
- User-adjustable color breakpoints (shader uniforms only)

### Phase 2 — Real Preprocessing + Persistence

- Real terrain data integration (offline Copernicus COG tiles, GDAL VRT, rasterio)
- Full vector generation + terrain sampling pipeline (pyproj + rasterio)
- MATLAB MCR integration (replace dummy subprocess)
- HDF5 slice reads serving real data
- Save/discard run flow with confirmation dialog

### Phase 3 — Polish + Infrastructure

- Offline tile serving (PMTiles pre-bundled for operational region)
- 3D terrain visualization (Cesium.js)
- Docker-compose full stack
- Remote MATLAB compute server (REST wrapper + `RemoteMcrWorker`)
- AWS / cloud deployment path

---

## Repo Structure

```
repo/
├── frontend/               # React 19 + Vite + TypeScript
│   ├── src/
│   │   ├── map/            # MapLibre + react-map-gl components
│   │   ├── heatmap/        # Custom Deck.gl R32F layer + GLSL shaders
│   │   ├── scenario/       # Form (react-hook-form + ajv), entity list
│   │   └── store/          # Zustand slices (scenario, runs, UI)
│   └── public/static/      # PMTiles file, fonts, sprites, style JSON
├── backend/
│   ├── api/                # FastAPI routes
│   ├── preprocessing/      # Ray generation, terrain sampling, coord array pre-computation
│   ├── worker/             # Run queue consumer, preprocessing + engine invocation
│   ├── hdf5/               # h5py slice reads, rasterization (map_coordinates)
│   └── db/                 # asyncpg, PostgreSQL schema, migrations
├── infra/
│   ├── docker-compose.yml
│   └── nginx/
├── contracts/              # JSON Schema files (source of truth — see contracts.md)
├── contracts.md            # Schema contract design
├── frontend-plan.md        # Frontend component structure and form rendering
└── system-plan.md          # This document
```
