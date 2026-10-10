import asyncio
import json
import time
from pathlib import Path

import asyncpg
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.db import apply_migrations
from app.engine import FakeEngine
from app.main import create_app
from app.runs import RunQueue, Worker
from app.types import JsonObject

SCENARIO: JsonObject = {
    "name": "queue test",
    "height_range": {"min": 0, "max": 50},
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


@pytest.mark.asyncio
async def test_two_concurrent_workers_never_claim_the_same_run(
    database_url: str, tmp_path: Path
) -> None:
    await apply_migrations(database_url)
    async with asyncpg.create_pool(database_url) as pool:
        queue = RunQueue(pool, tmp_path)
        submitted = {(await queue.submit(SCENARIO)).run_id for _ in range(30)}
        workers = [Worker(queue, FakeEngine(0)), Worker(queue, FakeEngine(0))]
        for worker in workers:
            await worker.connect(database_url)

        async def drain(worker: Worker) -> list[str]:
            claimed: list[str] = []
            while (run := await worker.claim()) is not None:
                claimed.append(run.run_id)
                await asyncio.sleep(0)  # let the other worker in between claims
            return claimed

        first, second = await asyncio.gather(*(drain(w) for w in workers))
        for worker in workers:
            await worker.close()

    assert first and second  # both actually took part
    assert set(first).isdisjoint(second)
    assert sorted(first + second) == sorted(submitted)


def test_migrations_apply_once_and_record_what_ran(database_url: str) -> None:
    first = asyncio.run(apply_migrations(database_url))
    second = asyncio.run(apply_migrations(database_url))

    assert first == ["001_create_tables.sql"]
    assert second == []


def _stream(client: TestClient, url: str) -> list[tuple[str, JsonObject]]:
    events: list[tuple[str, JsonObject]] = []
    name = ""
    with client.stream("GET", url) as res:
        for line in res.iter_lines():
            if line.startswith("event: "):
                name = line.removeprefix("event: ")
            elif line.startswith("data: "):
                events.append((name, json.loads(line.removeprefix("data: "))))
    return events


def test_run_status_survives_a_backend_restart_mid_run(database_url: str, tmp_path: Path) -> None:
    slow = Settings(database_url, tmp_path, fake_engine_delay_s=30)
    with TestClient(create_app(slow)) as client:
        interrupted = client.post("/api/scenarios", json=SCENARIO).json()
        waiting = client.post("/api/scenarios", json=SCENARIO).json()
        base = f"/api/scenarios/{interrupted['scenario_id']}/runs/{interrupted['run_id']}"
        # Let the worker claim the first run and start the 30 s engine. (Following the SSE
        # stream here would hold the test client open until the run ends.)
        time.sleep(1.5)
    # The backend is gone mid-run. A new one finds both runs where they were.

    with TestClient(create_app(Settings(database_url, tmp_path, 0))) as client:
        after = _stream(client, f"{base}/events")
        waited = "/api/scenarios/{scenario_id}/runs/{run_id}".format(**waiting)
        finished = _stream(client, f"{waited}/events")

    assert after[0][0] == "status"
    assert after[0][1]["status"] == "failed"
    assert after[-1] == (
        "error",
        {
            "error": "interrupted",
            "message": "the backend stopped while this run was running",
            "retryable": True,
        },
    )
    assert finished[-1] == ("done", {})
    assert not (tmp_path / "tmp" / interrupted["run_id"]).exists()
