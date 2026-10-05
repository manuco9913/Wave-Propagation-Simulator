export type JsonSchema = Record<string, unknown>;

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
