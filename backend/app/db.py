"""PostgreSQL connections and the migration runner (system-plan.md, Backend: DB migrations)."""

from pathlib import Path

import asyncpg

MIGRATIONS_DIR = Path(__file__).resolve().parents[1] / "migrations"
# Any constant; only processes applying migrations take this advisory lock.
MIGRATION_LOCK = 0x57505331_00000001


async def apply_migrations(dsn: str, migrations_dir: Path = MIGRATIONS_DIR) -> list[str]:
    """Applies the numbered *.sql files not yet in `schema_migrations`, in order.

    Each file runs in its own transaction and a failure raises, which stops startup. Applied
    files are never edited; a fix goes in a new file. Returns the names applied now.
    """
    conn = await asyncpg.connect(dsn)
    try:
        await conn.execute("SELECT pg_advisory_lock($1)", MIGRATION_LOCK)
        await conn.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations ("
            " name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"
        )
        done = {r["name"] for r in await conn.fetch("SELECT name FROM schema_migrations")}
        applied: list[str] = []
        for path in sorted(migrations_dir.glob("[0-9][0-9][0-9]_*.sql")):
            if path.name in done:
                continue
            async with conn.transaction():
                await conn.execute(path.read_text(encoding="utf-8"))
                await conn.execute("INSERT INTO schema_migrations (name) VALUES ($1)", path.name)
            applied.append(path.name)
        return applied
    finally:
        await conn.close()  # also releases the advisory lock
