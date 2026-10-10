import { useEffect, useState } from "react";
import { getScenario, listScenarios, type RunRef } from "../api";
import { Dialog, dialogStyles } from "../dialog/Dialog";
import { errorMessage } from "./useRun";
import styles from "./SavedRuns.module.css";

interface SavedRun {
  run: RunRef;
  scenarioName: string;
  savedName: string;
}

type Props = {
  onOpen: (run: RunRef, savedName: string) => void;
  onClose: () => void;
};

/** Every saved run, across scenarios, newest scenario first; picking one opens it. */
export function SavedRuns({ onOpen, onClose }: Props) {
  const [runs, setRuns] = useState<SavedRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadSavedRuns().then(
      (loaded) => !cancelled && setRuns(loaded),
      (e: unknown) => !cancelled && setError(errorMessage(e)),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Dialog
      title="Saved runs"
      role="dialog"
      actions={
        <button type="button" className={dialogStyles.button} onClick={onClose}>
          Close
        </button>
      }
    >
      {error && <p role="alert">{error}</p>}
      {!error && runs === null && <p className={styles.muted}>Loading</p>}
      {runs?.length === 0 && <p className={styles.muted}>No saved runs yet.</p>}
      {runs && runs.length > 0 && (
        <ul className={styles.list}>
          {runs.map((r) => (
            <li key={r.run.run_id}>
              <button
                type="button"
                className={styles.item}
                onClick={() => onOpen(r.run, r.savedName)}
              >
                {r.scenarioName} · {r.savedName}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

async function loadSavedRuns(): Promise<SavedRun[]> {
  const scenarios = (await listScenarios()).filter((s) => s.run_count > 0);
  const details = await Promise.all(scenarios.map((s) => getScenario(s.scenario_id)));
  return details.flatMap((detail, i) =>
    detail.runs.flatMap((r) =>
      r.saved_name === null
        ? []
        : [
            {
              run: { scenario_id: detail.scenario_id, run_id: r.run_id },
              scenarioName: scenarios[i]?.name ?? "",
              savedName: r.saved_name,
            },
          ],
    ),
  );
}
