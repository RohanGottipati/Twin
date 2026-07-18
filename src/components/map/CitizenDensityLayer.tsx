"use client";

import { useEffect } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { listCohorts } from "@/data/transit/cohorts";

const SOURCE_ID = "twinto-citizen-density";
const LAYER_ID = "twinto-citizen-density-circle";
const LABEL_LAYER_ID = "twinto-citizen-density-label";

/**
 * Approximate, illustrative downtown-Toronto coordinates for each synthetic
 * cohort home zone (see `@/data/transit/cohorts`). These are NOT parcel- or
 * dissemination-area-accurate geodata, just plausible neighbourhood
 * placements so the density layer has somewhere to draw a circle; see
 * AGENTS.md section 2 on never treating a demo fixture as measured data.
 */
const ZONE_COORDINATES: Record<string, [number, number]> = {
  "zone-liberty-village": [-79.4194, 43.6373],
  "zone-annex": [-79.4085, 43.6708],
  "zone-parkdale": [-79.4372, 43.6465],
  "zone-st-lawrence": [-79.3679, 43.6493],
  "zone-regent-park": [-79.3616, 43.6607],
  "zone-riverdale": [-79.3521, 43.6664],
  "zone-scarborough-junction": [-79.2497, 43.7371],
  "zone-thorncliffe": [-79.3489, 43.7053],
  "zone-weston-mount-dennis": [-79.5109, 43.6969],
  "zone-mixed-gta": [-79.3832, 43.6532],
  "zone-external": [-79.3832, 43.6832],
};

function densityGeoJson(): GeoJSON.FeatureCollection<GeoJSON.Point> {
  const cohorts = listCohorts();
  return {
    type: "FeatureCollection",
    features: cohorts
      .filter((cohort) => ZONE_COORDINATES[cohort.homeZoneId])
      .map((cohort) => ({
        type: "Feature",
        properties: { cohortId: cohort.id, label: cohort.label, weight: cohort.weight },
        geometry: { type: "Point", coordinates: ZONE_COORDINATES[cohort.homeZoneId] },
      })),
  };
}

/**
 * Circle-per-cohort density overlay, sized by census-weighted population
 * share. A stand-in for a real dissemination-area choropleth: illustrative,
 * synthetic-fixture, never a measured population layer (AGENTS.md 2, 4.3).
 */
export function CitizenDensityLayer({ map }: { map: MapLibreMap | null }) {
  useEffect(() => {
    if (!map) return;

    map.addSource(SOURCE_ID, { type: "geojson", data: densityGeoJson() });
    map.addLayer({
      id: LAYER_ID,
      type: "circle",
      source: SOURCE_ID,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["get", "weight"], 4, 10, 28, 34],
        "circle-color": "#5B8DEF",
        "circle-opacity": 0.16,
        "circle-stroke-width": 1,
        "circle-stroke-color": "#5B8DEF",
        "circle-stroke-opacity": 0.4,
      },
    });
    map.addLayer({
      id: LABEL_LAYER_ID,
      type: "symbol",
      source: SOURCE_ID,
      layout: {
        "text-field": ["concat", ["get", "label"], " (", ["get", "weight"], "%)"],
        "text-size": 10,
        "text-anchor": "center",
      },
      paint: {
        "text-color": "#8B93A3",
        "text-halo-color": "#0A0D14",
        "text-halo-width": 1,
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
