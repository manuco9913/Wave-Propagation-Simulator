import { useEffect, useState } from "react";
import { fetchSchemas, type Schemas } from "./api";
import styles from "./App.module.css";
import { ScenarioWorkspace } from "./scenario/ScenarioWorkspace";

type Status = "loading" | "ready" | "error";

export function App() {
  const [status, setStatus] = useState<Status>("loading");
  const [schemas, setSchemas] = useState<Schemas | null>(null);
  const [scenarioValid, setScenarioValid] = useState(false);

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
        <div className={styles.status} data-testid="schema-status">
          schemas: {status}
          {/* Submitting to the backend lands with #31; for now a valid form is the end of the line. */}
          {scenarioValid && " · scenario: valid"}
        </div>
      </header>
      <ScenarioWorkspace schemas={schemas} onSubmit={() => setScenarioValid(true)} />
    </div>
  );
}
