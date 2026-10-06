import type { ShowIfCondition } from "./showIf";

/** The subset of JSON Schema (draft-07 + this repo's `x-` extensions) the frontend reads. */
export interface JsonSchema {
  $id?: string;
  $ref?: string;
  type?: string;
  title?: string;
  description?: string;
  enum?: readonly (string | number)[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  minItems?: number;
  maxItems?: number;
  required?: readonly string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  oneOf?: readonly JsonSchema[];
  "x-unit"?: string;
  "x-ui-component"?: string;
  "x-show-if"?: ShowIfCondition;
}
