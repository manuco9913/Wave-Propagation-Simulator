import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { FieldValues } from "react-hook-form";
import type { Schemas } from "../api";
import { ScenarioWorkspace } from "./ScenarioWorkspace";

// Made-up schemas: the form must work from whatever the backend serves, not the real contracts.
function fixtureSchemas(minEntities = 1): Schemas {
  return {
    entity: {
      $id: "entity",
      type: "object",
      required: ["label", "position", "radius"],
      properties: {
        label: { type: "string", title: "Label" },
        position: {
          type: "object",
          title: "Position",
          "x-ui-component": "coordinate",
          required: ["lat", "lon"],
          properties: {
            lat: { type: "number", minimum: -90, maximum: 90 },
            lon: { type: "number", minimum: -180, maximum: 180 },
          },
        },
        radius: { type: "number", title: "Radius", minimum: 0.1, "x-unit": "km" },
      },
    },
    scenario: {
      $id: "scenario",
      type: "object",
      required: ["name", "terrain_enabled", "entities"],
      properties: {
        name: { type: "string", title: "Name", minLength: 1 },
        terrain_enabled: { type: "boolean", title: "Terrain Enabled", default: true },
        terrain_step: {
          type: "number",
          title: "Terrain Step",
          default: 30,
          "x-unit": "m",
          "x-show-if": { and: [{ field: "terrain_enabled", op: "eq", value: true }] },
        },
        method: { type: "string", title: "Method", enum: ["max", "sum"], default: "max" },
        entities: {
          type: "array",
          title: "Entities",
          minItems: minEntities,
          items: { $ref: "entity" },
        },
      },
    },
  };
}

function setup(schemas = fixtureSchemas()) {
  const onSubmit = vi.fn<(scenario: FieldValues) => void>();
  render(<ScenarioWorkspace schemas={schemas} onSubmit={onSubmit} />);
  return { onSubmit };
}

function type(label: string, value: string) {
  const input = screen.getByLabelText(label);
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

function fillValidScenario() {
  type("Name", "Run 1");
  type("Label", "TX-1");
  type("Lat", "42");
  type("Lon", "12.5");
  type("Radius", "10");
}

const submit = () => fireEvent.click(screen.getByRole("button", { name: /run simulation/i }));

test("renders one input per schema field, with defaults and unit suffixes", () => {
  setup();
  expect(screen.getByLabelText("Name")).toHaveValue("");
  expect(screen.getByLabelText("Terrain Enabled")).toBeChecked();
  expect(screen.getByLabelText("Terrain Step")).toHaveValue(30);
  expect(screen.getByLabelText("Method")).toHaveValue("max");
  const radius = screen.getByLabelText("Radius").closest("[data-field]");
  expect(radius).toHaveTextContent("km");
});

test("a field with x-show-if hides and shows live as its dependency changes", () => {
  setup();
  fireEvent.click(screen.getByLabelText("Terrain Enabled"));
  expect(screen.queryByLabelText("Terrain Step")).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("Terrain Enabled"));
  expect(screen.getByLabelText("Terrain Step")).toBeInTheDocument();
});

test("submitting invalid data shows inline errors and does not submit", async () => {
  const { onSubmit } = setup();
  type("Radius", "0");
  submit();

  const radiusField = screen.getByLabelText("Radius").closest("[data-field]") as HTMLElement;
  expect(await within(radiusField).findByText("Must be ≥ 0.1 km")).toBeInTheDocument();
  const nameField = screen.getByLabelText("Name").closest("[data-field]") as HTMLElement;
  expect(within(nameField).getByText("Required")).toBeInTheDocument();
  expect(onSubmit).not.toHaveBeenCalled();
});

test("a field is validated when it loses focus, before any submit", async () => {
  setup();
  type("Lat", "95");
  const latField = screen.getByLabelText("Lat").closest("[data-field]") as HTMLElement;
  expect(await within(latField).findByText("Must be ≤ 90")).toBeInTheDocument();
  // Untouched fields stay quiet until submit.
  expect(screen.queryByText("Required")).not.toBeInTheDocument();
});

test("valid data submits a scenario shaped like the schema, without hidden fields", async () => {
  const { onSubmit } = setup();
  fillValidScenario();
  fireEvent.click(screen.getByLabelText("Terrain Enabled"));
  submit();

  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  expect(onSubmit).toHaveBeenCalledWith({
    name: "Run 1",
    terrain_enabled: false,
    method: "max",
    entities: [{ label: "TX-1", position: { lat: 42, lon: 12.5 }, radius: 10 }],
  });
});

test("an entity-list constraint shows a form-level error", async () => {
  const { onSubmit } = setup(fixtureSchemas(2));
  fillValidScenario();
  submit();

  expect(await screen.findByRole("alert")).toHaveTextContent("At least 2 entities");
  expect(onSubmit).not.toHaveBeenCalled();
});
