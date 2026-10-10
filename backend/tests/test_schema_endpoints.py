import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app

CONTRACTS = Path(__file__).resolve().parents[2] / "contracts"
# No `with`: the lifespan (database, worker) doesn't run; schema endpoints don't need it.
client = TestClient(create_app(Settings("postgresql://unused", Path("unused"), 0)))


@pytest.mark.parametrize("name", ["entity", "scenario"])
def test_schema_endpoint_returns_contract_file(name: str) -> None:
    res = client.get(f"/api/schema/{name}")
    assert res.status_code == 200
    expected = json.loads((CONTRACTS / f"{name}.schema.json").read_text(encoding="utf-8"))
    assert res.json() == expected
