from pathlib import Path

import numpy as np
import pytest

from app.engine import EngineFailure, FakeEngine
from app.h5 import Floats, read_params
from app.pipeline import run_pipeline
from app.terrain import Box, RasterTerrain, terrain_profile
from app.types import JsonObject

FIXTURE_TIF = (
    Path(__file__).resolve().parents[2] / "terrain" / "fixtures" / "jerusalem_dead_sea.tif"
)

CENTRE = {"lat": 31.75, "lon": 35.35}


def scenario(terrain_enabled: bool, radius_km: float = 2) -> JsonObject:
    return {
        "name": "terrain",
        "height_range": {"min": 0, "max": 10},
        "height_step": 10,
        "height_reference": "ground",
        "angular_resolution": 2,
        "distance_step": 100,
        "grid_cell_size": 100,
        "terrain_enabled": terrain_enabled,
        "combination_method": "max",
        "entities": [
            {
                "label": "A",
                "position": CENTRE,
                "frequency": 1000,
                "power": 40,
                "azimuth": 0,
                "antenna_height": 10,
                "radius": radius_km,
            }
        ],
    }


class NoTerrain:
    """Fails the test if flat-ground mode touches the terrain at all."""

    def elevations(self, lats: Floats, lons: Floats) -> Floats:
        raise AssertionError("flat-ground mode must not read terrain")

    def uncovered(self, box: Box) -> str | None:
        raise AssertionError("flat-ground mode must not read terrain")


def test_terrain_enabled_runs_store_the_real_profiles(tmp_path: Path) -> None:
    terrain = RasterTerrain([FIXTURE_TIF], [])

    failure = run_pipeline(
        "s", "r", scenario(True), tmp_path, FakeEngine(0), lambda _p: None, terrain
    )

    assert failure is None
    stored = read_params(tmp_path / "params.h5").entities[0]
    ground, expected = terrain_profile(
        terrain, CENTRE["lat"], CENTRE["lon"], stored.azimuths, stored.distances
    )
    assert stored.ground_elevation == pytest.approx(ground)
    np.testing.assert_allclose(stored.terrain, expected, atol=1e-3)
    assert np.ptp(stored.terrain) > 50  # real relief, not flat ground


def test_flat_ground_mode_never_reads_terrain(tmp_path: Path) -> None:
    failure = run_pipeline(
        "s", "r", scenario(False), tmp_path, FakeEngine(0), lambda _p: None, NoTerrain()
    )

    assert failure is None
    stored = read_params(tmp_path / "params.h5").entities[0]
    assert stored.ground_elevation == 0.0
    assert not stored.terrain.any()


def test_a_ray_leaving_the_terrain_fails_the_run_as_invalid_input(tmp_path: Path) -> None:
    terrain = RasterTerrain([FIXTURE_TIF], [])

    failure = run_pipeline(
        "s", "r", scenario(True, radius_km=10), tmp_path, FakeEngine(0), lambda _p: None, terrain
    )

    assert isinstance(failure, EngineFailure)
    assert (failure.error, failure.retryable) == ("invalid_input", False)
    assert "no terrain data" in failure.message
