"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl, { type Map as MapLibreMap } from "maplibre-gl";
import { useMapStore } from "@/store/useMapStore";
import { TransitLayers } from "@/components/map/TransitLayers";
import { CitizenDensityLayer } from "@/components/map/CitizenDensityLayer";
import { CrowdHeatmapLayer } from "@/components/map/CrowdHeatmapLayer";
import { EventLayer } from "@/components/map/EventLayer";
import { VehicleLayer } from "@/components/map/VehicleLayer";
import { CandidateMarkerLayer } from "@/components/map/CandidateMarkerLayer";
import { NeighbourhoodHighlightLayer } from "@/components/map/NeighbourhoodHighlightLayer";
import { AgentOverlayLayer } from "@/components/map/AgentOverlayLayer";
import { InterventionDiffLayer } from "@/components/map/InterventionDiffLayer";
import { MapLegend } from "@/components/map/MapLegend";
import { DEFAULT_MAP_STYLE_URL, TORONTO_VIEW } from "@/lib/map/map-config";
import { placeFromBuildingFeature, polygonCentroid } from "@/lib/techto/place-context";

export { DEFAULT_MAP_STYLE_URL, TORONTO_VIEW };

const BUILDING_LAYER_ID = "building";
const SELECTED_BUILDING_SOURCE = "techto-selected-building";
const SELECTED_BUILDING_FILL = "techto-selected-building-fill";
const SELECTED_BUILDING_LINE = "techto-selected-building-line";

export interface StationCrowdLevel {
  stationId: string;
  /** 0 (empty) to 1+ (over capacity); drives CrowdHeatmapLayer intensity. */
  loadFactor: number;
}

export interface TorontoMapProps {
  /** Optional per-station crowding, usually the active run's baseline or candidate simulation. Absent renders no heat. */
  stationCrowd?: StationCrowdLevel[];
}

/**
 * The MapLibre map instance and shell. Layer components below are pure
 * effect components: each one adds/updates/removes its own sources and
 * layers on `map` and returns no DOM, so this file stays a thin orchestrator
 * rather than a place where every layer's drawing logic accumulates.
 */
export function TorontoMap({ stationCrowd }: TorontoMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [map, setMap] = useState<MapLibreMap | null>(null);

  const clearPlaceSelection = useMapStore((s) => s.clearPlaceSelection);
  const selectPlace = useMapStore((s) => s.selectPlace);
  const selectedPlace = useMapStore((s) => s.selectedPlace);
  const layers = useMapStore((s) => s.layers);
  const cameraTarget = useMapStore((s) => s.cameraTarget);
  const boundsTarget = useMapStore((s) => s.boundsTarget);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const styleUrl = process.env.NEXT_PUBLIC_MAP_STYLE_URL || DEFAULT_MAP_STYLE_URL;
    const instance = new maplibregl.Map({
      container: containerRef.current,
      style: styleUrl,
      center: TORONTO_VIEW.center,
      zoom: TORONTO_VIEW.zoom,
      bearing: TORONTO_VIEW.bearing,
      pitch: TORONTO_VIEW.pitch,
      attributionControl: { compact: true },
    });

    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    const applyBuildingSelection = (feature: maplibregl.MapGeoJSONFeature) => {
      if (!feature.geometry) return;
      const coordinates = polygonCentroid(feature.geometry as GeoJSON.Geometry);
      if (!coordinates) return;
      const place = placeFromBuildingFeature({
        featureId: feature.id,
        coordinates,
        properties: (feature.properties ?? {}) as Record<string, unknown>,
      });
      selectPlace(place);

      const source = instance.getSource(SELECTED_BUILDING_SOURCE) as maplibregl.GeoJSONSource | undefined;
      if (source) {
        source.setData({
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: {},
              geometry: feature.geometry as GeoJSON.Geometry,
            },
          ],
        });
      }
    };

    const onMapClick = (event: maplibregl.MapMouseEvent) => {
      if (event.defaultPrevented) return;

      const stationLayerIds = ["techto-stations-circle"].filter((id) => Boolean(instance.getLayer(id)));
      const stationHits =
        stationLayerIds.length > 0 ? instance.queryRenderedFeatures(event.point, { layers: stationLayerIds }) : [];
      if (stationHits.length > 0) return;

      // Query the basemap building layer even when TechTO overlays sit above it.
      const buildingHits = instance.getLayer(BUILDING_LAYER_ID)
        ? instance.queryRenderedFeatures(event.point, { layers: [BUILDING_LAYER_ID] })
        : [];
      if (buildingHits[0]) {
        applyBuildingSelection(buildingHits[0]);
        return;
      }

      clearPlaceSelection();
      const source = instance.getSource(SELECTED_BUILDING_SOURCE) as maplibregl.GeoJSONSource | undefined;
      if (source) {
        source.setData({ type: "FeatureCollection", features: [] });
      }
    };

    instance.on("load", () => {
      if (!instance.getSource(SELECTED_BUILDING_SOURCE)) {
        instance.addSource(SELECTED_BUILDING_SOURCE, {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
      }
      if (!instance.getLayer(SELECTED_BUILDING_FILL)) {
        instance.addLayer({
          id: SELECTED_BUILDING_FILL,
          type: "fill",
          source: SELECTED_BUILDING_SOURCE,
          paint: {
            "fill-color": "#3B82F6",
            "fill-opacity": 0.28,
          },
        });
      }
      if (!instance.getLayer(SELECTED_BUILDING_LINE)) {
        instance.addLayer({
          id: SELECTED_BUILDING_LINE,
          type: "line",
          source: SELECTED_BUILDING_SOURCE,
          paint: {
            "line-color": "#2563EB",
            "line-width": 2,
            "line-opacity": 0.9,
          },
        });
      }

      setMap(instance);
    });

    instance.on("click", onMapClick);

    mapRef.current = instance;

    return () => {
      instance.off("click", onMapClick);
      instance.remove();
      mapRef.current = null;
      setMap(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!map || !cameraTarget) return;
    map.flyTo({
      center: cameraTarget.center,
      zoom: cameraTarget.zoom,
      duration: cameraTarget.durationMs ?? 1200,
      essential: true,
    });
  }, [map, cameraTarget]);

  useEffect(() => {
    if (!map || !boundsTarget) return;
    map.fitBounds(boundsTarget.bounds, {
      padding: boundsTarget.padding ?? 48,
      duration: boundsTarget.durationMs ?? 1200,
    });
  }, [map, boundsTarget]);

  useEffect(() => {
    if (!map) return;
    const source = map.getSource(SELECTED_BUILDING_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    if (!selectedPlace || selectedPlace.kind !== "building") {
      source.setData({ type: "FeatureCollection", features: [] });
    }
  }, [map, selectedPlace]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} data-testid="toronto-map" className="absolute inset-0" />
      {layers.transit && <TransitLayers map={map} />}
      {layers.transit && <VehicleLayer map={map} />}
      {layers.parcels && <CitizenDensityLayer map={map} />}
      {layers.sentimentHeatmap && <CrowdHeatmapLayer map={map} stationCrowd={stationCrowd ?? []} />}
      {layers.policyOverlay && <EventLayer map={map} />}
      <NeighbourhoodHighlightLayer map={map} />
      <CandidateMarkerLayer map={map} />
      <AgentOverlayLayer map={map} />
      <InterventionDiffLayer map={map} />
      <div className="pointer-events-none absolute bottom-4 left-4 z-10">
        <MapLegend />
      </div>
    </div>
  );
}
