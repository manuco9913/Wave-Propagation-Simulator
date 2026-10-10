"""A real PostgreSQL per test (CODING_STANDARDS.md: the database goes in real).

TEST_DATABASE_URL points at a server where the user may create databases; each test gets a
fresh one, dropped afterwards. Without it, DB tests are skipped, unless WPS_REQUIRE_DB=1 (CI),
which makes them fail instead.
"""

import asyncio
import os
import uuid
from collections.abc import Iterator
from urllib.parse import urlparse

import asyncpg
import pytest

ADMIN_URL = os.environ.get("TEST_DATABASE_URL")


async def _admin(sql: str) -> None:
    assert ADMIN_URL is not None
    conn = await asyncpg.connect(ADMIN_URL)
    try:
        await conn.execute(sql)
    finally:
        await conn.close()


@pytest.fixture
def database_url() -> Iterator[str]:
    if not ADMIN_URL:
        message = "TEST_DATABASE_URL is not set"
        if os.environ.get("WPS_REQUIRE_DB") == "1":
            pytest.fail(message)
        pytest.skip(message)
    name = f"wps_test_{uuid.uuid4().hex[:12]}"
    asyncio.run(_admin(f'CREATE DATABASE "{name}"'))
    try:
        yield urlparse(ADMIN_URL)._replace(path=f"/{name}").geturl()
    finally:
        asyncio.run(_admin(f'DROP DATABASE "{name}" WITH (FORCE)'))
