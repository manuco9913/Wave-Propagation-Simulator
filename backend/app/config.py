import os
from dataclasses import dataclass
from pathlib import Path

DEFAULT_RUNS_DIR = Path(__file__).resolve().parents[1] / "runs"


@dataclass(frozen=True)
class Settings:
    runs_dir: Path  # runs/tmp/<run_id>/ holds each unsaved run (system-plan.md, Per-Run Store)
    fake_engine_delay_s: float  # spread over each entity's heights, so progress is visible

    @staticmethod
    def from_env() -> "Settings":
        """Read once at startup (CODING_STANDARDS.md, Configuration)."""
        return Settings(
            runs_dir=Path(os.environ.get("RUNS_DIR", DEFAULT_RUNS_DIR)),
            fake_engine_delay_s=float(os.environ.get("FAKE_ENGINE_DELAY_S", "2")),
        )
