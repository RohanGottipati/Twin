"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl, { type Map as MapLibreMap } from "maplibre-gl";
import { useMapStore } from "@/store/useMapStore";
import { TransitLayers } from "@/components/map/TransitLayers";
import { CitizenDensityLayer } from "@/components/map/CitizenDensityLayer";
import { CrowdHeatmapLayer } from "@/components/map/CrowdHeatmapLayer";
import { EventLayer } from "@/components/map/EventLayer";
import { MapLegend } from "@/components/map/MapLegend";

export const DEFAULT_MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/bright";

/** Downtown Toronto, centered near Union Station; no 3D, no globe, no pitch. */
export const TORONTO_VIEW = {
  center: [-79.3832, 43.6532] as [number, number],
  zoom: 12.8,
  bearing: 0,
  pitch: 0,
};

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

  const setSelectedStation = useMapStore((s) => s.setSelectedStation);
  const layers = useMapStore((s) => s.layers);

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

    instance.on("load", () => setMap(instance));
    instance.on("click", () => {
      // Clicks on empty map area (not swallowed by a layer's own handler
      // in TransitLayers) clear the current station selection.
      setSelectedStation(null);
    });

    mapRef.current = instance;

    return () => {
      instance.remove();
      mapRef.current = null;
      setMap(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} data-testid="toronto-map" className="absolute inset-0" />
      {layers.transit && <TransitLayers map={map} />}
      {layers.parcels && <CitizenDensityLayer map={map} />}
      {layers.sentimentHeatmap && <CrowdHeatmapLayer map={map} stationCrowd={stationCrowd ?? []} />}
      {layers.policyOverlay && <EventLayer map={map} />}
      <div className="pointer-events-none absolute bottom-4 left-4 z-10">
        <MapLegend />
      </div>
    </div>
  );
}
