"use client";

import { useEffect } from "react";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import { getNetworkSnapshot } from "@/data/transit/network";
import { LAYER_IDS, SOURCE_IDS } from "@/lib/map/layer-ids";
import { useTechTOStore } from "@/store/useTechTOStore";

/**
 * Highlights the active scenario station when a candidate is selected,
 * as a lightweight intervention-diff cue for the demo.
 */
export function InterventionDiffLayer({ map }: { map: MapLibreMap | null }) {
  const selectedCandidateId = useTechTOStore((s) => s.selectedCandidateId);

  useEffect(() => {
    if (!map) return;
    const network = getNetworkSnapshot();
    const union = network.stations.find((station) => station.id === "union");
    const features: GeoJSON.Feature[] =
      selectedCandidateId && union
        ? [
            {
              type: "Feature",
              properties: { candidateId: selectedCandidateId, stationId: union.id },
              geometry: { type: "Point", coordinates: [union.lng, union.lat] },
            },
          ]
        : [];

    const data: GeoJSON.FeatureCollection = { type: "FeatureCollection", features };
    const source = map.getSource(SOURCE_IDS.interventionDiff) as GeoJSONSource | undefined;
    if (source) {
      source.setData(data);
    } else {
      map.addSource(SOURCE_IDS.interventionDiff, { type: "geojson", data });
      map.addLayer({
        id: LAYER_IDS.interventionDiff,
        type: "circle",
        source: SOURCE_IDS.interventionDiff,
        paint: {
          "circle-radius": 16,
          "circle-color": "#a78bfa",
          "circle-opacity": 0.35,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#c4b5fd",
        },
      });
    }

    return () => {
      if (map.getLayer(LAYER_IDS.interventionDiff)) map.removeLayer(LAYER_IDS.interventionDiff);
      if (map.getSource(SOURCE_IDS.interventionDiff)) map.removeSource(SOURCE_IDS.interventionDiff);
    };
  }, [map, selectedCandidateId]);

  return null;
}
