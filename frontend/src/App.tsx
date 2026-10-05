import { useEffect, useState } from "react";
import { fetchSchemas } from "./api";
import styles from "./App.module.css";

type Status = "loading" | "ready" | "error";

export function App() {
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    let cancelled = false;
    fetchSchemas().then(
      () => !cancelled && setStatus("ready"),
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
        </div>
      </header>
      <div className={styles.body}>
        <aside className={styles.sidebar}>
          <h2 className={styles.title}>Scenario</h2>
          <div className={styles.label}>Entities</div>
        </aside>
        <main className={styles.map} aria-label="Map" />
      </div>
    </div>
  );
}
