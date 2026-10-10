import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiRequestError,
  rerunScenario,
  runEventsUrl,
  saveRun,
  submitScenario,
  type RunRef,
} from "../api";

/** SSE event payloads (contracts/api.md, Run Endpoints). */
interface ProgressEvent {
  message: string;
  percent: number;
}
interface DoneEvent {
  heights: number[];
}
interface ErrorEvent {
  error: string;
  message: string;
  retryable: boolean;
}

export type RunState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "running"; message: string; percent: number }
  | { kind: "done"; run: RunRef; heights: number[]; savedName: string | null }
  | { kind: "rejected"; message: string }
  | { kind: "failed"; message: string };

/**
 * The run on screen: submitting a scenario (the first time a new scenario, after that a re-run
 * of it), following it over SSE, saving it, or opening a saved one.
 *
 * Re-running over an unsaved result is refused by the server; the hook then holds the scenario
 * in `pendingDiscard` until the user confirms (the result is deleted) or cancels.
 */
export function useRun() {
  const [state, setState] = useState<RunState>({ kind: "idle" });
  const [pendingDiscard, setPendingDiscard] = useState<{ scenario: unknown } | null>(null);
  const source = useRef<EventSource | null>(null);
  const scenarioId = useRef<string | null>(null);

  const stop = useCallback(() => {
    source.current?.close();
    source.current = null;
  }, []);
  useEffect(() => stop, [stop]);

  const follow = useCallback(
    (run: RunRef, savedName: string | null) => {
      stop();
      const events = new EventSource(runEventsUrl(run));
      source.current = events;
      const onProgress = (e: Event) => {
        const data = parsePayload<ProgressEvent>(e);
        if (data) setState({ kind: "running", message: data.message, percent: data.percent });
      };
      events.addEventListener("status", onProgress);
      events.addEventListener("progress", onProgress);
      events.addEventListener("done", (e) => {
        stop();
        const heights = parsePayload<DoneEvent>(e)?.heights ?? [];
        setState({ kind: "done", run, heights, savedName });
      });
      events.addEventListener("error", (e) => {
        // Our `error` event carries data; a bare Event is the connection dropping, which
        // EventSource retries by itself (the server re-sends the status on reconnect).
        const data = parsePayload<ErrorEvent>(e);
        if (data) {
          stop();
          setState({ kind: "failed", message: data.message });
        } else if (events.readyState === EventSource.CLOSED) {
          stop();
          setState({ kind: "failed", message: "lost connection to the server" });
        }
      });
    },
    [stop],
  );

  const start = useCallback(
    async (scenario: unknown, discardUnsaved: boolean) => {
      setPendingDiscard(null);
      let run: RunRef;
      try {
        run = scenarioId.current
          ? await rerunScenario(scenarioId.current, scenario, discardUnsaved)
          : await submitScenario(scenario);
      } catch (e) {
        if (e instanceof ApiRequestError && e.body.error === "unsaved_run_exists") {
          setPendingDiscard({ scenario }); // the current result stays on screen meanwhile
          return;
        }
        setState({ kind: "rejected", message: rejection(e) });
        return;
      }
      scenarioId.current = run.scenario_id;
      setState({ kind: "submitting" });
      follow(run, null);
    },
    [follow],
  );

  const submit = useCallback((scenario: unknown) => start(scenario, false), [start]);

  const confirmDiscard = useCallback(async () => {
    if (pendingDiscard) await start(pendingDiscard.scenario, true);
  }, [pendingDiscard, start]);

  const cancelDiscard = useCallback(() => setPendingDiscard(null), []);

  /** Saves the finished run on screen under `name`; throws if the server refuses. */
  const save = useCallback(
    async (name: string) => {
      if (state.kind !== "done") return;
      await saveRun(state.run, name);
      setState({ ...state, savedName: name });
    },
    [state],
  );

  /** Opens a saved run. Later submits still re-run the scenario being edited, not this one. */
  const view = useCallback((run: RunRef, savedName: string) => follow(run, savedName), [follow]);

  return { state, submit, pendingDiscard, confirmDiscard, cancelDiscard, save, view };
}

function parsePayload<T>(e: Event): T | null {
  if (!(e instanceof MessageEvent) || typeof e.data !== "string") return null;
  return JSON.parse(e.data) as T;
}

function rejection(e: unknown): string {
  if (e instanceof ApiRequestError && e.body.fields?.length) {
    return e.body.fields.map((f) => `${f.field}: ${f.message}`).join("; ");
  }
  return errorMessage(e);
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
