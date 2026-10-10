/** How many levels either side of the focused one are kept loaded. */
export const PREFETCH_RADIUS = 2;

type Entry<T> =
  { state: "loading" } | { state: "ready"; value: T } | { state: "failed"; message: string };

/**
 * A ring buffer of height slices around the focused level: focusing a level fetches it and its
 * neighbours (±PREFETCH_RADIUS) in the background and drops everything outside, so scrubbing
 * one level at a time finds the next slice already loaded.
 */
export class SliceWindow<T> {
  private entries = new Map<number, Entry<T>>();
  private focused = 0;
  private lastShown: T | undefined;
  private readonly fetchLevel: (index: number) => Promise<T>;
  private readonly levels: number;
  private readonly onChange: () => void;

  constructor(fetchLevel: (index: number) => Promise<T>, levels: number, onChange: () => void) {
    this.fetchLevel = fetchLevel;
    this.levels = levels;
    this.onChange = onChange;
  }

  focus(index: number): void {
    this.focused = index;
    // nearest first, so the focused level is requested before its neighbours
    const wanted = [index];
    for (let d = 1; d <= PREFETCH_RADIUS; d++) wanted.push(index - d, index + d);
    const inRange = wanted.filter((i) => i >= 0 && i < this.levels);

    for (const key of [...this.entries.keys()]) {
      if (!inRange.includes(key)) this.entries.delete(key);
    }
    for (const i of inRange) {
      const entry = this.entries.get(i);
      if (!entry || entry.state === "failed") this.load(i);
    }
    this.onChange();
  }

  /** The focused level's slice; while it loads, the last focused slice that was ready. */
  shown(): T | undefined {
    const current = this.get(this.focused);
    if (current !== undefined) this.lastShown = current;
    return this.lastShown;
  }

  get(index: number): T | undefined {
    const entry = this.entries.get(index);
    return entry?.state === "ready" ? entry.value : undefined;
  }

  error(index: number): string | undefined {
    const entry = this.entries.get(index);
    return entry?.state === "failed" ? entry.message : undefined;
  }

  private load(index: number): void {
    const entry: Entry<T> = { state: "loading" };
    this.entries.set(index, entry);
    const settle = (next: Entry<T>) => {
      if (this.entries.get(index) !== entry) return; // evicted or refetched meanwhile
      this.entries.set(index, next);
      this.onChange();
    };
    this.fetchLevel(index).then(
      (value) => settle({ state: "ready", value }),
      (e: unknown) =>
        settle({ state: "failed", message: e instanceof Error ? e.message : String(e) }),
    );
  }
}
