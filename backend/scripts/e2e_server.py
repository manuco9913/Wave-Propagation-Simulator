"""The real backend, set up for the browser end-to-end tests (frontend/e2e).

Nothing is faked except the engine (the fake engine is the stand-in for MATLAB). Before
serving it creates:
- a throwaway database on TEST_DATABASE_URL, dropped on exit;
- a temporary runs directory;
- a terrain directory holding only the committed fixture (terrain/fixtures/), laid out like
  terrain/fetch.py does, with a one-tile manifest.

    TEST_DATABASE_URL=postgresql://... uv run python scripts/e2e_server.py --port 8765
"""

import argparse
import asyncio
import json
import os
import shutil
import signal
import tempfile
import uuid
from pathlib import Path
from urllib.parse import urlparse

import asyncpg
import uvicorn

REPO = Path(__file__).resolve().parents[2]
FIXTURE = REPO / "terrain" / "fixtures" / "jerusalem_dead_sea.tif"
# The fixture is a clip of this tile; the name only places it in the fetch.py layout.
TILE = "Copernicus_DSM_COG_10_N31_00_E035_00_DEM"
PREFIX = "wps_e2e_"
TMP_PREFIX = "wps-e2e-"


def _exit(signum: int, _frame: object) -> None:
    raise SystemExit(128 + signum)


async def _drop_stale(admin_url: str) -> set[str]:
    """Drops databases an earlier, killed run left behind (only ones nobody is connected to).

    Returns the e2e databases still there (other runs in progress)."""
    conn = await asyncpg.connect(admin_url)
    try:
        stale = await conn.fetch(
            "SELECT datname FROM pg_database d WHERE datname LIKE $1 AND NOT EXISTS"
            " (SELECT 1 FROM pg_stat_activity a WHERE a.datname = d.datname)",
            f"{PREFIX}%",
        )
        for row in stale:
            await conn.execute(f'DROP DATABASE IF EXISTS "{row["datname"]}"')
        live = await conn.fetch(
            "SELECT datname FROM pg_database WHERE datname LIKE $1", f"{PREFIX}%"
        )
        return {str(r["datname"]) for r in live}
    finally:
        await conn.close()


async def _admin(admin_url: str, sql: str) -> None:
    conn = await asyncpg.connect(admin_url)
    try:
        await conn.execute(sql)
    finally:
        await conn.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, required=True)
    port = parser.parse_args().port
    admin_url = os.environ.get("TEST_DATABASE_URL")
    if not admin_url:
        raise SystemExit("TEST_DATABASE_URL is not set")

    live = asyncio.run(_drop_stale(admin_url))
    for leftover in Path(tempfile.gettempdir()).glob(f"{TMP_PREFIX}*"):
        if f"{PREFIX}{leftover.name.removeprefix(TMP_PREFIX)}" not in live:
            shutil.rmtree(leftover, ignore_errors=True)  # its run's database is gone
    suffix = uuid.uuid4().hex[:12]
    name = f"{PREFIX}{suffix}"
    asyncio.run(_admin(admin_url, f'CREATE DATABASE "{name}"'))
    work = Path(tempfile.gettempdir()) / f"{TMP_PREFIX}{suffix}"
    work.mkdir()
    try:
        tile_dir = work / "terrain" / "copernicus-dem-30m" / TILE
        tile_dir.mkdir(parents=True)
        shutil.copy(FIXTURE, tile_dir / f"{TILE}.tif")
        manifest = work / "manifest.json"
        manifest.write_text(json.dumps({"tiles": [{"name": TILE}], "missing_tiles": []}))
        os.environ |= {
            "DATABASE_URL": urlparse(admin_url)._replace(path=f"/{name}").geturl(),
            "RUNS_DIR": str(work / "runs"),
            "TERRAIN_DIR": str(work / "terrain"),
            "TERRAIN_MANIFEST": str(manifest),
            "FAKE_ENGINE_DELAY_S": os.environ.get("FAKE_ENGINE_DELAY_S", "1.5"),
        }
        # uvicorn shuts down on SIGTERM, then re-raises it with the previous handler in place;
        # turning it into SystemExit lets the cleanup below run instead of the process dying.
        signal.signal(signal.SIGTERM, _exit)
        uvicorn.run(
            "app.main:app_from_env",
            factory=True,
            app_dir=str(REPO / "backend"),
            port=port,
            log_level="warning",
        )
    finally:
        shutil.rmtree(work, ignore_errors=True)
        asyncio.run(_admin(admin_url, f'DROP DATABASE "{name}" WITH (FORCE)'))


if __name__ == "__main__":
    main()
