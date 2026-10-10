"""The one place h5py (untyped) is touched; everything else gets typed values from here."""

# pyright: reportMissingTypeStubs=false, reportUnknownMemberType=false
# pyright: reportUnknownVariableType=false, reportUnknownArgumentType=false

import json
from dataclasses import dataclass
from pathlib import Path

import h5py
import numpy as np
import numpy.typing as npt

from app.types import JsonObject

Floats = npt.NDArray[np.float64]
Floats32 = npt.NDArray[np.float32]
Bools = npt.NDArray[np.bool_]

STORE_VERSION = 1


def _dataset(parent: h5py.File | h5py.Group, name: str) -> h5py.Dataset:
    node = parent[name]
    if not isinstance(node, h5py.Dataset):
        raise ValueError(f"{name} is not a dataset")
    return node


def _group(parent: h5py.File | h5py.Group, name: str) -> h5py.Group:
    node = parent[name]
    if not isinstance(node, h5py.Group):
        raise ValueError(f"{name} is not a group")
    return node


# --- Engine output: entity_<n>.h5 (see system-plan.md, Engine Interface) ---


class EntityOutputWriter:
    """Writes /propagation [H x D x A] one height at a time, flagging /complete[h] after each."""

    def __init__(self, path: Path, heights: int, distances: int, azimuths: int) -> None:
        self._file = h5py.File(path, "w")
        self._propagation = self._file.create_dataset(
            "propagation",
            shape=(heights, distances, azimuths),
            dtype="float32",
            chunks=(1, distances, azimuths),
            fillvalue=np.nan,
        )
        self._complete = self._file.create_dataset("complete", shape=(heights,), dtype="bool")

    def write_height(self, index: int, values: Floats32) -> None:
        self._propagation[index] = values
        self._complete[index] = True

    def set_attrs(self, attrs: dict[str, str | float]) -> None:
        for key, value in attrs.items():
            self._file.attrs[key] = value

    def close(self) -> None:
        self._file.close()


@dataclass(frozen=True)
class EntityOutput:
    propagation: Floats32
    complete: Bools


def read_entity_output(path: Path) -> EntityOutput:
    with h5py.File(path, "r") as f:
        return EntityOutput(
            propagation=np.asarray(_dataset(f, "propagation")[()], dtype=np.float32),
            complete=np.asarray(_dataset(f, "complete")[()], dtype=np.bool_),
        )


def read_complete(path: Path) -> Bools:
    with h5py.File(path, "r") as f:
        return np.asarray(_dataset(f, "complete")[()], dtype=np.bool_)


def read_height_slice(path: Path, height_index: int) -> Floats32 | None:
    """One [D x A] slice (a single chunk read), or None if that height isn't complete."""
    with h5py.File(path, "r") as f:
        if not bool(_dataset(f, "complete")[height_index]):
            return None
        return np.asarray(_dataset(f, "propagation")[height_index], dtype=np.float32)


# --- Per-run store: params.h5 (see system-plan.md, Per-Run Store) ---


@dataclass(frozen=True)
class StoredEntity:
    entity: JsonObject
    ground_elevation: float
    azimuths: Floats
    distances: Floats
    terrain: Floats


@dataclass(frozen=True)
class StoredRun:
    scenario_id: str
    run_id: str
    scenario: JsonObject
    heights: Floats
    entities: list[StoredEntity]


def write_params(path: Path, run: StoredRun, created_at: str) -> None:
    """Written under a temporary name and renamed, so a crash never leaves a valid-looking file."""
    partial = path.with_suffix(".h5.partial")
    with h5py.File(partial, "w") as f:
        f.attrs["store_version"] = STORE_VERSION
        f.attrs["scenario_id"] = run.scenario_id
        f.attrs["run_id"] = run.run_id
        f.attrs["created_at"] = created_at
        f.attrs["scenario"] = json.dumps(run.scenario)
        f.create_dataset("heights", data=run.heights)
        group = f.create_group("entities")
        for index, stored in enumerate(run.entities):
            g = group.create_group(str(index))
            g.attrs["entity"] = json.dumps(stored.entity)
            g.attrs["ground_elevation"] = stored.ground_elevation
            g.create_dataset("azimuths", data=stored.azimuths)
            g.create_dataset("distances", data=stored.distances)
            g.create_dataset("terrain", data=stored.terrain.astype(np.float32))
    partial.replace(path)


def read_params(path: Path) -> StoredRun:
    with h5py.File(path, "r") as f:
        group = _group(f, "entities")
        entities: list[StoredEntity] = []
        for key in sorted(group.keys(), key=int):
            g = _group(group, key)
            entities.append(
                StoredEntity(
                    entity=json.loads(str(g.attrs["entity"])),
                    ground_elevation=float(str(g.attrs["ground_elevation"])),
                    azimuths=np.asarray(_dataset(g, "azimuths")[()], dtype=np.float64),
                    distances=np.asarray(_dataset(g, "distances")[()], dtype=np.float64),
                    terrain=np.asarray(_dataset(g, "terrain")[()], dtype=np.float64),
                )
            )
        return StoredRun(
            scenario_id=str(f.attrs["scenario_id"]),
            run_id=str(f.attrs["run_id"]),
            scenario=json.loads(str(f.attrs["scenario"])),
            heights=np.asarray(_dataset(f, "heights")[()], dtype=np.float64),
            entities=entities,
        )
