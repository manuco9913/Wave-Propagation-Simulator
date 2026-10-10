import json
from pathlib import Path
from typing import Any

from fastapi import FastAPI

CONTRACTS_DIR = Path(__file__).resolve().parents[2] / "contracts"

app = FastAPI(title="Wave Propagation Simulator")

JsonObject = dict[str, Any]


def _load_schema(name: str) -> JsonObject:
    return json.loads((CONTRACTS_DIR / f"{name}.schema.json").read_text(encoding="utf-8"))


@app.get("/api/schema/entity")
def entity_schema() -> JsonObject:
    return _load_schema("entity")


@app.get("/api/schema/scenario")
def scenario_schema() -> JsonObject:
    return _load_schema("scenario")
