import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app

CONTRACTS = Path(__file__).resolve().parents[2] / "contracts"
client = TestClient(app)


@pytest.mark.parametrize("name", ["entity", "scenario"])
def test_schema_endpoint_returns_contract_file(name: str) -> None:
    res = client.get(f"/api/schema/{name}")
    assert res.status_code == 200
    expected = json.loads((CONTRACTS / f"{name}.schema.json").read_text(encoding="utf-8"))
    assert res.json() == expected
