"""Scenario validation (schema + the checks it can't express) and the arrays derived from it."""

import json
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any, cast

import numpy as np
from jsonschema import Draft7Validator, ValidationError
from referencing import Registry, Resource

from app.h5 import Floats
from app.types import JsonObject

CONTRACTS_DIR = Path(__file__).resolve().parents[2] / "contracts"


def load_schema(name: str) -> JsonObject:
    return json.loads((CONTRACTS_DIR / f"{name}.schema.json").read_text(encoding="utf-8"))


@dataclass(frozen=True)
class FieldError:
    field: str  # dotted path into the request body
    message: str


def _validator() -> Draft7Validator:
    # The scenario's `"$ref": "entity"` resolves to the entity schema. `referencing` is generic
    # over the document type and can't infer it here; JSON in, JSON out.
    entity = Resource[Any].from_contents(load_schema("entity"))
    registry = Registry[Any]().with_resource("entity", entity)
    return Draft7Validator(load_schema("scenario"), registry=registry)


def _iter_errors(validator: Draft7Validator, body: object) -> Iterator[ValidationError]:
    return validator.iter_errors(body)  # pyright: ignore[reportUnknownMemberType, reportArgumentType]


_VALIDATOR = _validator()


def validate_scenario(body: object) -> list[FieldError]:
    """Every problem with a submitted scenario; empty when it can be queued."""
    errors = [
        FieldError(".".join(str(p) for p in e.absolute_path), e.message)
        for e in _iter_errors(_VALIDATOR, body)
    ]
    if errors or not isinstance(body, dict):
        return errors
    scenario = cast(JsonObject, body)
    if scenario["height_range"]["min"] >= scenario["height_range"]["max"]:
        errors.append(FieldError("height_range", "min must be less than max"))
    for i, entity in enumerate(scenario["entities"]):
        if entity["radius"] * 1000 < scenario["distance_step"]:
            errors.append(FieldError(f"entities.{i}.radius", "must be at least one distance step"))
        for key in ("frequency", "power"):
            if isinstance(entity[key], str):
                # No file store yet (POST /api/files, #46), so no file_id can exist.
                errors.append(FieldError(f"entities.{i}.{key}", "unknown file_id"))
    return errors


def expand_heights(scenario: JsonObject) -> Floats:
    """`height_range` + `height_step` as the list of heights, min first, never past max."""
    low = float(scenario["height_range"]["min"])
    high = float(scenario["height_range"]["max"])
    step = float(scenario["height_step"])
    count = int(np.floor((high - low) / step + 1e-9)) + 1
    return low + step * np.arange(count, dtype=np.float64)


def azimuths(scenario: JsonObject) -> Floats:
    """`360 / angular_resolution` rays, evenly spaced from 0°."""
    count = round(360 / float(scenario["angular_resolution"]))
    return np.arange(count, dtype=np.float64) * (360.0 / count)


def distances(scenario: JsonObject, entity: JsonObject) -> Floats:
    """`distance_step` ... `radius`, in metres, shared by all of an entity's rays."""
    step = float(scenario["distance_step"])
    count = int(np.floor(float(entity["radius"]) * 1000 / step + 1e-9))
    return step * np.arange(1, count + 1, dtype=np.float64)
