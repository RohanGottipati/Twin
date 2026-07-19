"use client";

import { useEffect } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { getConcertEvent, getServiceIncidents } from "@/data/transit/events";
import { getStation } from "@/data/transit/network";

const SOURCE_ID = "techto-events";
const LAYER_ID = "techto-events-marker";
const LABEL_LAYER_ID = "techto-events-label";

function eventsGeoJson(): GeoJSON.FeatureCollection<GeoJSON.Point> {
  const features: GeoJSON.Feature<GeoJSON.Point>[] = [];

  const concert = getConcertEvent();
  const concertStation = getStation(concert.nearestStationId);
  if (concertStation) {
    features.push({
      type: "Feature",
      properties: { kind: "concert", label: concert.title },
      geometry: { type: "Point", coordinates: [concertStation.lng, concertStation.lat] },
    });
  }

  for (const incident of getServiceIncidents()) {
    for (const stationId of incident.affectedStationIds) {
      const station = getStation(stationId);
      if (!station) continue;
      features.push({
        type: "Feature",
        properties: { kind: "incident", label: incident.description },
        geometry: { type: "Point", coordinates: [station.lng, station.lat] },
      });
    }
  }

  return { type: "FeatureCollection", features };
}

/**
 * Concert and service-incident markers used by the extenuating-circumstances
 * stress test (docs/techto-implementation.md section 2.5). Every source here
 * is the synthetic fixture bundle in `@/data/transit/events`, never a live
 * events feed or a real TTC alert.
 */
export function EventLayer({ map }: { map: MapLibreMap | null }) {
  useEffect(() => {
    if (!map) return;

    map.addSource(SOURCE_ID, { type: "geojson", data: eventsGeoJson() });
    map.addLayer({
      id: LAYER_ID,
      type: "circle",
      source: SOURCE_ID,
      paint: {
        "circle-radius": 8,
        "circle-color": ["match", ["get", "kind"], "concert", "#E3A83B", "#E0333B"],
        "circle-opacity": 0.85,
        "circle-stroke-width": 2,
        "circle-stroke-color": "#0A0D14",
      },
    });
    map.addLayer({
      id: LABEL_LAYER_ID,
      type: "symbol",
      source: SOURCE_ID,
      layout: {
        "text-field": ["get", "label"],
        "text-size": 10,
        "text-offset": [0, -1.6],
        "text-anchor": "bottom",
      },
      paint: {
        "text-color": "#EDEFF3",
        "text-halo-color": "#0A0D14",
        "text-halo-width": 1.2,
      },
    });

    return () => {
      if (map.getLayer(LABEL_LAYER_ID)) map.removeLayer(LABEL_LAYER_ID);
      if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
    };
  }, [map]);

  return null;
}
