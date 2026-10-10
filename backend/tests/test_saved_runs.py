import json
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.types import JsonObject

SCENARIO: JsonObject = {
    "name": "save test",
    "height_range": {"min": 0, "max": 10},
    "height_step": 10,
    "height_reference": "ground",
    "angular_resolution": 2,
    "distance_step": 100,
    "grid_cell_size": 100,
    "terrain_enabled": False,
    "combination_method": "max",
    "entities": [
        {
            "label": "A",
            "position": {"lat": 32, "lon": 35},
            "frequency": 1000,
            "power": 40,
            "azimuth": 0,
            "antenna_height": 10,
            "radius": 1,
        }
    ],
}


@pytest.fixture
def client(database_url: str, tmp_path: Path) -> Iterator[TestClient]:
    with TestClient(create_app(Settings(database_url, tmp_path, 0))) as c:
        yield c


def _wait_done(client: TestClient, scenario_id: str, run_id: str) -> str:
    """The run's last SSE event name once its stream closes."""
    last = ""
    url = f"/api/scenarios/{scenario_id}/runs/{run_id}/events"
    with client.stream("GET", url) as res:
        for line in res.iter_lines():
            if line.startswith("event: "):
                last = line.removeprefix("event: ")
    return last


def _first_run(client: TestClient) -> tuple[str, str]:
    ids = client.post("/api/scenarios", json=SCENARIO).json()
    assert _wait_done(client, ids["scenario_id"], ids["run_id"]) == "done"
    return ids["scenario_id"], ids["run_id"]


def test_a_saved_run_is_listed_under_its_name_and_still_serves_slices(
    client: TestClient, tmp_path: Path
) -> None:
    sid, rid = _first_run(client)

    res = client.post(f"/api/scenarios/{sid}/runs/{rid}/save", json={"name": "baseline"})

    assert res.status_code == 200
    assert res.json() == {"run_id": rid, "name": "baseline"}
    assert (tmp_path / "saved" / rid / "params.h5").exists()
    assert not (tmp_path / "tmp" / rid).exists()
    detail = client.get(f"/api/scenarios/{sid}").json()
    assert detail["config"] == SCENARIO
    assert [(r["run_id"], r["status"], r["saved_name"]) for r in detail["runs"]] == [
        (rid, "done", "baseline")
    ]
    assert client.get(f"/api/scenarios/{sid}/runs/{rid}/slices/0").status_code == 200
    again = client.post(f"/api/scenarios/{sid}/runs/{rid}/save", json={"name": "twice"})
    assert again.status_code == 409


def test_rerun_over_an_unsaved_result_needs_explicit_discard(
    client: TestClient, tmp_path: Path
) -> None:
    sid, old = _first_run(client)
    edited = {**SCENARIO, "height_step": 5}

    conflict = client.post(f"/api/scenarios/{sid}/runs", json=edited)
    confirmed = client.post(f"/api/scenarios/{sid}/runs?discard_unsaved=true", json=edited)

    assert conflict.status_code == 409
    assert conflict.json()["error"] == "unsaved_run_exists"
    assert conflict.json()["run_id"] == old
    assert confirmed.status_code == 201
    new = confirmed.json()["run_id"]
    assert _wait_done(client, sid, new) == "done"
    assert client.get(f"/api/scenarios/{sid}/runs/{old}/events").status_code == 404
    assert not (tmp_path / "tmp" / old).exists()
    detail = client.get(f"/api/scenarios/{sid}").json()
    assert detail["config"]["height_step"] == 5
    assert [r["run_id"] for r in detail["runs"]] == [new]


def test_rerun_after_saving_keeps_the_saved_run(client: TestClient) -> None:
    sid, saved = _first_run(client)
    client.post(f"/api/scenarios/{sid}/runs/{saved}/save", json={"name": "v1"})

    res = client.post(f"/api/scenarios/{sid}/runs", json=SCENARIO)

    assert res.status_code == 201
    runs = client.get(f"/api/scenarios/{sid}").json()["runs"]
    assert {r["run_id"] for r in runs} == {saved, res.json()["run_id"]}


def test_rerun_while_a_run_is_in_progress_is_refused(database_url: str, tmp_path: Path) -> None:
    with TestClient(create_app(Settings(database_url, tmp_path, fake_engine_delay_s=5))) as client:
        ids = client.post("/api/scenarios", json=SCENARIO).json()

        res = client.post(f"/api/scenarios/{ids['scenario_id']}/runs", json=SCENARIO)

    assert res.status_code == 409
    assert res.json()["error"] == "run_in_progress"


def test_discard_deletes_an_unsaved_run_but_not_a_saved_one(
    client: TestClient, tmp_path: Path
) -> None:
    sid, rid = _first_run(client)
    client.post(f"/api/scenarios/{sid}/runs/{rid}/save", json={"name": "keep"})
    other = client.post(f"/api/scenarios/{sid}/runs", json=SCENARIO).json()["run_id"]
    _wait_done(client, sid, other)

    assert client.delete(f"/api/scenarios/{sid}/runs/{rid}").status_code == 409
    assert client.delete(f"/api/scenarios/{sid}/runs/{other}").status_code == 204
    assert not (tmp_path / "tmp" / other).exists()
    assert [r["run_id"] for r in client.get(f"/api/scenarios/{sid}").json()["runs"]] == [rid]


def test_scenarios_are_listed_newest_first(client: TestClient) -> None:
    first, _ = _first_run(client)
    second, _ = _first_run(client)

    listed = client.get("/api/scenarios").json()

    assert [s["scenario_id"] for s in listed] == [second, first]
    assert listed[0]["name"] == "save test"
    assert listed[0]["run_count"] == 1
    assert client.get("/api/scenarios/00000000-0000-0000-0000-000000000000").status_code == 404


def test_rerun_body_is_validated_like_a_new_scenario(client: TestClient) -> None:
    sid, _ = _first_run(client)

    res = client.post(f"/api/scenarios/{sid}/runs", json={**SCENARIO, "height_step": 0})

    assert res.status_code == 422
    assert json.loads(res.content)["fields"][0]["field"] == "height_step"
