"use client";

import { useEffect } from "react";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import { listStations } from "@/data/transit/network";
import type { StationCrowdLevel } from "@/components/map/TorontoMap";

const SOURCE_ID = "twinto-crowd-heat";
const LAYER_ID = "twinto-crowd-heat-circle";

function crowdGeoJson(stationCrowd: StationCrowdLevel[]): GeoJSON.FeatureCollection<GeoJSON.Point> {
  const byStation = new Map(stationCrowd.map((entry) => [entry.stationId, entry.loadFactor]));
  return {
    type: "FeatureCollection",
    features: listStations()
      .filter((station) => byStation.has(station.id))
      .map((station) => ({
        type: "Feature",
        properties: { stationId: station.id, loadFactor: byStation.get(station.id) ?? 0 },
        geometry: { type: "Point", coordinates: [station.lng, station.lat] },
      })),
  };
}

/**
 * Station-level crowding heat, driven by the deterministic transit
 * simulator's `loadFactor` per departure (never a live sensor feed).
 * Renders nothing when no run has produced station-level loads yet.
 */
export function CrowdHeatmapLayer({
  map,
  stationCrowd,
}: {
  map: MapLibreMap | null;
  stationCrowd: StationCrowdLevel[];
}) {
  useEffect(() => {
    if (!map) return;

    map.addSource(SOURCE_ID, { type: "geojson", data: crowdGeoJson(stationCrowd) });
    map.addLayer({
      id: LAYER_ID,
      type: "circle",
      source: SOURCE_ID,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["get", "loadFactor"], 0, 14, 1, 30, 1.4, 42],
        "circle-color": [
          "interpolate",
          ["linear"],
          ["get", "loadFactor"],
          0,
          "#3FBF9F",
          0.7,
          "#E3A83B",
          1,
          "#E0333B",
        ],
        "circle-opacity": 0.28,
        "circle-blur": 0.6,
      },
    });

    return () => {
      if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  useEffect(() => {
    if (!map || !map.getSource(SOURCE_ID)) return;
    (map.getSource(SOURCE_ID) as GeoJSONSource).setData(crowdGeoJson(stationCrowd));
  }, [map, stationCrowd]);

  return null;
}
