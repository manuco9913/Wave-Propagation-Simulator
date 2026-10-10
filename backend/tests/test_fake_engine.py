import math
from pathlib import Path

import numpy as np

from app.engine import EngineCall, EngineFailure, FakeEngine
from app.h5 import read_entity_output


def _call(tmp_path: Path, *, terrain: float = 0.0) -> EngineCall:
    azimuths = np.array([0.0, 90.0, 180.0, 270.0])
    distances = np.array([1000.0, 2000.0, 3000.0])
    return EngineCall(
        scenario={"height_reference": "ground", "terrain_enabled": terrain != 0.0},
        heights=np.array([0.0, 30.0]),
        entity_index=0,
        entity={"frequency": 1000.0, "power": 40.0, "antenna_height": 30.0},
        ground_elevation=0.0,
        azimuths=azimuths,
        distances=distances,
        terrain=np.full((azimuths.size, distances.size), terrain),
        output_path=tmp_path / "entity_0.h5",
    )


def test_writes_received_power_as_power_minus_free_space_loss(tmp_path: Path) -> None:
    call = _call(tmp_path)

    result = FakeEngine(delay_s=0).run(call, lambda _fraction: None)

    assert result is None
    output = read_entity_output(call.output_path)
    assert output.complete.tolist() == [True, True]
    assert output.propagation.shape == (2, 3, 4)  # [H x D x A]
    # height 30 m above ground = antenna altitude, so the path is horizontal: d = 2 km
    fspl = 20 * math.log10(2.0) + 20 * math.log10(1000.0) + 32.44
    assert output.propagation[1, 1, 2] == np.float32(40.0 - fspl)


def test_terrain_above_the_line_of_sight_shadows_the_point(tmp_path: Path) -> None:
    flat = _call(tmp_path / "a")
    hilly = _call(tmp_path / "b", terrain=100.0)
    flat.output_path.parent.mkdir()
    hilly.output_path.parent.mkdir()

    FakeEngine(delay_s=0).run(flat, lambda _fraction: None)
    FakeEngine(delay_s=0).run(hilly, lambda _fraction: None)

    # ground-referenced height 30 m on 100 m terrain sits behind the first 100 m step
    a = read_entity_output(flat.output_path).propagation[1, 2, 0]
    b = read_entity_output(hilly.output_path).propagation[1, 2, 0]
    assert b < a - 10


def test_reports_progress_per_height_and_can_be_told_to_fail(tmp_path: Path) -> None:
    call = _call(tmp_path)
    seen: list[float] = []

    FakeEngine(delay_s=0).run(call, seen.append)
    failure = FakeEngine(delay_s=0, fail_with="engine_crash").run(call, seen.append)

    assert seen == [0.5, 1.0]
    assert failure == EngineFailure("engine_crash", "fake engine told to fail", retryable=True)
