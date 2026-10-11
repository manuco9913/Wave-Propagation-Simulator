import { expect, test, type Locator, type Page } from "@playwright/test";

// The whole stack, nothing mocked: browser -> Vite -> FastAPI -> Postgres -> fake engine ->
// HDF5 -> slice endpoint. Terrain comes from the committed Jerusalem-Dead Sea fixture
// (31.72-31.78°N, 35.20-35.50°E), so the entities sit inside it.

const ENTITIES = [
  { label: "Jerusalem hills", lat: "31.75", lon: "35.25" },
  { label: "Dead Sea shore", lat: "31.75", lon: "35.45" },
];

async function type(scope: Page | Locator, label: string, value: string) {
  await scope.getByLabel(label, { exact: true }).fill(value);
}

async function fillScenario(page: Page, radiusKm: string) {
  await page.goto("/");
  await expect(page.getByTestId("schema-status")).toHaveText("schemas: ready");
  await type(page, "Name", "End to end");
  const heights = page.getByRole("group", { name: "Height Range" });
  await type(heights, "Min", "0");
  await type(heights, "Max", "20");
  await type(page, "Height Step", "10");
  await expect(page.getByLabel("Terrain Enabled")).toBeChecked();
  await page.getByRole("button", { name: /add entity/i }).click();
  for (const [i, e] of ENTITIES.entries()) {
    const card = page.getByRole("region", { name: `Entity ${i + 1}` });
    await type(card, "Label", e.label);
    await type(card, "Lat", e.lat);
    await type(card, "Lon", e.lon);
    await type(card, "Frequency", "900");
    await type(card, "Power", "43");
    await type(card, "Azimuth", "0");
    await type(card, "Antenna Height", "10");
    await type(card, "Radius", radiusKm);
  }
}

/** The 56-byte header of a slice (contracts/api.md, binary format). */
function sliceHeader(body: Buffer) {
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const width = view.getUint32(6, true);
  const height = view.getUint32(10, true);
  const data = new Float32Array(
    body.buffer.slice(body.byteOffset + 56, body.byteOffset + body.byteLength),
  );
  return {
    magic: body.subarray(0, 4).toString("ascii"),
    width,
    height,
    min: view.getFloat32(14, true),
    max: view.getFloat32(18, true),
    west: view.getFloat64(22, true),
    south: view.getFloat64(30, true),
    east: view.getFloat64(38, true),
    north: view.getFloat64(46, true),
    data,
  };
}

test("fill the form, submit, watch progress, see the heatmap, scrub heights, save", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await fillScenario(page, "2");
  const status = page.getByTestId("run-status");
  const firstSlice = page.waitForResponse((r) => r.url().endsWith("/slices/0"));

  await page.getByRole("button", { name: /run simulation/i }).click();

  // Progress arrives over SSE while the engine works (no polling by the app).
  await expect(status).toContainText(/Engine: entity \d\/2/, { timeout: 30_000 });
  const response = await firstSlice;
  expect(response.status()).toBe(200);
  const slice = sliceHeader(await response.body());
  expect(slice.magic).toBe("WPS1");
  expect(slice.data.length).toBe(slice.width * slice.height);
  // The grid covers both entities' circles...
  for (const e of ENTITIES) {
    expect(slice.west).toBeLessThan(Number(e.lon));
    expect(slice.east).toBeGreaterThan(Number(e.lon));
    expect(slice.south).toBeLessThan(Number(e.lat));
    expect(slice.north).toBeGreaterThan(Number(e.lat));
  }
  // ...with values inside them and nulls (NaN) outside, at the bbox corners.
  expect(Number.isNaN(slice.data[0])).toBe(true);
  expect(slice.data.some((v) => Number.isFinite(v))).toBe(true);
  expect(slice.min).toBeLessThan(slice.max);

  // The map shows that slice: the status line reports its height and dBm range.
  const dbm = (v: number) => String(Math.round(v * 10) / 10);
  await expect(status).toHaveText(`0 m · ${dbm(slice.min)} … ${dbm(slice.max)} dBm`);

  // Scrub to the next height; it was prefetched, so it shows straight away.
  await page.getByLabel("Height level").fill("1");
  await expect(status).toHaveText(/^10 m · .* dBm$/);
  await expect(page.getByLabel("Height", { exact: true })).toHaveValue("10");

  // Save the run, then find it in the saved runs list.
  await page.getByLabel("Run name").fill("e2e baseline");
  await page.getByRole("button", { name: /save run/i }).click();
  await expect(page.getByText("Saved as e2e baseline")).toBeVisible();
  await page.getByRole("button", { name: "Saved runs" }).click();
  await expect(
    page.getByRole("dialog", { name: "Saved runs" }).getByRole("button", {
      name: "End to end · e2e baseline",
    }),
  ).toBeVisible();

  expect(pageErrors).toEqual([]);
});

test("a scenario reaching past the terrain data is rejected before it runs", async ({ page }) => {
  await fillScenario(page, "10"); // 10 km circles leave the 6.6 km-tall fixture

  await page.getByRole("button", { name: /run simulation/i }).click();

  await expect(page.getByTestId("run-status")).toContainText(
    "Rejected: entities.0.radius: no terrain:",
  );
});
