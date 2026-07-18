"use client";

import { useEffect } from "react";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import { getNetworkSnapshot } from "@/data/transit/network";
import { LAYER_IDS, SOURCE_IDS } from "@/lib/map/layer-ids";
import { useMapStore } from "@/store/useMapStore";

/**
 * Synthetic vehicle symbols that drift along Line 1 based on playbackMinute.
 * Demo visualization only; not live TTC vehicle positions.
 */
export function VehicleLayer({ map }: { map: MapLibreMap | null }) {
  const playbackMinute = useMapStore((s) => s.playbackMinute);
  const transitVisible = useMapStore((s) => s.layers.transit);

  useEffect(() => {
    if (!map || !transitVisible) return;

    const network = getNetworkSnapshot();
    const line1Stops = network.stops
      .filter((stop) => stop.routeId === "line-1")
      .sort((a, b) => a.sequence - b.sequence);
    if (line1Stops.length < 2) return;

    const t = (playbackMinute % Math.max(line1Stops.length - 1, 1)) / Math.max(line1Stops.length - 1, 1);
    const idx = Math.min(Math.floor(t * (line1Stops.length - 1)), line1Stops.length - 2);
    const a = line1Stops[idx];
    const b = line1Stops[idx + 1];
    const frac = t * (line1Stops.length - 1) - idx;
    const lng = a.lng + (b.lng - a.lng) * frac;
    const lat = a.lat + (b.lat - a.lat) * frac;

    const data: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { id: "veh-line-1-demo", routeId: "line-1", label: "Line 1 demo vehicle" },
          geometry: { type: "Point", coordinates: [lng, lat] },
        },
      ],
    };

    const source = map.getSource(SOURCE_IDS.vehicles) as GeoJSONSource | undefined;
    if (source) {
      source.setData(data);
    } else {
      map.addSource(SOURCE_IDS.vehicles, { type: "geojson", data });
      map.addLayer({
        id: LAYER_IDS.vehicles,
        type: "circle",
        source: SOURCE_IDS.vehicles,
        paint: {
          "circle-radius": 7,
          "circle-color": "#f59e0b",
          "circle-stroke-width": 2,
          "circle-stroke-color": "#111827",
        },
      });
    }

    return () => {
      if (map.getLayer(LAYER_IDS.vehicles)) map.removeLayer(LAYER_IDS.vehicles);
      if (map.getSource(SOURCE_IDS.vehicles)) map.removeSource(SOURCE_IDS.vehicles);
    };
  }, [map, playbackMinute, transitVisible]);

  return null;
}
