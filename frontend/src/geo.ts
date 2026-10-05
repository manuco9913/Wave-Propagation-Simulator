export type LngLat = { lng: number; lat: number };
export type Polygon = { type: "Polygon"; coordinates: [number, number][][] };

const EARTH_RADIUS_KM = 6371.0088;

/** Closed GeoJSON ring approximating a geodesic circle of `radiusKm` around `center`. */
export function circlePolygon(center: LngLat, radiusKm: number, steps = 128): Polygon {
  const lat1 = (center.lat * Math.PI) / 180;
  const lng1 = (center.lng * Math.PI) / 180;
  const d = radiusKm / EARTH_RADIUS_KM;
  const ring: [number, number][] = [];
  for (let i = 0; i < steps; i++) {
    const bearing = (2 * Math.PI * i) / steps;
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(bearing),
    );
    const lng2 =
      lng1 +
      Math.atan2(
        Math.sin(bearing) * Math.sin(d) * Math.cos(lat1),
        Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
      );
    ring.push([(lng2 * 180) / Math.PI, (lat2 * 180) / Math.PI]);
  }
  ring.push([...ring[0]!] as [number, number]);
  return { type: "Polygon", coordinates: [ring] };
}
