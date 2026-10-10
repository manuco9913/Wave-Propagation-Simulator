import asyncio
import json
from collections.abc import AsyncGenerator, AsyncIterator
from contextlib import asynccontextmanager
from typing import cast

import asyncpg
from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse, StreamingResponse

from app.config import Settings
from app.db import apply_migrations
from app.engine import Engine, FakeEngine
from app.runs import RunQueue, Worker
from app.scenario import load_schema, validate_scenario
from app.slices import SliceError, encode_slice, render_slice
from app.types import JsonObject


def error_response(
    status: int, error: str, message: str, fields: list[JsonObject] | None = None
) -> JSONResponse:
    """The one error shape (contracts/api.md, Error format)."""
    body: JsonObject = {"error": error, "message": message}
    if fields is not None:
        body["fields"] = fields
    return JSONResponse(body, status_code=status)


def create_app(settings: Settings, engine: Engine | None = None) -> FastAPI:
    """The API, plus one in-process worker. Migrations are applied before anything else."""
    queues: list[RunQueue] = []

    def queue() -> RunQueue:
        return queues[0]

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncGenerator[None]:
        await apply_migrations(settings.database_url)
        async with asyncpg.create_pool(settings.database_url, min_size=1, max_size=10) as pool:
            run_queue = RunQueue(pool, settings.runs_dir)
            await run_queue.start(settings.database_url)
            worker = Worker(run_queue, engine or FakeEngine(settings.fake_engine_delay_s))
            await worker.connect(settings.database_url)
            await worker.sweep()  # before serving, so nobody sees an orphaned run as running
            queues.append(run_queue)
            task = asyncio.create_task(worker.work())
            try:
                yield
            finally:
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
                await worker.close()
                await run_queue.close()
                queues.clear()

    app = FastAPI(title="Wave Propagation Simulator", lifespan=lifespan)

    @app.get("/api/schema/entity")
    def entity_schema() -> JsonObject:
        return load_schema("entity")

    @app.get("/api/schema/scenario")
    def scenario_schema() -> JsonObject:
        return load_schema("scenario")

    @app.post("/api/scenarios", status_code=201, response_model=None)
    async def submit_scenario(request: Request) -> JsonObject | JSONResponse:
        try:
            body: object = await request.json()
        except ValueError:
            return error_response(422, "validation_failed", "body is not JSON", [])
        errors = validate_scenario(body)
        if errors or not isinstance(body, dict):
            fields: list[JsonObject] = [{"field": e.field, "message": e.message} for e in errors]
            return error_response(422, "validation_failed", "scenario is invalid", fields)
        scenario = cast(JsonObject, body)
        run = await queue().submit(scenario)
        return {"scenario_id": run.scenario_id, "run_id": run.run_id}

    @app.get("/api/scenarios/{scenario_id}/runs/{run_id}/events", response_model=None)
    async def run_events(scenario_id: str, run_id: str) -> StreamingResponse | JSONResponse:
        run = await queue().get(scenario_id, run_id)
        if run is None:
            return error_response(404, "not_found", "run not found")

        async def stream() -> AsyncIterator[str]:
            async for name, data in queue().events(run):
                yield f"event: {name}\ndata: {json.dumps(data)}\n\n"

        return StreamingResponse(stream(), media_type="text/event-stream")

    @app.get("/api/scenarios/{scenario_id}/runs/{run_id}/slices/{height_m}", response_model=None)
    async def run_slice(
        scenario_id: str,
        run_id: str,
        height_m: float,
        combination_method: str | None = None,
        grid_cell_size: float | None = None,
    ) -> Response:
        run = await queue().get(scenario_id, run_id)
        if run is None:
            return error_response(404, "not_found", "run not found")
        try:
            result = await asyncio.to_thread(
                render_slice, queue().run_dir(run), height_m, combination_method, grid_cell_size
            )
        except SliceError as e:
            status = 422 if e.error == "height_out_of_range" else 409
            return error_response(status, e.error, e.message)
        return Response(encode_slice(result), media_type="application/octet-stream")

    return app


def app_from_env() -> FastAPI:
    """The uvicorn entry point: `uvicorn --factory app.main:app_from_env`."""
    return create_app(Settings.from_env())
