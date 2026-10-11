import json
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.terrain import Box, RasterTerrain, TerrainCoverageError, terrain_profile
from tests.rasters import write_tile
from tests.test_pipeline_terrain import scenario

FIXTURES = Path(__file__).resolve().parents[2] / "terrain" / "fixtures"
FIXTURE_TIF = FIXTURES / "jerusalem_dead_sea.tif"
FIXTURE = json.loads((FIXTURES / "jerusalem_dead_sea.json").read_text(encoding="utf-8"))
POINTS = {p["name"]: p for p in FIXTURE["reference_points"]}


def _terrain(sea: list[Box] | None = None) -> RasterTerrain:
    return RasterTerrain([FIXTURE_TIF], sea or [])


def test_elevations_match_the_source_tile_at_reference_points() -> None:
    lats = np.array([p["lat"] for p in POINTS.values()])
    lons = np.array([p["lon"] for p in POINTS.values()])

    got = _terrain().elevations(lats, lons)

    expected = [p["elevation_m"] for p in POINTS.values()]
    assert got.tolist() == pytest.approx(expected, abs=1e-3)


def test_the_last_pixel_column_is_inside_and_one_step_beyond_is_not() -> None:
    edge = POINTS["lowest pixel"]  # col 1079 of 1080: the east edge
    terrain = _terrain()

    inside = terrain.elevations(np.array([edge["lat"]]), np.array([edge["lon"]]))
    with pytest.raises(TerrainCoverageError) as outside:
        terrain.elevations(np.array([edge["lat"]]), np.array([FIXTURE["bounds"]["east"] + 1e-4]))

    assert inside[0] == pytest.approx(-427.0)
    assert "31.75056, 35.49996" in str(outside.value)


def test_sea_areas_outside_the_tiles_read_as_zero() -> None:
    sea = Box(west=35.5, south=31.7, east=36.0, north=31.8)
    terrain = _terrain(sea=[sea])

    got = terrain.elevations(np.array([31.75, 31.75]), np.array([35.6, 35.3]))

    assert got[0] == 0.0
    assert got[1] != 0.0


def test_a_ray_from_jerusalem_east_descends_to_the_dead_sea() -> None:
    start = POINTS["Jerusalem Old City"]
    distances = np.arange(1000.0, 24001.0, 1000.0)

    ground, profile = terrain_profile(
        _terrain(), start["lat"], start["lon"], np.array([90.0]), distances
    )

    assert ground == pytest.approx(start["elevation_m"], abs=1e-3)
    assert profile.shape == (1, distances.size)  # [A x D]
    assert profile[0, 0] > 500
    assert profile[0, -1] < -300  # the Dead Sea basin, below sea level


def test_coverage_reports_a_box_reaching_past_the_raster() -> None:
    b = FIXTURE["bounds"]
    terrain = _terrain()
    inside = Box(west=35.3, south=31.73, east=35.4, north=31.77)
    beyond = Box(west=35.3, south=31.73, east=35.6, north=31.77)

    assert terrain.uncovered(inside) is None
    reason = terrain.uncovered(beyond)
    assert reason is not None and "outside the terrain data" in reason
    assert terrain.uncovered(Box(b["west"] + 1e-6, b["south"] + 1e-6, 35.4, 31.77)) is None


def test_coverage_names_a_manifest_tile_that_was_never_downloaded(tmp_path: Path) -> None:
    manifest = {
        "tiles": [{"name": "Copernicus_DSM_COG_10_N31_00_E035_00_DEM"}],
        "missing_tiles": [{"name": "Copernicus_DSM_COG_10_N31_00_E034_00_DEM"}],
    }
    path = tmp_path / "manifest.json"
    path.write_text(json.dumps(manifest), encoding="utf-8")
    terrain = RasterTerrain.from_manifest(path, tmp_path / "terrain-cache")

    reason = terrain.uncovered(Box(west=35.2, south=31.2, east=35.3, north=31.3))
    sea = terrain.uncovered(Box(west=34.2, south=31.2, east=34.3, north=31.3))

    assert reason is not None and "terrain/fetch.py" in reason
    assert sea is None  # an unpublished (open sea) tile counts as covered, at 0 m


def test_a_scenario_reaching_past_the_terrain_is_rejected_before_queueing() -> None:
    # Validation runs before any database work, so no lifespan (and no DB) is needed here.
    app = create_app(Settings("postgresql://unused", Path("unused"), 0), terrain=_terrain())
    client = TestClient(app)

    res = client.post("/api/scenarios", json=scenario(True, radius_km=10))

    assert res.status_code == 422
    [field] = res.json()["fields"]
    assert field["field"] == "entities.0.radius"
    assert "outside the terrain data" in field["message"]


def test_tiles_whose_edges_differ_by_float_noise_leave_no_gap(tmp_path: Path) -> None:
    # Two 2x2 tiles stacked north-south; the lower one's top edge is 1e-12° below the upper
    # one's bottom edge, as happens with real neighbouring tiles.
    north = write_tile(tmp_path / "n.tif", 35.0, 32.0, 0.25, np.full((2, 2), 1, np.float32))
    south = write_tile(tmp_path / "s.tif", 35.0, 31.5 - 1e-12, 0.25, np.full((2, 2), 2, np.float32))
    terrain = RasterTerrain([north, south], [])

    assert terrain.uncovered(Box(35.1, 31.2, 35.4, 31.8)) is None
    assert terrain.elevations(np.array([31.5 - 5e-13]), np.array([35.2])).tolist() in ([1.0], [2.0])
