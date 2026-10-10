import { useEffect, useState } from "react";
import type { FieldValues } from "react-hook-form";
import { fetchSchemas, type Schemas } from "./api";
import styles from "./App.module.css";
import { type RunState, useRun } from "./run/useRun";
import { ScenarioWorkspace } from "./scenario/ScenarioWorkspace";

type Status = "loading" | "ready" | "error";

export function App() {
  const [status, setStatus] = useState<Status>("loading");
  const [schemas, setSchemas] = useState<Schemas | null>(null);
  const run = useRun();

  useEffect(() => {
    let cancelled = false;
    fetchSchemas().then(
      (loaded) => {
        if (cancelled) return;
        setSchemas(loaded);
        setStatus("ready");
      },
      () => !cancelled && setStatus("error"),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  function submit(scenario: FieldValues) {
    // One height for now: the lowest. The height slider comes with #33.
    const lowest: unknown = scenario.height_range?.min;
    void run.submit(scenario, typeof lowest === "number" ? lowest : 0);
  }

  const heatmap = run.state.kind === "done" ? run.state.slice : null;
  const busy = run.state.kind === "running" || run.state.kind === "submitting";

  return (
    <div className={styles.app}>
      <span className={`${styles.corner} ${styles.tl}`} />
      <span className={`${styles.corner} ${styles.tr}`} />
      <span className={`${styles.corner} ${styles.bl}`} />
      <span className={`${styles.corner} ${styles.br}`} />
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <span className={styles.mark} />
          Wave Propagation Simulator
        </div>
        <div className={styles.statusGroup}>
          <div
            className={styles.runStatus}
            data-testid="run-status"
            data-busy={busy ? "" : undefined}
            role="status"
          >
            {runStatusText(run.state)}
          </div>
          <div className={styles.status} data-testid="schema-status">
            schemas: {status}
          </div>
        </div>
      </header>
      <ScenarioWorkspace schemas={schemas} onSubmit={submit} heatmap={heatmap} />
    </div>
  );
}

function runStatusText(state: RunState): string {
  switch (state.kind) {
    case "idle":
      return "";
    case "submitting":
      return "Submitting";
    case "running":
      return `${state.message} · ${Math.round(state.percent)}%`;
    case "loading-slice":
      return "Loading result";
    case "done":
      return `${state.heightM} m · ${dbm(state.slice.min)} … ${dbm(state.slice.max)} dBm`;
    case "rejected":
      return `Rejected: ${state.message}`;
    case "failed":
      return `Failed: ${state.message}`;
  }
}

function dbm(value: number): string {
  return Number.isFinite(value) ? String(Math.round(value * 10) / 10) : "–";
}
