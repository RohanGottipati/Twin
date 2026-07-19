"use client";

import { useEffect, useState } from "react";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import type { TransitCohortFixture } from "@/data/transit/cohorts";
import { computeNeighbourhoodCentroids, type NeighbourhoodGeoJson } from "@/lib/geo/centroid";

const SOURCE_ID = "techto-citizen-density";
const LAYER_ID = "techto-citizen-density-circle";
const LABEL_LAYER_ID = "techto-citizen-density-label";

function densityGeoJson(
  cohorts: TransitCohortFixture[],
  centroids: Record<string, [number, number]>,
): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: "FeatureCollection",
    features: cohorts
      .filter((cohort) => centroids[cohort.homeZoneId])
      .map((cohort) => ({
        type: "Feature",
        properties: { cohortId: cohort.id, label: cohort.label, weight: cohort.weight },
        geometry: { type: "Point", coordinates: centroids[cohort.homeZoneId] },
      })),
  };
}

/**
 * Circle-per-cohort density overlay, sized by population share. Cohorts and
 * centroids are both fetched from real sources: `/api/cohorts` (the active
 * TransitRepository -- real resident-persona-aggregate data once
 * `citizen_cohorts` is reseeded, see `population/build_neighbourhood_cohorts.py`)
 * and `public/data/neighbourhoods.geojson` (real City of Toronto neighbourhood
 * boundaries), rather than the old hardcoded 11-entry `ZONE_COORDINATES`.
 */
export function CitizenDensityLayer({ map }: { map: MapLibreMap | null }) {
  const [cohorts, setCohorts] = useState<TransitCohortFixture[] | null>(null);
  const [centroids, setCentroids] = useState<Record<string, [number, number]> | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/cohorts")
      .then((response) => response.json())
      .then((data: { cohorts: TransitCohortFixture[] }) => {
        if (!cancelled) setCohorts(data.cohorts);
      })
      .catch(() => {
        if (!cancelled) setCohorts([]);
      });
    fetch("/data/neighbourhoods.geojson")
      .then((response) => response.json())
      .then((geojson: NeighbourhoodGeoJson) => {
        if (!cancelled) setCentroids(computeNeighbourhoodCentroids(geojson));
      })
      .catch(() => {
        if (!cancelled) setCentroids({});
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!map || !cohorts || !centroids) return;

    const data = densityGeoJson(cohorts, centroids);
    const existingSource = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
    if (existingSource) {
      existingSource.setData(data);
      return;
    }

    map.addSource(SOURCE_ID, { type: "geojson", data });
    map.addLayer({
      id: LAYER_ID,
      type: "circle",
      source: SOURCE_ID,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["get", "weight"], 0.5, 4, 15, 34],
        "circle-color": "#007ACC",
        "circle-opacity": 0.16,
        "circle-stroke-width": 1,
        "circle-stroke-color": "#007ACC",
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
  }, [map, cohorts, centroids]);

  return null;
}
