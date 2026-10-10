import { useCallback, useEffect, useRef, useState } from "react";
import { ApiRequestError, fetchSlice, runEventsUrl, submitScenario, type RunRef } from "../api";
import type { Slice } from "./slice";

/** SSE event payloads (contracts/api.md, Run Endpoints). */
interface ProgressEvent {
  message: string;
  percent: number;
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
  | { kind: "loading-slice" }
  | { kind: "done"; heightM: number; slice: Slice }
  | { kind: "rejected"; message: string }
  | { kind: "failed"; message: string };

/** Submits a scenario, follows its run over SSE, then loads the slice at `heightM`. */
export function useRun() {
  const [state, setState] = useState<RunState>({ kind: "idle" });
  const source = useRef<EventSource | null>(null);

  const stop = useCallback(() => {
    source.current?.close();
    source.current = null;
  }, []);
  useEffect(() => stop, [stop]);

  const submit = useCallback(
    async (scenario: unknown, heightM: number) => {
      stop();
      setState({ kind: "submitting" });
      let run: RunRef;
      try {
        run = await submitScenario(scenario);
      } catch (e) {
        setState({ kind: "rejected", message: rejection(e) });
        return;
      }

      const events = new EventSource(runEventsUrl(run));
      source.current = events;
      const onProgress = (e: Event) => {
        const data = parsePayload<ProgressEvent>(e);
        if (data) setState({ kind: "running", message: data.message, percent: data.percent });
      };
      events.addEventListener("status", onProgress);
      events.addEventListener("progress", onProgress);
      events.addEventListener("done", () => {
        stop();
        setState({ kind: "loading-slice" });
        fetchSlice(run, heightM).then(
          (slice) => setState({ kind: "done", heightM, slice }),
          (err: unknown) => setState({ kind: "failed", message: errorMessage(err) }),
        );
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

  return { state, submit };
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

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
