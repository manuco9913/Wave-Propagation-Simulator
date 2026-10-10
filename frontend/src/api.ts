import { parseSlice, type Slice } from "./run/slice";
import type { JsonSchema } from "./schema/jsonSchema";

export interface Schemas {
  entity: JsonSchema;
  scenario: JsonSchema;
}

async function fetchJson(url: string): Promise<JsonSchema> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} failed: ${res.status}`);
  return (await res.json()) as JsonSchema;
}

export async function fetchSchemas(): Promise<Schemas> {
  const [entity, scenario] = await Promise.all([
    fetchJson("/api/schema/entity"),
    fetchJson("/api/schema/scenario"),
  ]);
  return { entity, scenario };
}

/** The one error shape every non-2xx response has (contracts/api.md, Error format). */
export interface ApiError {
  error: string;
  message: string;
  fields?: { field: string; message: string }[];
}

export class ApiRequestError extends Error {
  readonly body: ApiError;
  constructor(body: ApiError) {
    super(body.message);
    this.body = body;
  }
}

async function apiError(res: Response): Promise<ApiRequestError> {
  try {
    return new ApiRequestError((await res.json()) as ApiError);
  } catch {
    return new ApiRequestError({ error: "http_error", message: `HTTP ${res.status}` });
  }
}

export interface RunRef {
  scenario_id: string;
  run_id: string;
}

export async function submitScenario(scenario: unknown): Promise<RunRef> {
  const res = await fetch("/api/scenarios", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(scenario),
  });
  if (!res.ok) throw await apiError(res);
  return (await res.json()) as RunRef;
}

function runUrl({ scenario_id, run_id }: RunRef): string {
  return `/api/scenarios/${scenario_id}/runs/${run_id}`;
}

export function runEventsUrl(run: RunRef): string {
  return `${runUrl(run)}/events`;
}

export async function fetchSlice(run: RunRef, heightM: number): Promise<Slice> {
  const res = await fetch(`${runUrl(run)}/slices/${heightM}`);
  if (!res.ok) throw await apiError(res);
  return parseSlice(await res.arrayBuffer());
}
