import { useEffect, useMemo, useReducer, useState } from "react";
import { fetchSlice, type RunRef } from "../api";
import type { Slice } from "./slice";
import { SliceWindow } from "./sliceWindow";

export interface HeightSlices {
  index: number;
  setIndex: (index: number) => void;
  /** The focused level's slice, or the last one shown while it loads; null before any. */
  slice: Slice | null;
  loading: boolean;
  error: string | undefined;
}

/** The selected height level of a finished run, with its neighbours prefetched. */
export function useHeightSlices(run: RunRef | null, heights: readonly number[]): HeightSlices {
  const [, changed] = useReducer((n: number) => n + 1, 0);
  const window = useMemo(
    () =>
      run
        ? new SliceWindow((i) => fetchSlice(run, heights[i] ?? NaN), heights.length, changed)
        : null,
    [run, heights],
  );
  // The selection belongs to one run's window; a new run starts at its lowest level.
  const [selected, setSelected] = useState<{ window: typeof window; index: number }>({
    window: null,
    index: 0,
  });
  const index = selected.window === window ? selected.index : 0;

  useEffect(() => window?.focus(index), [window, index]);

  return {
    index,
    setIndex: (i) => setSelected({ window, index: i }),
    slice: window?.shown() ?? null,
    loading: window !== null && window.get(index) === undefined,
    error: window?.error(index),
  };
}
