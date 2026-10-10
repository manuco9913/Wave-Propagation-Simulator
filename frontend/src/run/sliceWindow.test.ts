import { SliceWindow } from "./sliceWindow";

function deferredFetcher() {
  const requested: number[] = [];
  const resolvers = new Map<number, (v: string) => void>();
  const rejecters = new Map<number, (e: Error) => void>();
  const fetch = (index: number) => {
    requested.push(index);
    return new Promise<string>((resolve, reject) => {
      resolvers.set(index, resolve);
      rejecters.set(index, reject);
    });
  };
  return { fetch, requested, resolvers, rejecters };
}

test("focusing a level fetches it and the two levels either side, nothing else", () => {
  const f = deferredFetcher();
  const window = new SliceWindow(f.fetch, 10, () => {});

  window.focus(5);

  expect(f.requested).toEqual([5, 4, 6, 3, 7]);
});

test("the window is clipped at the ends of the height axis", () => {
  const f = deferredFetcher();
  const window = new SliceWindow(f.fetch, 3, () => {});

  window.focus(0);

  expect(f.requested).toEqual([0, 1, 2]);
});

test("moving one level fetches only the new edge and drops the level that fell out", async () => {
  const f = deferredFetcher();
  const changed = vi.fn<() => void>();
  const window = new SliceWindow(f.fetch, 10, changed);
  window.focus(5);
  for (const [i, resolve] of f.resolvers) resolve(`slice ${i}`);
  await Promise.resolve();

  window.focus(6);

  expect(f.requested.slice(5)).toEqual([8]);
  expect(window.get(6)).toBe("slice 6"); // already prefetched: available immediately
  expect(window.get(3)).toBeUndefined(); // evicted
  expect(changed).toHaveBeenCalled();
});

test("a failed fetch is forgotten, so focusing again retries it", async () => {
  const f = deferredFetcher();
  const window = new SliceWindow(f.fetch, 1, () => {});
  window.focus(0);
  f.rejecters.get(0)!(new Error("boom"));
  await Promise.resolve();
  await Promise.resolve();

  expect(window.error(0)).toBe("boom");
  window.focus(0);

  expect(f.requested).toEqual([0, 0]);
});

test("a slice arriving after it was evicted is not kept", async () => {
  const f = deferredFetcher();
  const window = new SliceWindow(f.fetch, 20, () => {});
  window.focus(2);
  window.focus(15);
  f.resolvers.get(2)!("late");
  await Promise.resolve();

  expect(window.get(2)).toBeUndefined();
});

test("while the focused level loads, the last ready focused slice stays shown", async () => {
  const f = deferredFetcher();
  const window = new SliceWindow(f.fetch, 20, () => {});
  window.focus(0);
  f.resolvers.get(0)!("slice 0");
  await Promise.resolve();
  expect(window.shown()).toBe("slice 0");

  window.focus(10); // far away: nothing prefetched there

  expect(window.get(10)).toBeUndefined();
  expect(window.shown()).toBe("slice 0");
  f.resolvers.get(10)!("slice 10");
  await Promise.resolve();
  expect(window.shown()).toBe("slice 10");
});
