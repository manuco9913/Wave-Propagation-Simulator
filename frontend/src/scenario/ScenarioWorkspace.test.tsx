import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { FieldValues } from "react-hook-form";
import type { Schemas } from "../api";
import { ScenarioWorkspace } from "./ScenarioWorkspace";

// Made-up schemas: the form must work from whatever the backend serves, not the real contracts.
function fixtureSchemas(minEntities = 1, maxEntities = 10): Schemas {
  return {
    entity: {
      $id: "entity",
      type: "object",
      required: ["label", "position", "radius", "power"],
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
        power: {
          title: "Power",
          "x-ui-component": "numeric-or-file",
          "x-unit": "dBm",
          oneOf: [{ type: "number" }, { type: "string", minLength: 1 }],
        },
        azimuth: { type: "number", title: "Azimuth", "x-unit": "°", "x-paired-with": "beam_width" },
        beam_width: {
          type: "number",
          title: "Beam Width",
          minimum: 1,
          maximum: 360,
          default: 360,
          "x-unit": "°",
        },
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
          maxItems: maxEntities,
          items: { $ref: "entity" },
        },
      },
    },
  };
}

function setup(schemas = fixtureSchemas()) {
  const onSubmit = vi.fn<(scenario: FieldValues) => void>();
  render(<ScenarioWorkspace schemas={schemas} onSubmit={onSubmit} heatmap={null} />);
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
  type("Power", "30");
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
    entities: [
      { label: "TX-1", position: { lat: 42, lon: 12.5 }, radius: 10, power: 30, beam_width: 360 },
    ],
  });
});

const entityCards = () => screen.getAllByRole("region", { name: /^Entity \d+/ });
const addEntity = () => fireEvent.click(screen.getByRole("button", { name: /add entity/i }));

test("the entity list starts at the schema's minimum and can't go below it", () => {
  setup(fixtureSchemas(2, 4));
  expect(entityCards()).toHaveLength(2);
  for (const card of entityCards()) {
    expect(within(card).getByRole("button", { name: /remove/i })).toBeDisabled();
  }
});

test("entities can be added up to the schema's maximum and removed back down", () => {
  setup(fixtureSchemas(2, 4));
  addEntity();
  addEntity();
  expect(entityCards()).toHaveLength(4);
  expect(screen.getByRole("button", { name: /add entity/i })).toBeDisabled();

  const third = entityCards()[2]!;
  fireEvent.change(within(third).getByLabelText("Label"), { target: { value: "third" } });
  fireEvent.click(within(entityCards()[1]!).getByRole("button", { name: /remove/i }));

  expect(entityCards()).toHaveLength(3);
  expect(within(entityCards()[1]!).getByLabelText("Label")).toHaveValue("third");
  expect(screen.getByRole("button", { name: /add entity/i })).toBeEnabled();
});

test("a numeric-or-file field toggles between a typed value and a file path", async () => {
  const { onSubmit } = setup();
  fillValidScenario();
  const power = screen.getByLabelText("Power").closest("[data-field]") as HTMLElement;
  expect(power).toHaveTextContent("dBm");

  fireEvent.click(within(power).getByRole("button", { name: "File" }));
  const path = screen.getByLabelText("Power");
  expect(path).toHaveValue("");
  expect(power).not.toHaveTextContent("dBm");
  submit();
  expect(await within(power).findByText("Required")).toBeInTheDocument();

  type("Power", "tables/power.csv");
  submit();
  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  const entity: unknown = onSubmit.mock.calls[0]![0].entities[0];
  expect(entity).toMatchObject({ power: "tables/power.csv" });
});

test("beam width defaults to the schema default, validates its range and sits beside azimuth", async () => {
  setup();
  expect(screen.getByLabelText("Beam Width")).toHaveValue(360);
  const row = screen.getByLabelText("Azimuth").closest("[data-pair]");
  expect(row).toContainElement(screen.getByLabelText("Beam Width"));

  type("Beam Width", "0");
  const field = screen.getByLabelText("Beam Width").closest("[data-field]") as HTMLElement;
  expect(await within(field).findByText("Must be ≥ 1°")).toBeInTheDocument();
});
