"""What the worker does with a claimed run: terrain preprocessing, the engine, finalizing."""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import numpy as np

from app import scenario as sc
from app.engine import Engine, EngineCall, EngineFailure
from app.h5 import StoredEntity, StoredRun, read_complete, write_params
from app.types import JsonObject


@dataclass(frozen=True)
class Progress:
    phase: str  # terrain | engine | finalizing
    percent: float
    message: str


ReportFn = Callable[[Progress], None]

TERRAIN_BAND = (0.0, 10.0)
ENGINE_BAND = (10.0, 95.0)


def entity_output_path(run_dir: Path, index: int) -> Path:
    return run_dir / f"entity_{index}.h5"


def run_pipeline(
    scenario_id: str,
    run_id: str,
    scenario: JsonObject,
    run_dir: Path,
    engine: Engine,
    report: ReportFn,
) -> EngineFailure | None:
    """Runs one scenario into `run_dir` (params.h5 + entity_<n>.h5); returns the first failure."""
    run_dir.mkdir(parents=True, exist_ok=True)
    entities: list[JsonObject] = scenario["entities"]
    heights = sc.expand_heights(scenario)

    stored: list[StoredEntity] = []
    for index, entity in enumerate(entities):
        report(_band(TERRAIN_BAND, index / len(entities), "terrain", f"Entity {index + 1}: rays"))
        azimuths = sc.azimuths(scenario)
        distances = sc.distances(scenario, entity)
        # Flat ground until the real elevation lookup lands (#35).
        terrain = np.zeros((azimuths.size, distances.size))
        stored.append(StoredEntity(entity, 0.0, azimuths, distances, terrain))
    params = StoredRun(scenario_id, run_id, scenario, heights, stored)
    write_params(run_dir / "params.h5", params, datetime.now(UTC).isoformat())

    scenario_params = {k: v for k, v in scenario.items() if k != "entities"}
    for index, entity in enumerate(stored):

        def on_progress(fraction: float, index: int = index) -> None:
            done = (index + fraction) / len(stored)
            message = f"Engine: entity {index + 1}/{len(stored)}, {round(fraction * 100)}%"
            report(_band(ENGINE_BAND, done, "engine", message))

        on_progress(0.0)
        failure = engine.run(
            EngineCall(
                scenario=scenario_params,
                heights=heights,
                entity_index=index,
                entity=entity.entity,
                ground_elevation=entity.ground_elevation,
                azimuths=entity.azimuths,
                distances=entity.distances,
                terrain=entity.terrain,
                output_path=entity_output_path(run_dir, index),
            ),
            on_progress,
        )
        if failure is not None:
            return failure

    report(Progress("finalizing", ENGINE_BAND[1], "Checking engine output"))
    for index in range(len(stored)):
        if not read_complete(entity_output_path(run_dir, index)).all():
            return EngineFailure("engine_crash", f"entity {index + 1}: output incomplete", True)
    report(Progress("finalizing", 100.0, "Done"))
    return None


def _band(band: tuple[float, float], fraction: float, phase: str, message: str) -> Progress:
    low, high = band
    return Progress(phase, round(low + (high - low) * fraction, 1), message)
