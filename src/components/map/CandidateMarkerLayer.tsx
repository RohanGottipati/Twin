"use client";

import { useEffect } from "react";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import { LAYER_IDS, SOURCE_IDS } from "@/lib/map/layer-ids";
import { useMapStore } from "@/store/useMapStore";

export function CandidateMarkerLayer({ map }: { map: MapLibreMap | null }) {
  const candidates = useMapStore((s) => s.candidateMarkers);

  useEffect(() => {
    if (!map) return;

    const data: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: candidates.map((candidate) => ({
        type: "Feature",
        properties: {
          candidateId: candidate.candidateId,
          rank: candidate.rank,
          label: candidate.label,
        },
        geometry: { type: "Point", coordinates: candidate.coordinates },
      })),
    };

    const source = map.getSource(SOURCE_IDS.candidates) as GeoJSONSource | undefined;
    if (source) {
      source.setData(data);
    } else {
      map.addSource(SOURCE_IDS.candidates, { type: "geojson", data });
      map.addLayer({
        id: LAYER_IDS.candidates,
        type: "circle",
        source: SOURCE_IDS.candidates,
        paint: {
          "circle-radius": 8,
          "circle-color": "#38bdf8",
          "circle-stroke-width": 2,
          "circle-stroke-color": "#0f172a",
        },
      });
      map.addLayer({
        id: `${LAYER_IDS.candidates}-label`,
        type: "symbol",
        source: SOURCE_IDS.candidates,
        layout: {
          "text-field": ["concat", "#", ["to-string", ["get", "rank"]], " ", ["get", "label"]],
          "text-size": 11,
          "text-offset": [0, 1.2],
          "text-anchor": "top",
        },
        paint: { "text-color": "#e2e8f0", "text-halo-color": "#0f172a", "text-halo-width": 1 },
      });
    }

    return () => {
      if (map.getLayer(`${LAYER_IDS.candidates}-label`)) map.removeLayer(`${LAYER_IDS.candidates}-label`);
      if (map.getLayer(LAYER_IDS.candidates)) map.removeLayer(LAYER_IDS.candidates);
      if (map.getSource(SOURCE_IDS.candidates)) map.removeSource(SOURCE_IDS.candidates);
    };
  }, [map, candidates]);

  return null;
}
