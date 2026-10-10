"""Runs: queued -> running -> done | failed, their progress, and live events for SSE.

The queue is the `runs` table. Workers claim the oldest queued run with FOR UPDATE SKIP LOCKED,
so two workers never claim the same run. Progress goes to the run row plus a pg NOTIFY, which
the SSE streams forward. A claimed run also holds a session advisory lock on the worker's
connection. If the worker dies, the lock goes with it, and the next worker to start marks that
run failed ("interrupted"). There is no automatic retry.
"""

import asyncio
import contextlib
import json
import shutil
import time
import uuid
from collections import defaultdict
from collections.abc import AsyncIterator
from dataclasses import dataclass
from pathlib import Path
from typing import cast

import asyncpg
from asyncpg.pool import PoolConnectionProxy

from app.engine import Engine
from app.pipeline import Progress, run_pipeline
from app.scenario import expand_heights
from app.types import JsonObject

EVENTS_CHANNEL = "run_events"
QUEUED_CHANNEL = "run_queued"
# How often an idle worker re-checks the queue when no NOTIFY arrives (e.g. it was missed).
IDLE_POLL_S = 5.0
# Progress within one phase is written at most this often.
PROGRESS_INTERVAL_S = 0.25

# (event name, data) as the SSE stream sends them; see contracts/api.md
RunEvent = tuple[str, JsonObject]

# A plain connection or one borrowed from the pool.
Conn = asyncpg.Connection | PoolConnectionProxy

_LOCK_KEY = "hashtextextended($1::uuid::text, 0)"


@dataclass(frozen=True)
class Run:
    scenario_id: str
    run_id: str
    snapshot: JsonObject
    status: str  # queued | running | done | failed
    phase: str | None
    percent: float
    message: str
    error: JsonObject | None
    folder: str  # relative to the runs directory

    @staticmethod
    def from_row(row: asyncpg.Record) -> "Run":
        error = row["error"]
        return Run(
            scenario_id=str(row["scenario_id"]),
            run_id=str(row["id"]),
            snapshot=json.loads(row["snapshot"]),
            status=row["status"],
            phase=row["phase"],
            percent=float(row["percent"]),
            message=row["message"],
            error=json.loads(error) if error is not None else None,
            folder=row["folder"],
        )

    def done_event(self) -> JsonObject:
        """The `done` payload: the heights the run has slices for, lowest first."""
        return {"heights": expand_heights(self.snapshot).tolist()}

    def snapshot_event(self) -> JsonObject:
        return {
            "status": self.status,
            "phase": self.phase,
            "percent": self.percent,
            "message": self.message,
        }


def _uuid(value: str) -> uuid.UUID | None:
    try:
        return uuid.UUID(value)
    except ValueError:
        return None


