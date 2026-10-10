import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import entitySchema from "../../contracts/entity.schema.json";
import scenarioSchema from "../../contracts/scenario.schema.json";
import { App } from "./App";

// Only the network boundary is faked: fetch and EventSource. Everything else is the real app.

class FakeEventSource {
  static readonly CLOSED = 2;
  static last: FakeEventSource | null = null;
  readonly url: string;
  readyState = 0;
  closed = false;
  private listeners = new Map<string, ((e: Event) => void)[]>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.last = this;
  }
  addEventListener(type: string, fn: (e: Event) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  close() {
    this.closed = true;
    this.readyState = 2;
  }
  emit(type: string, data: unknown) {
    const event = new MessageEvent(type, { data: JSON.stringify(data) });
    for (const fn of this.listeners.get(type) ?? []) fn(event);
  }
}

function sliceBody(): ArrayBuffer {
  const buf = new ArrayBuffer(56 + 4);
  const view = new DataView(buf);
  [0x57, 0x50, 0x53, 0x31].forEach((b, i) => view.setUint8(i, b));
  view.setUint16(4, 1, true);
  view.setUint32(6, 1, true);
  view.setUint32(10, 1, true);
  view.setFloat32(14, -70, true);
  view.setFloat32(18, -70, true);
  [35, 32, 35.1, 32.1].forEach((v, i) => view.setFloat64(22 + i * 8, v, true));
  view.setFloat32(56, -70, true);
  return buf;
}

type Route = (init: RequestInit | undefined) => Response;

function serve(routes: Record<string, Route>) {
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    const route = routes[url];
    if (!route) return new Response("not found", { status: 404 });
    return route(init);
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("EventSource", FakeEventSource);
  return fetchMock;
}

const json =
  (body: unknown, status = 200) =>
  () =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const schemaRoutes = {
  "/api/schema/entity": json(entitySchema),
  "/api/schema/scenario": json(scenarioSchema),
};

function type(label: string, value: string, scope: HTMLElement = document.body) {
  const input = within(scope).getByLabelText(label);
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

async function fillAndSubmit() {
  await screen.findByRole("button", { name: /run simulation/i });
  type("Name", "Golden path");
  const heights = screen.getByRole("group", { name: "Height Range" });
  type("Min", "0", heights);
  type("Max", "100", heights);
  type("Height Step", "10");
  const entity = screen.getByRole("region", { name: "Entity 1" });
  type("Label", "Tx", entity);
  type("Lat", "32", entity);
  type("Lon", "35", entity);
  type("Frequency", "900", entity);
  type("Power", "40", entity);
  type("Azimuth", "0", entity);
  type("Antenna Height", "20", entity);
  type("Radius", "5", entity);
  fireEvent.click(screen.getByRole("button", { name: /run simulation/i }));
}

afterEach(() => {
  FakeEventSource.last = null;
  vi.unstubAllGlobals();
});

test("submit -> live progress over SSE -> the first height's slice is fetched", async () => {
  const base = "/api/scenarios/s1/runs/r1";
  const fetchMock = serve({
    ...schemaRoutes,
    "/api/scenarios": json({ scenario_id: "s1", run_id: "r1" }, 201),
    [`${base}/slices/0`]: () => new Response(sliceBody()),
  });
  render(<App />);

  await fillAndSubmit();

  await waitFor(() => expect(FakeEventSource.last?.url).toBe(`${base}/events`));
  const posted = fetchMock.mock.calls.find(([url]) => url === "/api/scenarios");
  const body: unknown = JSON.parse(String(posted?.[1]?.body));
  expect(body).toMatchObject({ name: "Golden path", height_range: { min: 0, max: 100 } });

  const sse = FakeEventSource.last!;
  act(() => sse.emit("status", { status: "queued", phase: null, percent: 0, message: "Queued" }));
  expect(screen.getByTestId("run-status")).toHaveTextContent("Queued");
  act(() => sse.emit("progress", { phase: "engine", percent: 52.5, message: "Engine: 50%" }));
  expect(screen.getByTestId("run-status")).toHaveTextContent("Engine: 50% · 53%");

  act(() => sse.emit("done", {}));

  await waitFor(() => expect(screen.getByTestId("run-status")).toHaveTextContent("0 m"));
  expect(sse.closed).toBe(true);
  expect(fetchMock.mock.calls.map(([url]) => url)).toContain(`${base}/slices/0`);
  expect(screen.getByTestId("run-status")).toHaveTextContent("-70 … -70 dBm");
});

test("an engine error ends the run with its message", async () => {
  serve({ ...schemaRoutes, "/api/scenarios": json({ scenario_id: "s1", run_id: "r1" }, 201) });
  render(<App />);

  await fillAndSubmit();
  await waitFor(() => expect(FakeEventSource.last).not.toBeNull());
  act(() =>
    FakeEventSource.last!.emit("error", {
      error: "timeout",
      message: "engine timed out",
      retryable: true,
    }),
  );

  expect(screen.getByTestId("run-status")).toHaveTextContent("Failed: engine timed out");
  expect(FakeEventSource.last!.closed).toBe(true);
});

test("a scenario the server rejects shows the server's field errors", async () => {
  serve({
    ...schemaRoutes,
    "/api/scenarios": json(
      {
        error: "validation_failed",
        message: "scenario is invalid",
        fields: [{ field: "height_range", message: "min must be less than max" }],
      },
      422,
    ),
  });
  render(<App />);

  await fillAndSubmit();

  await waitFor(() =>
    expect(screen.getByTestId("run-status")).toHaveTextContent(
      "Rejected: height_range: min must be less than max",
    ),
  );
  expect(FakeEventSource.last).toBeNull();
});
