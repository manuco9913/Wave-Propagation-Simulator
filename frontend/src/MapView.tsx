import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// Vite pre-bundles maplibre, which breaks its import.meta.url-relative worker lookup;
// hand it an explicitly bundled worker instead.
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { Protocol } from "pmtiles";
import { useEffect, useRef } from "react";
import { circlePolygon, type LngLat } from "./geo";
import styles from "./MapView.module.css";

export type MapEntity = LngLat & { radiusKm: number };

type Props = {
  entity: MapEntity | null;
  /** Called with the new position when the map is clicked or the marker is dragged. */
  onEntityMove: (position: LngLat) => void;
};

const RING_SOURCE = "entity-ring";
const TILES_URL = "pmtiles://" + new URL("map/sample.pmtiles", document.baseURI).href;

let protocolRegistered = false;
function registerPmtiles() {
  if (protocolRegistered) return;
  maplibregl.setWorkerUrl(workerUrl);
  maplibregl.addProtocol("pmtiles", new Protocol().tile);
  protocolRegistered = true;
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function baseStyle(): maplibregl.StyleSpecification {
  return {
    version: 8,
    sources: { base: { type: "vector", url: TILES_URL } },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": cssVar("--color-bg") } },
      {
        id: "land",
        type: "fill",
        source: "base",
        "source-layer": "land",
        paint: { "fill-color": cssVar("--color-surface") },
      },
      {
        id: "graticule",
        type: "line",
        source: "base",
        "source-layer": "graticule",
        paint: { "line-color": cssVar("--color-border"), "line-opacity": 0.25, "line-width": 1 },
      },
    ],
  };
}

function ringData(entity: MapEntity | null): maplibregl.GeoJSONSourceSpecification["data"] {
  return {
    type: "FeatureCollection",
    features:
      entity && entity.radiusKm > 0
        ? [{ type: "Feature", properties: {}, geometry: circlePolygon(entity, entity.radiusKm) }]
        : [],
  };
}

export function MapView({ entity, onEntityMove }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const latest = useRef({ entity, onEntityMove });
  useEffect(() => {
    latest.current = { entity, onEntityMove };
  });

  useEffect(() => {
    if (!container.current) return;
    registerPmtiles();
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: container.current,
        style: baseStyle(),
        center: [12.5, 42],
        zoom: 4,
        attributionControl: false,
      });
    } catch {
      return; // no WebGL (e.g. test environment)
    }
    mapRef.current = map;

    map.on("load", () => {
      map.addSource(RING_SOURCE, { type: "geojson", data: ringData(latest.current.entity) });
      map.addLayer({
        id: RING_SOURCE,
        type: "line",
        source: RING_SOURCE,
        paint: {
          "line-color": cssVar("--color-accent"),
          "line-width": 1,
          "line-dasharray": [4, 3],
        },
      });
    });

    map.on("click", (e: maplibregl.MapMouseEvent) => {
      latest.current.onEntityMove({ lng: e.lngLat.lng, lat: e.lngLat.lat });
    });

    return () => {
      markerRef.current?.remove();
      markerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!entity) {
      markerRef.current?.remove();
      markerRef.current = null;
    } else if (markerRef.current) {
      markerRef.current.setLngLat(entity);
    } else {
      const el = document.createElement("div");
      el.className = styles.pin ?? "";
      el.setAttribute("data-testid", "entity-marker");
      const marker = new maplibregl.Marker({ element: el, draggable: true })
        .setLngLat(entity)
        .addTo(map);
      marker.on("drag", () => {
        const { lng, lat } = marker.getLngLat();
        latest.current.onEntityMove({ lng, lat });
      });
      markerRef.current = marker;
    }
    const source = map.getSource<maplibregl.GeoJSONSource>(RING_SOURCE);
    source?.setData(ringData(entity));
  }, [entity]);

  return <div ref={container} className={styles.map} aria-label="Map" />;
}
