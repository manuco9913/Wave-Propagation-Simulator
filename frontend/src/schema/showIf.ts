// Evaluates a field's `x-show-if` condition (see contracts.md, "Conditional Visibility").

export type ShowIfOp = "eq" | "neq" | "gt" | "gte" | "lt" | "lte";
export interface ShowIfClause {
  field: string;
  op: ShowIfOp;
  value: unknown;
}
export type ShowIfCondition = { and: ShowIfClause[] } | { or: ShowIfClause[] };

/**
 * Whether a field with `condition` is shown, given the values of the object it lives in.
 * `field` may be a dotted path into nested objects. A clause on a missing value is false.
 */
export function evaluateShowIf(
  condition: ShowIfCondition | undefined,
  values: Record<string, unknown>,
): boolean {
  if (!condition) return true;
  if ("and" in condition) return condition.and.every((c) => clauseHolds(c, values));
  return condition.or.some((c) => clauseHolds(c, values));
}

function clauseHolds({ field, op, value }: ShowIfClause, values: Record<string, unknown>) {
  const actual = readPath(values, field);
  if (actual === undefined) return false;
  if (op === "eq") return actual === value;
  if (op === "neq") return actual !== value;
  if (typeof actual !== "number" || typeof value !== "number") return false;
  if (op === "gt") return actual > value;
  if (op === "gte") return actual >= value;
  if (op === "lt") return actual < value;
  return actual <= value;
}

function readPath(values: Record<string, unknown>, path: string): unknown {
  let current: unknown = values;
  for (const key of path.split(".")) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}