class RunQueue:
    """The API's view of runs: submit, look up, follow. Also how workers report."""

    def __init__(self, pool: asyncpg.Pool, runs_dir: Path) -> None:
        self._pool = pool
        self.runs_dir = runs_dir
        self._listener: asyncpg.Connection | None = None
        self._subscribers: defaultdict[str, list[asyncio.Queue[RunEvent]]] = defaultdict(list)
        self._wakeups: list[asyncio.Event] = []

    async def start(self, dsn: str) -> None:
        """Opens the connection that LISTENs for run events and queue wake-ups."""
        self._listener = await asyncpg.connect(dsn)
        await self._listener.add_listener(EVENTS_CHANNEL, self._on_event)
        await self._listener.add_listener(QUEUED_CHANNEL, self._on_queued)

    async def close(self) -> None:
        if self._listener is not None:
            await self._listener.close()

    def run_dir(self, run: Run) -> Path:
        return self.runs_dir / run.folder

    async def submit(self, scenario: JsonObject) -> Run:
        """Stores the scenario and queues its first run, in one transaction."""
        scenario_id, run_id = uuid.uuid4(), uuid.uuid4()
        config = json.dumps(scenario)
        async with self._pool.acquire() as conn, conn.transaction():
            await conn.execute(
                "INSERT INTO scenarios (id, config) VALUES ($1, $2::jsonb)", scenario_id, config
            )
            row = await conn.fetchrow(
                "INSERT INTO runs (id, scenario_id, snapshot, folder)"
                " VALUES ($1, $2, $3::jsonb, $4) RETURNING *",
                run_id,
                scenario_id,
                config,
                f"tmp/{run_id}",
            )
            await conn.execute("SELECT pg_notify($1, $2)", QUEUED_CHANNEL, str(run_id))
        assert row is not None
        return Run.from_row(row)

    async def get(self, scenario_id: str, run_id: str) -> Run | None:
        sid, rid = _uuid(scenario_id), _uuid(run_id)
        if sid is None or rid is None:
            return None
        row = await self._pool.fetchrow(
            "SELECT * FROM runs WHERE id = $1 AND scenario_id = $2", rid, sid
        )
        return Run.from_row(row) if row else None

    async def events(self, run: Run) -> AsyncIterator[RunEvent]:
        """The run's current state first, then live events until it ends."""
        listener: asyncio.Queue[RunEvent] = asyncio.Queue()
        subscribers = self._subscribers[run.run_id]
        subscribers.append(listener)  # before reading the row, so nothing is missed
        try:
            current = await self.get(run.scenario_id, run.run_id) or run
            yield ("status", current.snapshot_event())
            if current.status == "done":
                yield ("done", current.done_event())
                return
            if current.status == "failed":
                yield ("error", current.error or {})
                return
            while True:
                event = await listener.get()
                yield event
                if event[0] in ("done", "error"):
                    return
        finally:
            subscribers.remove(listener)
            if not subscribers:
                del self._subscribers[run.run_id]

    def wakeup(self) -> asyncio.Event:
        """An event set whenever a run is queued; for an in-process worker."""
        event = asyncio.Event()
        self._wakeups.append(event)
        return event

    # --- reporting, used by workers ---

    async def progress(self, run_id: str, progress: Progress) -> None:
        data = {"phase": progress.phase, "message": progress.message, "percent": progress.percent}
        async with self._pool.acquire() as conn, conn.transaction():
            await conn.execute(
                "UPDATE runs SET phase = $2, percent = $3, message = $4 WHERE id = $1",
                uuid.UUID(run_id),
                progress.phase,
                progress.percent,
                progress.message,
            )
            await _notify(conn, run_id, "progress", data)

    async def finish(self, run: Run) -> None:
        async with self._pool.acquire() as conn, conn.transaction():
            await conn.execute(
                "UPDATE runs SET status = 'done', percent = 100, message = 'Done',"
                " finished_at = now() WHERE id = $1",
                uuid.UUID(run.run_id),
            )
            await _notify(conn, run.run_id, "done", run.done_event())

    async def fail(self, run: Run, error: JsonObject, conn: Conn | None = None) -> None:
        """Marks the run failed and deletes its folder (failed runs keep nothing)."""
        if conn is None:
            async with self._pool.acquire() as pooled, pooled.transaction():
                await self._fail(pooled, run, error)
        else:
            await self._fail(conn, run, error)
        shutil.rmtree(self.run_dir(run), ignore_errors=True)

    async def _fail(self, conn: Conn, run: Run, error: JsonObject) -> None:
        await conn.execute(
            "UPDATE runs SET status = 'failed', error = $2::jsonb, message = $3,"
            " finished_at = now() WHERE id = $1",
            uuid.UUID(run.run_id),
            json.dumps(error),
            str(error["message"]),
        )
        await _notify(conn, run.run_id, "error", error)

    def _on_event(self, _conn: object, _pid: int, _channel: str, payload: object) -> None:
        message = cast(JsonObject, json.loads(str(payload)))
        for listener in self._subscribers.get(str(message["run_id"]), []):
            listener.put_nowait((str(message["event"]), cast(JsonObject, message["data"])))

    def _on_queued(self, _conn: object, _pid: int, _channel: str, _payload: object) -> None:
        for event in self._wakeups:
            event.set()


async def _notify(conn: Conn, run_id: str, event: str, data: JsonObject) -> None:
    payload = json.dumps({"run_id": run_id, "event": event, "data": data})
    await conn.execute("SELECT pg_notify($1, $2)", EVENTS_CHANNEL, payload)


