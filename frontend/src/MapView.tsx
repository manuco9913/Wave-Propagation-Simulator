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
  /** One slot per entity, in list order; null while an entity has no valid position yet. */
  entities: readonly (MapEntity | null)[];
  /** The entity a map click places. */
  activeIndex: number;
  /** A map click moves the active entity; dragging a marker moves that marker's entity. */
  onEntityMove: (index: number, position: LngLat) => void;
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

function ringData(
  entities: readonly (MapEntity | null)[],
): maplibregl.GeoJSONSourceSpecification["data"] {
  return {
    type: "FeatureCollection",
    features: entities
      .filter((e): e is MapEntity => e !== null && e.radiusKm > 0)
      .map((e) => ({ type: "Feature", properties: {}, geometry: circlePolygon(e, e.radiusKm) })),
  };
}

function createMarker(map: maplibregl.Map, onDrag: (marker: maplibregl.Marker) => void) {
  const el = document.createElement("div");
  el.className = styles.pin ?? "";
  el.setAttribute("data-testid", "entity-marker");
  const marker = new maplibregl.Marker({ element: el, draggable: true })
    .setLngLat([0, 0])
    .addTo(map);
  marker.on("drag", () => onDrag(marker));
  return marker;
}

export function MapView({ entities, activeIndex, onEntityMove }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  // Index-aligned with `entities`, so a marker's entity is its position in this array.
  const markersRef = useRef<(maplibregl.Marker | null)[]>([]);
  const latest = useRef({ entities, activeIndex, onEntityMove });
  useEffect(() => {
    latest.current = { entities, activeIndex, onEntityMove };
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
      map.addSource(RING_SOURCE, { type: "geojson", data: ringData(latest.current.entities) });
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
      const { activeIndex, onEntityMove } = latest.current;
      onEntityMove(activeIndex, { lng: e.lngLat.lng, lat: e.lngLat.lat });
    });

    const markers = markersRef.current;
    return () => {
      for (const marker of markers) marker?.remove();
      markers.length = 0;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const markers = markersRef.current;
    for (const marker of markers.splice(entities.length)) marker?.remove();
    entities.forEach((entity, index) => {
      const existing = markers[index] ?? null;
      if (!entity) {
        existing?.remove();
        markers[index] = null;
        return;
      }
      const marker =
        existing ??
        createMarker(map, (dragged) => {
          const draggedIndex = markers.indexOf(dragged);
          if (draggedIndex !== -1) latest.current.onEntityMove(draggedIndex, dragged.getLngLat());
        });
      marker.setLngLat(entity);
      marker.getElement().toggleAttribute("data-active", index === activeIndex);
      markers[index] = marker;
    });
    map.getSource<maplibregl.GeoJSONSource>(RING_SOURCE)?.setData(ringData(entities));
  }, [entities, activeIndex]);

  return <div ref={container} className={styles.map} aria-label="Map" />;
}
