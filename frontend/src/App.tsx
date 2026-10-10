import { useEffect, useState } from "react";
import type { FieldValues } from "react-hook-form";
import { fetchSchemas, type Schemas } from "./api";
import styles from "./App.module.css";
import { Dialog, dialogStyles } from "./dialog/Dialog";
import { HeightControl } from "./height/HeightControl";
import { SavedRuns } from "./run/SavedRuns";
import { SavePanel } from "./run/SavePanel";
import { type HeightSlices, useHeightSlices } from "./run/useHeightSlices";
import { type RunState, useRun } from "./run/useRun";
import { ScenarioWorkspace } from "./scenario/ScenarioWorkspace";

type Status = "loading" | "ready" | "error";

export function App() {
  const [status, setStatus] = useState<Status>("loading");
  const [schemas, setSchemas] = useState<Schemas | null>(null);
  const run = useRun();
  const done = run.state.kind === "done" ? run.state : null;
  const heights = useHeightSlices(done?.run ?? null, done?.heights ?? NO_HEIGHTS);
  const [showSaved, setShowSaved] = useState(false);

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
    void run.submit(scenario);
  }

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
            {runStatusText(run.state, heights)}
          </div>
          <div className={styles.status} data-testid="schema-status">
            schemas: {status}
          </div>
          <button type="button" className={styles.topButton} onClick={() => setShowSaved(true)}>
            Saved runs
          </button>
        </div>
      </header>
      <ScenarioWorkspace
        schemas={schemas}
        onSubmit={submit}
        heatmap={heights.slice}
        mapOverlay={
          done ? (
            <div className={styles.overlayStack}>
              <SavePanel savedName={done.savedName} onSave={run.save} />
              {done.heights.length > 0 && (
                <HeightControl
                  heights={done.heights}
                  index={heights.index}
                  onChange={heights.setIndex}
                />
              )}
            </div>
          ) : null
        }
      />
      {run.pendingDiscard && (
        <Dialog
          title="Discard unsaved result?"
          role="alertdialog"
          actions={
            <>
              <button type="button" className={dialogStyles.button} onClick={run.cancelDiscard}>
                Cancel
              </button>
              <button
                type="button"
                className={`${dialogStyles.button} ${dialogStyles.danger}`}
                onClick={() => void run.confirmDiscard()}
              >
                Discard and run
              </button>
            </>
          }
        >
          The current result has not been saved. Running again deletes it. Save it first to keep it.
        </Dialog>
      )}
      {showSaved && (
        <SavedRuns
          onClose={() => setShowSaved(false)}
          onOpen={(ref, name) => {
            setShowSaved(false);
            run.view(ref, name);
          }}
        />
      )}
    </div>
  );
}

const NO_HEIGHTS: readonly number[] = [];

function runStatusText(state: RunState, heights: HeightSlices): string {
  switch (state.kind) {
    case "idle":
      return "";
    case "submitting":
      return "Submitting";
    case "running":
      return `${state.message} · ${Math.round(state.percent)}%`;
    case "done": {
      const height = `${state.heights[heights.index] ?? "–"} m`;
      if (heights.error) return `${height} · Failed: ${heights.error}`;
      if (heights.loading || !heights.slice) return `${height} · loading`;
      return `${height} · ${dbm(heights.slice.min)} … ${dbm(heights.slice.max)} dBm`;
    }
    case "rejected":
      return `Rejected: ${state.message}`;
    case "failed":
      return `Failed: ${state.message}`;
  }
}

function dbm(value: number): string {
  return Number.isFinite(value) ? String(Math.round(value * 10) / 10) : "–";
}
