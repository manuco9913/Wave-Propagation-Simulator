"""The engine interface (system-plan.md, Engine Interface) and the fake engine behind it.

The engine knows nothing about the database, SSE or HTTP: it gets every parameter for one entity,
writes received power [H x D x A] to the HDF5 file it is given, and returns success or failure.
"""

import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import numpy as np

from app.h5 import EntityOutputWriter, Floats
from app.types import JsonObject

# Called with the fraction (0-1) of this entity's call that is done.
ProgressFn = Callable[[float], None]

SHADOW_LOSS_DB = 20.0


@dataclass(frozen=True)
class EngineCall:
    """One entity's call: every scenario and entity parameter, plus the derived arrays."""

    scenario: JsonObject  # every scenario field except `entities`
    heights: Floats  # [H] m, measured from scenario["height_reference"]
    entity_index: int
    entity: JsonObject  # every entity field as submitted
    ground_elevation: float  # m above sea level at the antenna site
    azimuths: Floats  # [A] degrees
    distances: Floats  # [D] m, shared by all rays
    terrain: Floats  # [A x D] m above sea level
    output_path: Path


@dataclass(frozen=True)
class EngineFailure:
    error: str  # invalid_input | engine_crash | timeout | out_of_disk
    message: str
    retryable: bool


class Engine(Protocol):
    def run(self, call: EngineCall, on_progress: ProgressFn) -> EngineFailure | None: ...


class FakeEngine:
    """Deterministic stand-in for MATLAB: free-space loss with a flat terrain-shadow penalty.

    `delay_s` spreads a sleep over the heights so progress is visible; `fail_with` makes every
    call fail with that error code so error paths are testable.
    """

    def __init__(self, delay_s: float, fail_with: str | None = None) -> None:
        self._delay_s = delay_s
        self._fail_with = fail_with

    def run(self, call: EngineCall, on_progress: ProgressFn) -> EngineFailure | None:
        if self._fail_with is not None:
            retryable = self._fail_with in ("engine_crash", "timeout")
            return EngineFailure(self._fail_with, "fake engine told to fail", retryable)
        if isinstance(call.entity["frequency"], str) or isinstance(call.entity["power"], str):
            return EngineFailure("invalid_input", "per-angle files are not supported yet", False)

        frequency_mhz = float(call.entity["frequency"])
        power_dbm = float(call.entity["power"])
        antenna_alt = call.ground_elevation + float(call.entity["antenna_height"])
        distances = call.distances[np.newaxis, :]  # [1 x D]
        terrain = call.terrain  # [A x D]
        # Steepest terrain angle seen from the antenna *before* each step along the ray.
        terrain_angle = np.arctan2(terrain - antenna_alt, distances)
        horizon = np.maximum.accumulate(terrain_angle, axis=1)
        horizon = np.concatenate([np.full((terrain.shape[0], 1), -np.inf), horizon[:, :-1]], 1)
        ground_ref = call.scenario["height_reference"] == "ground"

        writer = EntityOutputWriter(
            call.output_path, call.heights.size, call.distances.size, call.azimuths.size
        )
        try:
            for h, height in enumerate(call.heights):
                point_alt = terrain + height if ground_ref else np.full_like(terrain, height)
                rise = point_alt - antenna_alt
                d_km = np.sqrt(distances**2 + rise**2) / 1000.0
                fspl = 20 * np.log10(d_km) + 20 * np.log10(frequency_mhz) + 32.44
                shadowed = np.arctan2(rise, distances) < horizon
                received = power_dbm - fspl - np.where(shadowed, SHADOW_LOSS_DB, 0.0)
                writer.write_height(h, received.T.astype(np.float32))  # [A x D] -> [D x A]
                if self._delay_s > 0:
                    time.sleep(self._delay_s / call.heights.size)
                on_progress((h + 1) / call.heights.size)
        finally:
            writer.close()
        return None
