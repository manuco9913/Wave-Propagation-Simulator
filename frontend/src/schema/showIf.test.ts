import { evaluateShowIf } from "./showIf";

test("no condition means always shown", () => {
  expect(evaluateShowIf(undefined, {})).toBe(true);
});

test.each([
  ["eq", 5, 5, true],
  ["eq", 5, 6, false],
  ["neq", 5, 6, true],
  ["neq", 5, 5, false],
  ["gt", 6, 5, true],
  ["gt", 5, 5, false],
  ["gte", 5, 5, true],
  ["gte", 4, 5, false],
  ["lt", 4, 5, true],
  ["lt", 5, 5, false],
  ["lte", 5, 5, true],
  ["lte", 6, 5, false],
] as const)("%s: field=%s vs %s -> %s", (op, actual, expected, shown) => {
  const condition = { and: [{ field: "x", op, value: expected }] };
  expect(evaluateShowIf(condition, { x: actual })).toBe(shown);
});

test("eq compares booleans and strings", () => {
  const condition = { and: [{ field: "terrain_enabled", op: "eq" as const, value: true }] };
  expect(evaluateShowIf(condition, { terrain_enabled: true })).toBe(true);
  expect(evaluateShowIf(condition, { terrain_enabled: false })).toBe(false);
  const enumCondition = { or: [{ field: "method", op: "eq" as const, value: "max" }] };
  expect(evaluateShowIf(enumCondition, { method: "max" })).toBe(true);
});

test("and requires every clause, or requires any clause", () => {
  const clauses = [
    { field: "terrain_enabled", op: "eq" as const, value: true },
    { field: "angular_resolution", op: "lt" as const, value: 1 },
  ];
  const values = { terrain_enabled: true, angular_resolution: 1.5 };
  expect(evaluateShowIf({ and: clauses }, values)).toBe(false);
  expect(evaluateShowIf({ or: clauses }, values)).toBe(true);
});

test("a clause on a missing field is false, whatever the op", () => {
  expect(evaluateShowIf({ and: [{ field: "x", op: "neq", value: 1 }] }, {})).toBe(false);
  expect(evaluateShowIf({ or: [{ field: "x", op: "lt", value: 1 }] }, { y: 0 })).toBe(false);
});

test("ordering ops are false for non-numbers", () => {
  expect(evaluateShowIf({ and: [{ field: "x", op: "gt", value: 1 }] }, { x: "5" })).toBe(false);
});

test("dotted field paths reach into nested objects of the same form object", () => {
  const condition = { and: [{ field: "position.lat", op: "gt" as const, value: 0 }] };
  expect(evaluateShowIf(condition, { position: { lat: 10, lon: 0 } })).toBe(true);
  expect(evaluateShowIf(condition, { position: { lat: -10, lon: 0 } })).toBe(false);
});
