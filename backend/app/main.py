import json
from pathlib import Path

from fastapi import FastAPI

CONTRACTS_DIR = Path(__file__).resolve().parents[2] / "contracts"

app = FastAPI(title="Wave Propagation Simulator")


def _load_schema(name: str) -> dict:
    return json.loads((CONTRACTS_DIR / f"{name}.schema.json").read_text(encoding="utf-8"))


@app.get("/api/schema/entity")
def entity_schema() -> dict:
    return _load_schema("entity")


@app.get("/api/schema/scenario")
def scenario_schema() -> dict:
    return _load_schema("scenario")
