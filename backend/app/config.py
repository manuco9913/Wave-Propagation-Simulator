import os
from dataclasses import dataclass
from pathlib import Path

DEFAULT_RUNS_DIR = Path(__file__).resolve().parents[1] / "runs"


@dataclass(frozen=True)
class Settings:
    database_url: str  # PostgreSQL DSN
    runs_dir: Path  # runs/tmp/<run_id>/ holds each unsaved run (system-plan.md, Per-Run Store)
    fake_engine_delay_s: float  # spread over each entity's heights, so progress is visible

    @staticmethod
    def from_env() -> "Settings":
        """Read once at startup (CODING_STANDARDS.md, Configuration)."""
        database_url = os.environ.get("DATABASE_URL")
        if not database_url:
            raise RuntimeError("DATABASE_URL is not set (e.g. postgresql://user@localhost/wps)")
        return Settings(
            database_url=database_url,
            runs_dir=Path(os.environ.get("RUNS_DIR", DEFAULT_RUNS_DIR)),
            fake_engine_delay_s=float(os.environ.get("FAKE_ENGINE_DELAY_S", "2")),
        )