class Worker:
    """Claims runs and executes them, one at a time (the engine uses every core).

    Holds one connection of its own: the session advisory lock on the run it's executing lives
    on it, so the lock disappears with the worker.
    """

    def __init__(self, queue: RunQueue, engine: Engine) -> None:
        self._queue = queue
        self._engine = engine
        self._conn: asyncpg.Connection | None = None

    async def connect(self, dsn: str) -> None:
        self._conn = await asyncpg.connect(dsn)

    async def close(self) -> None:
        if self._conn is not None:
            await self._conn.close()

    @property
    def conn(self) -> asyncpg.Connection:
        if self._conn is None:
            raise RuntimeError("worker is not connected")
        return self._conn

    async def claim(self) -> Run | None:
        """The oldest queued run, now `running` and locked by this worker; None if none."""
        async with self.conn.transaction():
            row = await self.conn.fetchrow(
                "SELECT id FROM runs WHERE status = 'queued'"
                " ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1"
            )
            if row is None:
                return None
            await self.conn.execute(f"SELECT pg_advisory_lock({_LOCK_KEY})", row["id"])
            claimed = await self.conn.fetchrow(
                "UPDATE runs SET status = 'running', message = 'Starting', started_at = now()"
                " WHERE id = $1 RETURNING *",
                row["id"],
            )
        assert claimed is not None
        return Run.from_row(claimed)

    async def release(self, run: Run) -> None:
        await self.conn.execute(f"SELECT pg_advisory_unlock({_LOCK_KEY})", uuid.UUID(run.run_id))

    async def sweep(self) -> None:
        """Fails runs whose worker is gone, and deletes tmp folders that have no run row."""
        async with self.conn.transaction():
            rows = await self.conn.fetch(
                "SELECT * FROM runs WHERE status = 'running' FOR UPDATE SKIP LOCKED"
            )
            for row in rows:
                orphaned = await self.conn.fetchval(
                    f"SELECT pg_try_advisory_xact_lock({_LOCK_KEY})", row["id"]
                )
                if orphaned:
                    error = {
                        "error": "interrupted",
                        "message": "the backend stopped while this run was running",
                        "retryable": True,
                    }
                    await self._queue.fail(Run.from_row(row), error, self.conn)
        tmp = self._queue.runs_dir / "tmp"
        if tmp.is_dir():
            folders = {f"tmp/{p.name}": p for p in tmp.iterdir() if p.is_dir()}
            known = {
                r["folder"]
                for r in await self.conn.fetch(
                    "SELECT folder FROM runs WHERE folder = ANY($1::text[])", list(folders)
                )
            }
            for folder, path in folders.items():
                if folder not in known:
                    shutil.rmtree(path, ignore_errors=True)

    async def execute(self, run: Run) -> None:
        """Runs the pipeline for a claimed run and records how it ended."""
        loop = asyncio.get_running_loop()
        last: list[tuple[str, float]] = [("", 0.0)]

        def report(progress: Progress) -> None:  # called from the pipeline's thread
            phase, at = last[0]
            now = time.monotonic()
            if progress.phase == phase and now - at < PROGRESS_INTERVAL_S:
                return
            last[0] = (progress.phase, now)
            asyncio.run_coroutine_threadsafe(
                self._queue.progress(run.run_id, progress), loop
            ).result()

        try:
            failure = await asyncio.to_thread(
                run_pipeline,
                run.scenario_id,
                run.run_id,
                run.snapshot,
                self._queue.run_dir(run),
                self._engine,
                report,
            )
        except Exception as exc:  # a pipeline bug must fail the run, not the worker
            error = {"error": "engine_crash", "message": str(exc), "retryable": True}
            await self._queue.fail(run, error)
            return
        finally:
            await self.release(run)
        if failure is None:
            await self._queue.finish(run)
        else:
            error = {
                "error": failure.error,
                "message": failure.message,
                "retryable": failure.retryable,
            }
            await self._queue.fail(run, error)

    async def work(self) -> None:
        """Forever: claim the next run and execute it; sleep until one is queued.

        Call `sweep()` once first, at startup.
        """
        wakeup = self._queue.wakeup()
        while True:
            wakeup.clear()
            run = await self.claim()
            if run is not None:
                await self.execute(run)
                continue
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(wakeup.wait(), IDLE_POLL_S)
