"use client";

import { useEffect } from "react";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import { listNeighbourhoods } from "@/data/transit/neighbourhoods";
import { LAYER_IDS, SOURCE_IDS } from "@/lib/map/layer-ids";
import { useMapStore } from "@/store/useMapStore";

export function NeighbourhoodHighlightLayer({ map }: { map: MapLibreMap | null }) {
  const ids = useMapStore((s) => s.highlightedNeighbourhoodIds);

  useEffect(() => {
    if (!map) return;
    const selected = new Set(ids);
    const neighbourhoods = listNeighbourhoods().filter((n) => selected.has(n.id));

    const data: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: neighbourhoods.map((n) => {
        const [west, south, east, north] = n.bounds;
        return {
          type: "Feature",
          properties: { id: n.id, name: n.name },
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [west, south],
                [east, south],
                [east, north],
                [west, north],
                [west, south],
              ],
            ],
          },
        };
      }),
    };

    const source = map.getSource(SOURCE_IDS.neighbourhoods) as GeoJSONSource | undefined;
    if (source) {
      source.setData(data);
    } else {
      map.addSource(SOURCE_IDS.neighbourhoods, { type: "geojson", data });
      map.addLayer({
        id: LAYER_IDS.neighbourhoods,
        type: "fill",
        source: SOURCE_IDS.neighbourhoods,
        paint: {
          "fill-color": "#22d3ee",
          "fill-opacity": 0.18,
        },
      });
      map.addLayer({
        id: `${LAYER_IDS.neighbourhoods}-outline`,
        type: "line",
        source: SOURCE_IDS.neighbourhoods,
        paint: { "line-color": "#67e8f9", "line-width": 2 },
      });
    }

    return () => {
      if (map.getLayer(`${LAYER_IDS.neighbourhoods}-outline`)) {
        map.removeLayer(`${LAYER_IDS.neighbourhoods}-outline`);
      }
      if (map.getLayer(LAYER_IDS.neighbourhoods)) map.removeLayer(LAYER_IDS.neighbourhoods);
      if (map.getSource(SOURCE_IDS.neighbourhoods)) map.removeSource(SOURCE_IDS.neighbourhoods);
    };
  }, [map, ids]);

  return null;
}
