"use client";

import { useEffect } from "react";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import { useMapStore } from "@/store/useMapStore";
import type { AgentMapOverlay } from "@/lib/techto/map-overlays";

const SRC = "techto-agent-overlays";
const LAYER_POINT = "techto-agent-points";
const LAYER_LINE = "techto-agent-lines";
const LAYER_FILL = "techto-agent-fills";
const LAYER_FILL_LINE = "techto-agent-fill-outline";
const LAYER_LABEL = "techto-agent-labels";

function toFc(overlays: AgentMapOverlay[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const o of overlays) {
    if (o.kind === "point") {
      features.push({
        type: "Feature",
        properties: { id: o.id, kind: o.kind, label: o.label },
        geometry: { type: "Point", coordinates: o.coordinates },
      });
    } else if (o.kind === "annotation") {
      features.push({
        type: "Feature",
        properties: { id: o.id, kind: o.kind, label: o.text },
        geometry: { type: "Point", coordinates: o.coordinates },
      });
    } else if (o.kind === "line") {
      features.push({
        type: "Feature",
        properties: { id: o.id, kind: o.kind, label: o.label },
        geometry: { type: "LineString", coordinates: o.coordinates },
      });
    } else if (o.kind === "polygon") {
      const ring = [...o.coordinates];
      const first = ring[0];
      const last = ring[ring.length - 1];
      if (first && last && (first[0] !== last[0] || first[1] !== last[1])) {
        ring.push(first);
      }
      features.push({
        type: "Feature",
        properties: { id: o.id, kind: o.kind, label: o.label },
        geometry: { type: "Polygon", coordinates: [ring] },
      });
    }
  }
  return { type: "FeatureCollection", features };
}

/** Renders agent draw_point / draw_line / draw_polygon / annotate overlays. */
export function AgentOverlayLayer({ map }: { map: MapLibreMap | null }) {
  const overlays = useMapStore((s) => s.agentOverlays);

  useEffect(() => {
    if (!map) return;
    const data = toFc(overlays);
    const existing = map.getSource(SRC) as GeoJSONSource | undefined;
    if (existing) {
      existing.setData(data);
      return;
    }

    map.addSource(SRC, { type: "geojson", data });
    map.addLayer({
      id: LAYER_FILL,
      type: "fill",
      source: SRC,
      filter: ["==", ["get", "kind"], "polygon"],
      paint: { "fill-color": "#fbbf24", "fill-opacity": 0.22 },
    });
    map.addLayer({
      id: LAYER_FILL_LINE,
      type: "line",
      source: SRC,
      filter: ["==", ["get", "kind"], "polygon"],
      paint: { "line-color": "#f59e0b", "line-width": 2 },
    });
    map.addLayer({
      id: LAYER_LINE,
      type: "line",
      source: SRC,
      filter: ["==", ["get", "kind"], "line"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#38bdf8", "line-width": 3.5 },
    });
    map.addLayer({
      id: LAYER_POINT,
      type: "circle",
      source: SRC,
      filter: ["in", ["get", "kind"], ["literal", ["point", "annotation"]]],
      paint: {
        "circle-radius": ["match", ["get", "kind"], "annotation", 5, 8],
        "circle-color": ["match", ["get", "kind"], "annotation", "#a78bfa", "#22d3ee"],
        "circle-stroke-width": 2,
        "circle-stroke-color": "#0f172a",
      },
    });
    map.addLayer({
      id: LAYER_LABEL,
      type: "symbol",
      source: SRC,
      layout: {
        "text-field": ["get", "label"],
        "text-size": 11,
        "text-offset": [0, 1.15],
        "text-anchor": "top",
        "text-max-width": 14,
      },
      paint: {
        "text-color": "#f8fafc",
        "text-halo-color": "#0f172a",
        "text-halo-width": 1.2,
      },
    });

    return () => {
      for (const id of [LAYER_LABEL, LAYER_POINT, LAYER_LINE, LAYER_FILL_LINE, LAYER_FILL]) {
        if (map.getLayer(id)) map.removeLayer(id);
      }
      if (map.getSource(SRC)) map.removeSource(SRC);
    };
  }, [map, overlays]);

  return null;
}
