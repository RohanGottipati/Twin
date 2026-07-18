"use client";

import { useEffect, useRef } from "react";
import type { Map as MapLibreMap, MapLayerMouseEvent } from "maplibre-gl";
import { useMapStore } from "@/store/useMapStore";
import { listRoutes, listStations, listStops } from "@/data/transit/network";

const ROUTES_SOURCE_ID = "twinto-routes";
const ROUTES_LINE_LAYER_ID = "twinto-routes-line";
const STATIONS_SOURCE_ID = "twinto-stations";
const STATIONS_CIRCLE_LAYER_ID = "twinto-stations-circle";
const STATIONS_LABEL_LAYER_ID = "twinto-stations-label";
const SELECTED_LAYER_ID = "twinto-stations-selected";

function routesGeoJson(): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  return {
    type: "FeatureCollection",
    features: listRoutes().map((route) => {
      const stops = listStops(route.id).sort((a, b) => a.sequence - b.sequence);
      return {
        type: "Feature",
        properties: { routeId: route.id, name: route.name, color: route.color, mode: route.mode },
        geometry: {
          type: "LineString",
          coordinates: stops.map((stop) => [stop.lng, stop.lat]),
        },
      };
    }),
  };
}

function stationsGeoJson(): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: "FeatureCollection",
    features: listStations().map((station) => ({
      type: "Feature",
      properties: { stationId: station.id, name: station.name },
      geometry: { type: "Point", coordinates: [station.lng, station.lat] },
    })),
  };
}

/**
 * Line 1 (and connecting streetcar/bus feeder) routes and stations, drawn
 * from the synthetic fixture network in `@/data/transit/network` (never a
 * live GTFS feed; see that file's header). Clicking a station sets it as
 * selected in `useMapStore`; clicking empty map elsewhere clears it (handled
 * by TorontoMap's own click listener).
 */
export function TransitLayers({ map }: { map: MapLibreMap | null }) {
  const selectedStationId = useMapStore((s) => s.selectedStationId);
  const setSelectedStation = useMapStore((s) => s.setSelectedStation);
  const mountedRef = useRef(false);

  useEffect(() => {
    if (!map) return;

    map.addSource(ROUTES_SOURCE_ID, { type: "geojson", data: routesGeoJson() });
    map.addLayer({
      id: ROUTES_LINE_LAYER_ID,
      type: "line",
      source: ROUTES_SOURCE_ID,
      paint: {
        "line-color": ["get", "color"],
        "line-width": ["match", ["get", "mode"], "subway", 4, 2.5],
        "line-opacity": 0.85,
      },
    });

    map.addSource(STATIONS_SOURCE_ID, { type: "geojson", data: stationsGeoJson() });
    map.addLayer({
      id: STATIONS_CIRCLE_LAYER_ID,
      type: "circle",
      source: STATIONS_SOURCE_ID,
      paint: {
        "circle-radius": 6,
        "circle-color": "#0A0D14",
        "circle-stroke-width": 2,
        "circle-stroke-color": "#EDEFF3",
      },
    });
    map.addLayer({
      id: STATIONS_LABEL_LAYER_ID,
      type: "symbol",
      source: STATIONS_SOURCE_ID,
      layout: {
        "text-field": ["get", "name"],
        "text-size": 11,
        "text-offset": [0, 1.3],
        "text-anchor": "top",
      },
      paint: {
        "text-color": "#EDEFF3",
        "text-halo-color": "#0A0D14",
        "text-halo-width": 1.2,
      },
    });
    map.addLayer({
      id: SELECTED_LAYER_ID,
      type: "circle",
      source: STATIONS_SOURCE_ID,
      filter: ["==", ["get", "stationId"], "__none__"],
      paint: {
        "circle-radius": 11,
        "circle-color": "#E0333B",
        "circle-opacity": 0.25,
        "circle-stroke-width": 2,
        "circle-stroke-color": "#E0333B",
      },
    });

    const onStationClick = (event: MapLayerMouseEvent) => {
      const feature = event.features?.[0];
      const stationId = feature?.properties?.stationId;
      if (typeof stationId === "string") {
        setSelectedStation(stationId);
      }
    };
    map.on("click", STATIONS_CIRCLE_LAYER_ID, onStationClick);
    map.on("mouseenter", STATIONS_CIRCLE_LAYER_ID, () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", STATIONS_CIRCLE_LAYER_ID, () => {
      map.getCanvas().style.cursor = "";
    });

    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      map.off("click", STATIONS_CIRCLE_LAYER_ID, onStationClick);
      for (const id of [SELECTED_LAYER_ID, STATIONS_LABEL_LAYER_ID, STATIONS_CIRCLE_LAYER_ID, ROUTES_LINE_LAYER_ID]) {
        if (map.getLayer(id)) map.removeLayer(id);
      }
      for (const id of [STATIONS_SOURCE_ID, ROUTES_SOURCE_ID]) {
        if (map.getSource(id)) map.removeSource(id);
      }
    };
  }, [map, setSelectedStation]);

  useEffect(() => {
    if (!map || !mountedRef.current || !map.getLayer(SELECTED_LAYER_ID)) return;
    map.setFilter(SELECTED_LAYER_ID, ["==", ["get", "stationId"], selectedStationId ?? "__none__"]);
  }, [map, selectedStationId]);

  return null;
}
