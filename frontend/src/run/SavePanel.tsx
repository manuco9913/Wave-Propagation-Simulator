import { useState } from "react";
import { errorMessage } from "./useRun";
import styles from "./SavePanel.module.css";

type Props = {
  savedName: string | null;
  onSave: (name: string) => Promise<void>;
};

/** Names and saves the finished run on screen; once saved, says under which name. */
export function SavePanel({ savedName, onSave }: Props) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (savedName !== null) {
    return (
      <div className={styles.panel}>
        <span className={styles.saved}>Saved as {savedName}</span>
      </div>
    );
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onSave(name.trim());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className={styles.panel} onSubmit={save}>
      <span className={styles.unsaved}>Unsaved result</span>
      <input
        className={styles.input}
        aria-label="Run name"
        placeholder="Name this run"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <button className={styles.button} type="submit" disabled={saving || !name.trim()}>
        Save run
      </button>
      {error && (
        <span role="alert" className={styles.error}>
          {error}
        </span>
      )}
    </form>
  );
}
