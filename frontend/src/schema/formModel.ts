// Turns the served JSON Schemas into what react-hook-form needs: default values and a
// resolver that validates with ajv against the same schemas the backend uses.
import { toNestErrors } from "@hookform/resolvers";
import Ajv, { type ErrorObject } from "ajv";
import type { FieldError, FieldValues, Resolver } from "react-hook-form";
import type { Schemas } from "../api";
import type { JsonSchema } from "./jsonSchema";

/** Values for every property (recursively) that declares a `default`. */
export function defaultValues(schema: JsonSchema): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(schema.properties ?? {})) {
    if (field.default !== undefined) {
      values[key] = field.default;
    } else if (field.type === "object" && field.properties) {
      const nested = defaultValues(field);
      if (Object.keys(nested).length > 0) values[key] = nested;
    }
  }
  return values;
}

/** Validates a whole scenario (entities included, via the scenario's `$ref` to the entity schema). */
export function createScenarioResolver({ entity, scenario }: Schemas): Resolver<FieldValues> {
  const ajv = new Ajv({ allErrors: true, strict: false, verbose: true });
  ajv.addSchema(entity, entity.$id ? undefined : "entity");
  const validate = ajv.compile(scenario);

  return async (values, _context, options) => {
    if (validate(values)) return { values, errors: {} };
    const flat: Record<string, FieldError> = {};
    for (const error of validate.errors ?? []) {
      flat[errorPath(error)] ??= { type: error.keyword, message: errorMessage(error) };
    }
    return { values: {}, errors: toNestErrors(flat, options) };
  };
}

/** `/entities/0/radius` -> `entities.0.radius`; array-level errors go to `<array>.root`. */
function errorPath(error: ErrorObject): string {
  const segments = error.instancePath.split("/").slice(1);
  if (error.keyword === "required") segments.push(String(error.params["missingProperty"]));
  if (error.keyword === "minItems" || error.keyword === "maxItems") segments.push("root");
  return segments.join(".");
}

function errorMessage(error: ErrorObject): string {
  const schema = (error.parentSchema ?? {}) as JsonSchema;
  const unit = schema["x-unit"];
  const withUnit = (n: unknown) => `${String(n)}${!unit ? "" : unit === "°" ? "°" : ` ${unit}`}`;
  const limit: unknown = error.params["limit"];
  const noun = schema.title?.toLowerCase() ?? "items";
  switch (error.keyword) {
    case "required":
      return "Required";
    case "minLength":
      return limit === 1 ? "Required" : `At least ${String(limit)} characters`;
    case "minimum":
      return `Must be ≥ ${withUnit(limit)}`;
    case "maximum":
      return `Must be ≤ ${withUnit(limit)}`;
    case "exclusiveMinimum":
      return `Must be > ${withUnit(limit)}`;
    case "exclusiveMaximum":
      return `Must be < ${withUnit(limit)}`;
    case "type":
      return `Must be a ${String(error.params["type"])}`;
    case "minItems":
      return `At least ${String(limit)} ${noun}`;
    case "maxItems":
      return `At most ${String(limit)} ${noun}`;
    case "enum":
      return `Must be one of: ${(schema.enum ?? []).join(", ")}`;
    default:
      return error.message ?? "Invalid value";
  }
}
