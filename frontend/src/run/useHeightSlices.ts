import { useEffect, useMemo, useReducer, useRef, useState } from "react";
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
  const [index, setIndex] = useState(0);
  const [, changed] = useReducer((n: number) => n + 1, 0);
  const window = useMemo(
    () =>
      run
        ? new SliceWindow((i) => fetchSlice(run, heights[i] ?? NaN), heights.length, changed)
        : null,
    [run, heights],
  );
  const lastShown = useRef<{ window: SliceWindow<Slice>; slice: Slice } | null>(null);

  useEffect(() => setIndex(0), [window]);
  useEffect(() => window?.focus(Math.min(index, heights.length - 1)), [window, index, heights]);

  const current = window?.get(index);
  if (window && current) lastShown.current = { window, slice: current };
  const shown = lastShown.current?.window === window ? lastShown.current?.slice : undefined;
  return {
    index,
    setIndex,
    slice: shown ?? null,
    loading: Boolean(window) && !current,
    error: window?.error(index),
  };
}
