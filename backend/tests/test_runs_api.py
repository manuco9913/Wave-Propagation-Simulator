import json
import math
import struct
from collections.abc import Iterator
from pathlib import Path
from typing import NamedTuple

import numpy as np
import numpy.typing as npt
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.engine import FakeEngine
from app.main import create_app
from app.types import JsonObject


def _entity(lat: float, lon: float, **overrides: object) -> JsonObject:
    return {
        "label": "A",
        "position": {"lat": lat, "lon": lon},
        "frequency": 1000,
        "power": 40,
        "azimuth": 0,
        "antenna_height": 10,
        "radius": 2,
        **overrides,
    }


def _scenario(**overrides: object) -> JsonObject:
    return {
        "name": "test",
        "height_range": {"min": 0, "max": 20},
        "height_step": 10,
        "height_reference": "ground",
        "angular_resolution": 1,
        "distance_step": 100,
        "grid_cell_size": 100,
        "terrain_enabled": False,
        "combination_method": "max",
        "entities": [_entity(32.0, 35.0)],
        **overrides,
    }


@pytest.fixture
def client(database_url: str, tmp_path: Path) -> Iterator[TestClient]:
    with TestClient(create_app(Settings(database_url, tmp_path, 0))) as c:
        yield c


def _events(client: TestClient, url: str) -> list[tuple[str, JsonObject]]:
    events: list[tuple[str, JsonObject]] = []
    name = ""
    with client.stream("GET", url) as res:
        assert res.headers["content-type"].startswith("text/event-stream")
        for line in res.iter_lines():
            if line.startswith("event: "):
                name = line.removeprefix("event: ")
            elif line.startswith("data: "):
                events.append((name, json.loads(line.removeprefix("data: "))))
    return events


class Header(NamedTuple):
    magic: bytes
    version: int
    width: int
    height: int
    min_val: float
    max_val: float
    west: float
    south: float
    east: float
    north: float


def _decode(body: bytes) -> tuple[Header, npt.NDArray[np.float32]]:
    header = Header(*struct.unpack("<4sHIIffdddd2x", body[:56]))
    values = np.frombuffer(body[56:], dtype="<f4").reshape(header.height, header.width)
    return header, values


def _run(client: TestClient, scenario: JsonObject) -> tuple[str, list[tuple[str, JsonObject]]]:
    res = client.post("/api/scenarios", json=scenario)
    assert res.status_code == 201
    ids = res.json()
    base = f"/api/scenarios/{ids['scenario_id']}/runs/{ids['run_id']}"
    return base, _events(client, f"{base}/events")


def test_submitted_run_streams_progress_then_serves_its_slices(
    database_url: str, tmp_path: Path
) -> None:
    settings = Settings(database_url, tmp_path, fake_engine_delay_s=0.6)
    with TestClient(create_app(settings)) as client:
        base, events = _run(client, _scenario())
        res = client.get(f"{base}/slices/10")

    names = [name for name, _ in events]
    assert names[0] == "status"
    assert events[-1] == ("done", {"heights": [0, 10, 20]})
    # the stream may open after the terrain phase; it must see the engine work and finish
    phases = [data["phase"] for name, data in events if name == "progress"]
    assert {"engine", "finalizing"} <= set(phases)

    assert res.status_code == 200
    header, values = _decode(res.content)
    assert (header.magic, header.version) == (b"WPS1", 1)
    # 2 km radius -> 4 km bbox -> 40 cells of 100 m each way
    assert (header.width, header.height) == (40, 40)
    assert header.west < 35.0 < header.east and header.south < 32.0 < header.north
    finite = values[np.isfinite(values)]
    assert header.min_val == pytest.approx(finite.min())
    assert header.max_val == pytest.approx(finite.max())
    assert math.isnan(values[0, 0])  # bbox corner is outside the circle
    # strongest cell sits beside the antenna, weakest near the edge of the circle
    row, col = np.unravel_index(np.nanargmax(values), values.shape)
    assert abs(int(row) - 20) <= 1 and abs(int(col) - 20) <= 1


def test_beam_width_attenuates_points_far_off_the_beam_axis(client: TestClient) -> None:
    flat_base, _ = _run(client, _scenario())
    beam_base, _ = _run(client, _scenario(entities=[_entity(32.0, 35.0, beam_width=1)]))

    _, isotropic = _decode(client.get(f"{flat_base}/slices/0").content)
    _, beamed = _decode(client.get(f"{beam_base}/slices/0").content)

    # a ground-level point 100-200 m away is far below a 10 m antenna's 1° beam: capped at -30 dB
    near = (20, 21)
    assert beamed[near] == pytest.approx(isotropic[near] - 30, abs=0.01)


def test_two_entities_combine_into_one_grid_over_both_circles(client: TestClient) -> None:
    scenario = _scenario(entities=[_entity(32.0, 35.0), _entity(32.0, 35.05)])
    base, _ = _run(client, scenario)

    header, values = _decode(client.get(f"{base}/slices/0").content)
    one_header, _ = _decode(client.get(f"{base}/slices/0?grid_cell_size=200").content)

    assert header.width > header.height  # wider than tall: circles side by side
    assert one_header.width == pytest.approx(header.width / 2, abs=1)
    assert np.isfinite(values).sum() > 0


def test_invalid_scenario_is_rejected_with_field_errors(client: TestClient) -> None:
    bad = _scenario(
        height_range={"min": 10, "max": 5},
        distance_step=500,
        entities=[_entity(32, 35, radius=0.2)],
    )

    res = client.post("/api/scenarios", json=bad)

    assert res.status_code == 422
    body = res.json()
    assert body["error"] == "validation_failed"
    fields = {f["field"] for f in body["fields"]}
    assert fields == {"height_range", "entities.0.radius"}


def test_schema_errors_name_the_dotted_field(client: TestClient) -> None:
    res = client.post("/api/scenarios", json=_scenario(angular_resolution=5))

    assert res.status_code == 422
    assert [f["field"] for f in res.json()["fields"]] == ["angular_resolution"]


def test_slice_for_a_height_the_run_does_not_have_is_422(client: TestClient) -> None:
    base, _ = _run(client, _scenario())

    assert client.get(f"{base}/slices/15").status_code == 422
    assert client.get(f"{base}/slices/0").status_code == 200


def test_engine_failure_ends_the_stream_with_an_error_event(
    database_url: str, tmp_path: Path
) -> None:
    app = create_app(Settings(database_url, tmp_path, 0), FakeEngine(0, fail_with="timeout"))
    with TestClient(app) as client:
        _, events = _run(client, _scenario())

    assert events[-1] == (
        "error",
        {"error": "timeout", "message": "fake engine told to fail", "retryable": True},
    )
    assert not any((tmp_path / "tmp").iterdir())  # failed runs keep nothing


def test_unknown_run_is_404(client: TestClient) -> None:
    unknown = "/api/scenarios/00000000-0000-0000-0000-000000000000/runs/x"

    for url in (f"{unknown}/events", f"{unknown}/slices/0"):
        res = client.get(url)
        assert res.status_code == 404
        assert res.json()["error"] == "not_found"
