"""Runs: queued -> running -> done | failed, their progress, and the live events for SSE.

In-process for now: run state lives in memory and one worker task runs the queue, one run at a
time (the engine uses every core). #32 replaces this with the PostgreSQL queue; the routes only
see `submit`, `get` and `events`.
"""

import asyncio
import shutil
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from pathlib import Path

from app.engine import Engine
from app.pipeline import Progress, run_pipeline
from app.types import JsonObject

# (event name, data) as the SSE stream sends them; see contracts/api.md
RunEvent = tuple[str, JsonObject]


@dataclass
class Run:
    scenario_id: str
    run_id: str
    scenario: JsonObject
    run_dir: Path
    status: str = "queued"  # queued | running | done | failed
    phase: str | None = None
    percent: float = 0.0
    message: str = "Queued"
    error: JsonObject | None = None
    listeners: list[asyncio.Queue[RunEvent]] = field(default_factory=list[asyncio.Queue[RunEvent]])

    def snapshot(self) -> JsonObject:
        return {
            "status": self.status,
            "phase": self.phase,
            "percent": self.percent,
            "message": self.message,
        }


class RunRegistry:
    def __init__(self, runs_dir: Path, engine: Engine) -> None:
        self._runs_dir = runs_dir
        self._engine = engine
        self._runs: dict[str, Run] = {}
        self._queue: asyncio.Queue[Run] = asyncio.Queue()

    def submit(self, scenario: JsonObject) -> Run:
        scenario_id, run_id = str(uuid.uuid4()), str(uuid.uuid4())
        run = Run(scenario_id, run_id, scenario, self._runs_dir / "tmp" / run_id)
        self._runs[run_id] = run
        self._queue.put_nowait(run)
        return run

    def get(self, scenario_id: str, run_id: str) -> Run | None:
        run = self._runs.get(run_id)
        return run if run and run.scenario_id == scenario_id else None

    async def events(self, run: Run) -> AsyncIterator[RunEvent]:
        """The current state first, then live events until the run ends."""
        listener: asyncio.Queue[RunEvent] = asyncio.Queue()
        run.listeners.append(listener)
        try:
            yield ("status", run.snapshot())
            if run.status == "done":
                yield ("done", {})
                return
            if run.status == "failed" and run.error is not None:
                yield ("error", run.error)
                return
            while True:
                event = await listener.get()
                yield event
                if event[0] in ("done", "error"):
                    return
        finally:
            run.listeners.remove(listener)

    async def work(self) -> None:
        """The worker loop: runs queued runs one after another, forever."""
        loop = asyncio.get_running_loop()
        while True:
            run = await self._queue.get()
            run.status = "running"

            def report(progress: Progress, run: Run = run) -> None:
                loop.call_soon_threadsafe(self._progress, run, progress)

            try:
                failure = await asyncio.to_thread(
                    run_pipeline,
                    run.scenario_id,
                    run.run_id,
                    run.scenario,
                    run.run_dir,
                    self._engine,
                    report,
                )
            except Exception as exc:  # a pipeline bug must fail the run, not the worker
                self._fail(run, {"error": "engine_crash", "message": str(exc), "retryable": True})
                continue
            if failure is None:
                run.status = "done"
                self._publish(run, ("done", {}))
            else:
                error = {
                    "error": failure.error,
                    "message": failure.message,
                    "retryable": failure.retryable,
                }
                self._fail(run, error)

    def _progress(self, run: Run, progress: Progress) -> None:
        run.phase, run.percent, run.message = progress.phase, progress.percent, progress.message
        data = {"phase": progress.phase, "message": progress.message, "percent": progress.percent}
        self._publish(run, ("progress", data))

    def _fail(self, run: Run, error: JsonObject) -> None:
        run.status, run.error = "failed", error
        shutil.rmtree(run.run_dir, ignore_errors=True)  # failed runs keep nothing (Per-Run Store)
        self._publish(run, ("error", error))

    def _publish(self, run: Run, event: RunEvent) -> None:
        for listener in run.listeners:
            listener.put_nowait(event)
