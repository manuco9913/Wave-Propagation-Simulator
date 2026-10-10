import { circlePolygon } from "./geo";

function haversineKm(a: [number, number], b: [number, number]): number {
  const rad = (x: number) => (x * Math.PI) / 180;
  const h =
    Math.sin(rad(b[1] - a[1]) / 2) ** 2 +
    Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(rad(b[0] - a[0]) / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.sqrt(h));
}

test("every vertex of the ring lies at the requested radius from the centre", () => {
  const center = { lng: 12.5, lat: 41.9 };
  const [ring = []] = circlePolygon(center, 25).coordinates;
  for (const p of ring) {
    expect(haversineKm([center.lng, center.lat], p as [number, number])).toBeCloseTo(25, 3);
  }
});

test("the ring is closed", () => {
  const [ring = []] = circlePolygon({ lng: 0, lat: 0 }, 10).coordinates;
  expect(ring[0]).toEqual(ring.at(-1));
});
