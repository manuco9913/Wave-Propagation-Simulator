import { useState } from "react";
import styles from "./HeightControl.module.css";

type Props = {
  heights: readonly number[];
  index: number;
  onChange: (index: number) => void;
};

/** Height slider plus an exact-value input, kept in sync. Typing snaps to the nearest level. */
export function HeightControl({ heights, index, onChange }: Props) {
  const current = heights[index];
  // What's typed, while it belongs to the level it was typed at; else the level's value.
  const [typed, setTyped] = useState<{ at: number | undefined; text: string } | null>(null);
  const draft = typed && typed.at === current ? typed.text : String(current ?? "");
  const setDraft = (text: string) => setTyped({ at: current, text });

  function commit() {
    const value = Number(draft);
    setTyped(null);
    if (draft.trim() === "" || !Number.isFinite(value)) return;
    onChange(nearestIndex(heights, value));
  }

  return (
    <div className={styles.panel}>
      <div className={styles.label}>Height</div>
      <input
        className={styles.slider}
        type="range"
        aria-label="Height level"
        min={0}
        max={Math.max(heights.length - 1, 0)}
        step={1}
        value={index}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <label className={styles.exact}>
        <input
          className={styles.input}
          type="number"
          aria-label="Height"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && commit()}
        />
        <span className={styles.unit}>m</span>
      </label>
    </div>
  );
}

function nearestIndex(heights: readonly number[], value: number): number {
  let best = 0;
  heights.forEach((h, i) => {
    if (Math.abs(h - value) < Math.abs((heights[best] ?? Infinity) - value)) best = i;
  });
  return best;
}
