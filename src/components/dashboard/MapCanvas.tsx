"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { useSimStore } from "@/store/useSimStore";
import { useMapStore } from "@/store/useMapStore";
import { getScenario } from "@/lib/sim/scenarios";
import { resolveAlignment } from "@/lib/sim/engine";
import {
  buildStreetWalkAnchors,
  streetWalkPosition,
  type StreetWalkAnchor,
} from "@/lib/sim/streets";
import {
  placeFromBuildingFeature,
  placeFromNeighbourhoodArea,
  polygonCentroid,
} from "@/lib/twinto/place-context";
import { buildTrainRouteConfigs, trainCollection } from "@/lib/map/trains";
import {
  BUILDING_BASE_EXPRESSION,
  BUILDING_HEIGHT_EXPRESSION,
  LOCALIZED_3D_BEARING,
  LOCALIZED_3D_PITCH,
  LOCALIZED_BUILDINGS_3D_LAYER,
  localized3DOffset,
  localized3DZoom,
  localizedBuildingFilter,
  localizedBuildingLayer,
} from "@/lib/map/localized-3d";
import type {
  NeighbourhoodCollection,
  Persona,
  RouteCollection,
  StreetCollection,
} from "@/lib/sim/types";
import {
  ACCEPT_NEUTRAL,
  ACCEPT_OPPOSE,
  ACCEPT_SUPPORT,
  BUS_COLOR,
  ROUTE_COLORS,
  ROUTE_FALLBACK,
} from "@/lib/map/palette";
import { AgentOverlayLayer } from "@/components/map/AgentOverlayLayer";
import { CandidateMarkerLayer } from "@/components/map/CandidateMarkerLayer";

const SELECTED_BUILDING_SOURCE = "torontwin-selected-building";
const SELECTED_BUILDING_FILL = "torontwin-selected-building-fill";
const SELECTED_BUILDING_LINE = "torontwin-selected-building-line";
const SELECTED_BUILDING_EXTRUSION =
  "torontwin-selected-building-extrusion";

function buildingLayerIds(map: maplibregl.Map): string[] {
  const style = map.getStyle();
  if (!style?.layers) return [];
  return style.layers
    .filter((layer) => /building/i.test(layer.id) && (layer.type === "fill" || layer.type === "fill-extrusion"))
    .map((layer) => layer.id)
    .filter((id) => map.getLayer(id));
}
const TRAIN_ICON_ID = "ttc-subway-car";
const TRAIN_ICON_URL = "/icons/ttc-subway-car.png";
const STREETCAR_ICON_ID = "ttc-streetcar";
const STREETCAR_ICON_URL = "/icons/ttc-streetcar.png";

// Free CARTO "Dark Matter" vector style over real OpenStreetMap data.
const BASEMAP_STYLE =
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

const TORONTO_BOUNDS: [number, number, number, number] = [
  -79.6393, 43.581, -79.1156, 43.8555,
];

const SWEEP_MS = 1100;
const SWEEP_STEPS = 12;

interface TooltipState {
  x: number;
  y: number;
  title: string;
  lines: string[];
}

interface MapCanvasProps {
  neighbourhoods: NeighbourhoodCollection;
  routes: RouteCollection;
  busRoutes: RouteCollection;
  streets: StreetCollection;
  personas: Persona[];
  onReady: () => void;
}

interface WalkContext {
  anchors: (StreetWalkAnchor | null)[];
  t: number;
}

function personaCollection(
  personas: Persona[],
  acceptance: Float32Array | null,
  walk?: WalkContext
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: personas.map((p) => {
      let lng = p.lng;
      let lat = p.lat;
      const anchor = walk?.anchors[p.id];
      if (anchor) {
        [lng, lat] = streetWalkPosition(anchor, walk.t);
      }
      return {
        type: "Feature",
        id: p.id,
        properties: { a: acceptance ? acceptance[p.id] : 0.5 },
        geometry: { type: "Point", coordinates: [lng, lat] },
      };
    }),
  };
}

const ACCEPT_RAMP = [
  "interpolate",
  ["linear"],
  ["coalesce", ["feature-state", "mean"], 0.5],
  0,
  ACCEPT_OPPOSE,
  0.5,
  ACCEPT_NEUTRAL,
  1,
  ACCEPT_SUPPORT,
] as maplibregl.ExpressionSpecification;

const routeColorExpr = [
  "match",
  ["get", "route"],
  ...Object.entries(ROUTE_COLORS).flat(),
  ROUTE_FALLBACK,
] as unknown as maplibregl.ExpressionSpecification;

const RAIL_FILTER = [
  "match",
  ["get", "mode"],
  ["subway", "lrt"],
  true,
  false,
] as unknown as maplibregl.FilterSpecification;

const STREETCAR_FILTER = [
  "==",
  ["get", "mode"],
  "streetcar",
] as unknown as maplibregl.FilterSpecification;

export function MapCanvas({
  neighbourhoods,
  routes,
  busRoutes,
  streets,
  personas,
  onReady,
}: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const loadedRef = useRef(false);
  const lastCameraTargetRef = useRef<
    ReturnType<typeof useMapStore.getState>["cameraTarget"]
  >(null);
  const lastBoundsTargetRef = useRef<
    ReturnType<typeof useMapStore.getState>["boundsTarget"]
  >(null);
  const [ready, setReady] = useState(false);
  const displayedA = useRef<Float32Array>(
    new Float32Array(personas.length).fill(0.5)
  );
  const sweepToken = useRef(0);
  const hoveredNbhd = useRef<number | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const reducedMotion = useReducedMotion();
  const reducedMotionRef = useRef(reducedMotion);
  reducedMotionRef.current = reducedMotion;
  const walkAnchorsRef = useRef<(StreetWalkAnchor | null)[] | null>(null);
  const walkStartRef = useRef(0);
  const trainsLayerReadyRef = useRef(false);
  const trainsStartRef = useRef(0);
  const trainConfigs = useMemo(() => buildTrainRouteConfigs(routes), [routes]);
  const streetcarsLayerReadyRef = useRef(false);
  const streetcarsStartRef = useRef(0);
  const streetcarConfigs = useMemo(
    () => buildTrainRouteConfigs(routes, ["streetcar"]),
    [routes]
  );

  const result = useSimStore((s) => s.result);
  const layers = useSimStore((s) => s.layers);
  const scenarioId = useSimStore((s) => s.scenarioId);
  const selectedCode = useSimStore((s) => s.selectedCode);
  const cameraTarget = useMapStore((s) => s.cameraTarget);
  const boundsTarget = useMapStore((s) => s.boundsTarget);
  const highlightedNeighbourhoodIds = useMapStore((s) => s.highlightedNeighbourhoodIds);
  const agent3DFocus = useMapStore((s) => s.agent3DFocus);
  const clearAgent3DFocus = useMapStore((s) => s.clearAgent3DFocus);
  const layersRef = useRef(layers);
  layersRef.current = layers;

  // Current wander offset context, or undefined when motion should be still
  // (reduced-motion preference, or before the walk params are built).
  const currentWalk = (): WalkContext | undefined => {
    const anchors = walkAnchorsRef.current;
    if (!anchors || reducedMotionRef.current) return undefined;
    return { anchors, t: performance.now() - walkStartRef.current };
  };

  // ---- init -------------------------------------------------------------
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASEMAP_STYLE,
      bounds: TORONTO_BOUNDS,
      fitBoundsOptions: { padding: 40 },
      minZoom: 9,
      maxZoom: 18,
      maxBounds: [-80.4, 43.2, -78.4, 44.3],
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: true,
    });
    map.touchZoomRotate.disableRotation();
    map.addControl(
      new maplibregl.AttributionControl({
        compact: true,
        customAttribution:
          "Boundaries & census: open.toronto.ca · Routes: TTC GTFS",
      }),
      "bottom-left"
    );
    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      "bottom-right"
    );
    mapRef.current = map;

    map.on("load", () => {
      const firstSymbol = map
        .getStyle()
        .layers?.find((l) => l.type === "symbol")?.id;

      map.addSource("nbhd", { type: "geojson", data: neighbourhoods });
      map.addSource("routes", { type: "geojson", data: routes });
      map.addSource("bus-routes", { type: "geojson", data: busRoutes });
      map.addSource("scenario", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      walkAnchorsRef.current = buildStreetWalkAnchors(personas, streets);
      walkStartRef.current = performance.now();
      map.addSource("personas", {
        type: "geojson",
        data: personaCollection(personas, null, currentWalk()),
      });

      map.addLayer(
        {
          id: "nbhd-fill",
          type: "fill",
          source: "nbhd",
          paint: { "fill-color": ACCEPT_RAMP, "fill-opacity": 0.04 },
        },
        firstSymbol
      );
      map.addLayer(
        {
          id: "nbhd-line",
          type: "line",
          source: "nbhd",
          paint: {
            "line-color": "rgba(235, 242, 236, 0.08)",
            "line-width": 0.7,
          },
        },
        firstSymbol
      );
      if (map.getSource("carto")) {
        map.addLayer(localizedBuildingLayer(), firstSymbol);
        map.setLight({
          anchor: "viewport",
          color: "#d6f7f3",
          intensity: 0.34,
          position: [1.15, 210, 32],
        });
      }
      map.addLayer(
        {
          id: "bus-glow",
          type: "line",
          source: "bus-routes",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": BUS_COLOR,
            "line-width": [
              "interpolate",
              ["linear"],
              ["zoom"],
              9,
              2.5,
              14,
              7,
            ],
            "line-opacity": 0.2,
            "line-blur": 2,
          },
        },
        firstSymbol
      );
      map.addLayer(
        {
          id: "bus-line",
          type: "line",
          source: "bus-routes",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": BUS_COLOR,
            "line-width": [
              "interpolate",
              ["linear"],
              ["zoom"],
              9,
              1.2,
              14,
              2.8,
            ],
            "line-opacity": 0.88,
          },
        },
        firstSymbol
      );
      map.addLayer(
        {
          id: "streetcar-glow",
          type: "line",
          source: "routes",
          filter: STREETCAR_FILTER,
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": routeColorExpr,
            "line-width": [
              "interpolate",
              ["linear"],
              ["zoom"],
              9,
              4,
              14,
              11,
            ],
            "line-opacity": 0.14,
            "line-blur": 3,
          },
        },
        firstSymbol
      );
      map.addLayer(
        {
          id: "streetcar-line",
          type: "line",
          source: "routes",
          filter: STREETCAR_FILTER,
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": routeColorExpr,
            "line-width": [
              "interpolate",
              ["linear"],
              ["zoom"],
              9,
              1.2,
              14,
              3,
            ],
            "line-opacity": 0.92,
          },
        },
        firstSymbol
      );
      map.addLayer(
        {
          id: "rail-glow",
          type: "line",
          source: "routes",
          filter: RAIL_FILTER,
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": routeColorExpr,
            "line-width": [
              "interpolate",
              ["linear"],
              ["zoom"],
              9,
              4,
              14,
              11,
            ],
            "line-opacity": 0.14,
            "line-blur": 3,
          },
        },
        firstSymbol
      );
      map.addLayer(
        {
          id: "rail-line",
          type: "line",
          source: "routes",
          filter: RAIL_FILTER,
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": routeColorExpr,
            "line-width": [
              "interpolate",
              ["linear"],
              ["zoom"],
              9,
              2.2,
              14,
              5,
            ],
            "line-opacity": 0.92,
          },
        },
        firstSymbol
      );
      map.addSource("trains", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      trainsStartRef.current = performance.now();
      map
        .loadImage(TRAIN_ICON_URL)
        .then(({ data: image }) => {
          if (!mapRef.current || mapRef.current.getLayer("trains")) return;
          if (!map.hasImage(TRAIN_ICON_ID)) map.addImage(TRAIN_ICON_ID, image);
          map.addLayer({
            id: "trains",
            type: "symbol",
            source: "trains",
            layout: {
              "icon-image": TRAIN_ICON_ID,
              "icon-size": [
                "interpolate",
                ["linear"],
                ["zoom"],
                10,
                0.05,
                14,
                0.12,
                16,
                0.22,
              ],
              // The source sprite's long axis runs horizontally (bearing 0 = due
              // north), so rotate 90° further to point it along the direction
              // of travel.
              "icon-rotate": ["+", ["get", "bearing"], 90],
              "icon-rotation-alignment": "map",
              "icon-allow-overlap": true,
              "icon-ignore-placement": true,
              visibility: layersRef.current.rail ? "visible" : "none",
            },
          });
          trainsLayerReadyRef.current = true;
        })
        .catch(() => {
          // Missing icon asset shouldn't break the rest of the map.
        });
      map.addSource("streetcars", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      streetcarsStartRef.current = performance.now();
      map
        .loadImage(STREETCAR_ICON_URL)
        .then(({ data: image }) => {
          if (!mapRef.current || mapRef.current.getLayer("streetcars")) return;
          if (!map.hasImage(STREETCAR_ICON_ID))
            map.addImage(STREETCAR_ICON_ID, image);
          map.addLayer({
            id: "streetcars",
            type: "symbol",
            source: "streetcars",
            layout: {
              "icon-image": STREETCAR_ICON_ID,
              "icon-size": [
                "interpolate",
                ["linear"],
                ["zoom"],
                10,
                0.05,
                14,
                0.12,
                16,
                0.22,
              ],
              // Same convention as the subway car sprite: long axis runs
              // horizontally (bearing 0 = due north), so rotate 90° further
              // to point it along the direction of travel.
              "icon-rotate": ["+", ["get", "bearing"], 90],
              "icon-rotation-alignment": "map",
              "icon-allow-overlap": true,
              "icon-ignore-placement": true,
              visibility: layersRef.current.streetcar ? "visible" : "none",
            },
          });
          streetcarsLayerReadyRef.current = true;
        })
        .catch(() => {
          // Missing icon asset shouldn't break the rest of the map.
        });
      map.addLayer({
        id: "scenario-casing",
        type: "line",
        source: "scenario",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "rgba(10, 12, 10, 0.9)",
          "line-width": 7,
          "line-opacity": 0.6,
        },
      });
      map.addLayer({
        id: "scenario-line",
        type: "line",
        source: "scenario",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["get", "accent"],
          "line-width": 3,
          "line-dasharray": [1.6, 1.4],
        },
      });
      map.addLayer({
        id: "personas",
        type: "circle",
        source: "personas",
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            9,
            1.5,
            11,
            2.4,
            13,
            3.6,
            16,
            6.5,
          ],
          "circle-color": [
            "interpolate",
            ["linear"],
            ["get", "a"],
            0,
            ACCEPT_OPPOSE,
            0.5,
            ACCEPT_NEUTRAL,
            1,
            ACCEPT_SUPPORT,
          ],
          "circle-opacity": 0.82,
        },
      });
      map.addLayer({
        id: "nbhd-hover-line",
        type: "line",
        source: "nbhd",
        paint: { "line-color": "rgba(238, 244, 239, 0.55)", "line-width": 1.4 },
        filter: ["==", ["id"], -1],
      });
      map.addLayer({
        id: "nbhd-selected-line",
        type: "line",
        source: "nbhd",
        paint: { "line-color": "rgba(240, 248, 242, 0.9)", "line-width": 2 },
        filter: ["==", ["id"], -1],
      });

      map.addSource(SELECTED_BUILDING_SOURCE, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: SELECTED_BUILDING_FILL,
        type: "fill",
        source: SELECTED_BUILDING_SOURCE,
        paint: {
          "fill-color": "#5BA3F5",
          "fill-opacity": 0.32,
        },
      });
      map.addLayer({
        id: SELECTED_BUILDING_EXTRUSION,
        type: "fill-extrusion",
        source: SELECTED_BUILDING_SOURCE,
        minzoom: 12.75,
        layout: { visibility: "none" },
        paint: {
          "fill-extrusion-color": "#5BA3F5",
          "fill-extrusion-height": BUILDING_HEIGHT_EXPRESSION,
          "fill-extrusion-base": BUILDING_BASE_EXPRESSION,
          "fill-extrusion-opacity": 0.7,
          "fill-extrusion-vertical-gradient": true,
        },
      });
      map.addLayer({
        id: SELECTED_BUILDING_LINE,
        type: "line",
        source: SELECTED_BUILDING_SOURCE,
        paint: {
          "line-color": "#8EC5FF",
          "line-width": 2,
          "line-opacity": 0.95,
        },
      });

      loadedRef.current = true;
      setReady(true);
      onReady();
    });

    // ---- interactions ----------------------------------------------------
    const nbhdByCode = new Map(
      neighbourhoods.features.map((f) => [f.properties.code, f.properties])
    );

    map.on("mousemove", (e) => {
      if (!loadedRef.current) return;
      const routeHits = map.queryRenderedFeatures(e.point, {
        layers: [
          "rail-line",
          "rail-glow",
          "streetcar-line",
          "streetcar-glow",
          "bus-line",
          "bus-glow",
        ],
      });
      const nbhdHits = map.queryRenderedFeatures(e.point, {
        layers: ["nbhd-fill"],
      });

      const prev = hoveredNbhd.current;
      const nbhd = nbhdHits[0];
      const id = nbhd ? (nbhd.id as number) : null;
      if (id !== prev) {
        map.setFilter("nbhd-hover-line", ["==", ["id"], id ?? -1]);
        hoveredNbhd.current = id;
      }

      if (routeHits.length > 0) {
        const p = routeHits[0].properties as { route: string; name: string };
        map.getCanvas().style.cursor = "pointer";
        setTooltip({
          x: e.point.x,
          y: e.point.y,
          title: /^\d/.test(p.name) ? p.name : `${p.route} ${p.name}`,
          lines: [],
        });
        return;
      }

      if (nbhd) {
        const props = nbhdByCode.get(String(nbhd.properties.code));
        const agg = useSimStore
          .getState()
          .result?.byNeighbourhood.get(String(nbhd.properties.code));
        map.getCanvas().style.cursor = "pointer";
        setTooltip({
          x: e.point.x,
          y: e.point.y,
          title: props?.name ?? "",
          lines: [
            `Pop. ${props?.population.toLocaleString() ?? "–"}`,
            agg ? `Acceptance ${(agg.mean * 100).toFixed(0)}%` : "",
          ].filter(Boolean),
        });
        return;
      }

      map.getCanvas().style.cursor = "";
      setTooltip(null);
    });

    map.on("mouseout", () => {
      setTooltip(null);
      map.setFilter("nbhd-hover-line", ["==", ["id"], -1]);
      hoveredNbhd.current = null;
    });

    map.on("click", (e) => {
      if (!loadedRef.current) return;

      const buildingLayers = buildingLayerIds(map);
      const buildingHits =
        buildingLayers.length > 0
          ? map.queryRenderedFeatures(e.point, { layers: buildingLayers })
          : [];
      if (buildingHits[0]?.geometry) {
        const feature = buildingHits[0];
        const coordinates = polygonCentroid(feature.geometry as GeoJSON.Geometry);
        if (coordinates) {
          const place = placeFromBuildingFeature({
            featureId: feature.id,
            coordinates,
            properties: (feature.properties ?? {}) as Record<string, unknown>,
          });
          useMapStore.getState().selectPlace(place);
          const source = map.getSource(SELECTED_BUILDING_SOURCE) as maplibregl.GeoJSONSource | undefined;
          source?.setData({
            type: "FeatureCollection",
            features: [
              {
                type: "Feature",
                properties: (feature.properties ?? {}) as Record<
                  string,
                  unknown
                >,
                geometry: feature.geometry as GeoJSON.Geometry,
              },
            ],
          });
          return;
        }
      }

      const hits = map.queryRenderedFeatures(e.point, {
        layers: ["nbhd-fill"],
      });
      if (hits.length > 0) {
        const feature = hits[0];
        const code = String(feature.properties?.code ?? "");
        const props = nbhdByCode.get(code);
        const coordinates =
          polygonCentroid(feature.geometry as GeoJSON.Geometry) ??
          (e.lngLat ? ([e.lngLat.lng, e.lngLat.lat] as [number, number]) : null);
        if (code && props && coordinates) {
          useMapStore.getState().selectPlace(
            placeFromNeighbourhoodArea({
              code,
              name: props.name,
              coordinates,
            }),
          );
        }
        const source = map.getSource(SELECTED_BUILDING_SOURCE) as maplibregl.GeoJSONSource | undefined;
        source?.setData({ type: "FeatureCollection", features: [] });
        useSimStore.getState().select(code || null);
      } else {
        useMapStore.getState().clearPlaceSelection();
        const source = map.getSource(SELECTED_BUILDING_SOURCE) as maplibregl.GeoJSONSource | undefined;
        source?.setData({ type: "FeatureCollection", features: [] });
        useSimStore.getState().select(null);
      }
    });

    return () => {
      loadedRef.current = false;
      map.remove();
      mapRef.current = null;
    };
    // The data props are loaded once before mount; the map lives for the
    // component's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- layer visibility --------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const vis = (on: boolean) => (on ? "visible" : "none");
    for (const id of ["rail-line", "rail-glow"]) {
      map.setLayoutProperty(id, "visibility", vis(layers.rail));
    }
    if (map.getLayer("trains")) {
      map.setLayoutProperty("trains", "visibility", vis(layers.rail));
    }
    for (const id of ["streetcar-line", "streetcar-glow"]) {
      map.setLayoutProperty(id, "visibility", vis(layers.streetcar));
    }
    if (map.getLayer("streetcars")) {
      map.setLayoutProperty("streetcars", "visibility", vis(layers.streetcar));
    }
    for (const id of ["bus-line", "bus-glow"]) {
      map.setLayoutProperty(id, "visibility", vis(layers.bus));
    }
    map.setLayoutProperty("personas", "visibility", vis(layers.personas));
    // With the sentiment layer on, tint strength follows conviction: split
    // neighbourhoods stay near-transparent instead of washing the map grey.
    map.setPaintProperty(
      "nbhd-fill",
      "fill-opacity",
      layers.districts
        ? ([
            "interpolate",
            ["linear"],
            [
              "abs",
              ["-", ["coalesce", ["feature-state", "mean"], 0.5], 0.5],
            ],
            0,
            0.07,
            0.08,
            0.3,
            0.3,
            0.55,
          ] as unknown as maplibregl.ExpressionSpecification)
        : 0.04
    );
  }, [layers, result, ready]);

  // ---- selection outline ---------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const id = selectedCode ? parseInt(selectedCode, 10) : -1;
    map.setFilter("nbhd-selected-line", ["==", ["id"], id]);
  }, [selectedCode, ready]);

  // ---- scenario alignment overlay -----------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const scenario = getScenario(scenarioId);
    const alignment = resolveAlignment(scenario, routes);
    const source = map.getSource<maplibregl.GeoJSONSource>("scenario");
    source?.setData({
      type: "FeatureCollection",
      features:
        alignment && scenario.kind === "corridor"
          ? [
              {
                type: "Feature",
                properties: { accent: scenario.accent },
                geometry: { type: "LineString", coordinates: alignment },
              },
            ]
          : [],
    });
  }, [scenarioId, routes, ready]);

  // ---- results: choropleth state + persona sweep ---------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !result) return;

    for (const f of neighbourhoods.features) {
      const agg = result.byNeighbourhood.get(f.properties.code);
      map.setFeatureState(
        { source: "nbhd", id: f.id },
        { mean: agg ? agg.mean : 0.5 }
      );
    }

    const source = map.getSource<maplibregl.GeoJSONSource>("personas");
    if (!source) return;

    const token = ++sweepToken.current;
    const target = result.acceptance;
    const sweep = result.sweepKm;
    const current = displayedA.current;

    if (reducedMotionRef.current) {
      current.set(target);
      source.setData(personaCollection(personas, target, currentWalk()));
      return;
    }

    let maxKm = 0;
    for (let i = 0; i < sweep.length; i++) {
      if (sweep[i] > maxKm && sweep[i] < 60) maxKm = sweep[i];
    }

    // Reveal the new acceptance values as a wave expanding outward from the
    // intervention, so cause reads before effect.
    const start = performance.now();
    const tick = (now: number) => {
      if (sweepToken.current !== token) return;
      const t = Math.min(1, (now - start) / SWEEP_MS);
      const threshold = maxKm * t;
      for (let i = 0; i < target.length; i++) {
        if (sweep[i] <= threshold) current[i] = target[i];
      }
      if (t >= 1) current.set(target);
      source.setData(personaCollection(personas, current, currentWalk()));
      if (t < 1) {
        window.setTimeout(
          () => requestAnimationFrame(tick),
          SWEEP_MS / SWEEP_STEPS
        );
      }
    };
    requestAnimationFrame(tick);
  }, [result, neighbourhoods, personas, ready]);

  // ---- pedestrian wander: residents amble around their home block ---------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    let rafId: number | undefined;
    let cancelled = false;

    // Runs every animation frame (cheap at 2k dots) so the wander reads as
    // continuous motion rather than discrete hops.
    const tick = () => {
      if (cancelled) return;
      if (!reducedMotionRef.current && layersRef.current.personas) {
        const source = map.getSource<maplibregl.GeoJSONSource>("personas");
        const walk = currentWalk();
        if (source && walk) {
          source.setData(personaCollection(personas, displayedA.current, walk));
        }
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      if (rafId !== undefined) cancelAnimationFrame(rafId);
    };
    // reducedMotion/layers are read live via refs so the loop doesn't restart
    // on every toggle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, personas]);

  // Agent camera fly / fit. A focus-only update changes the aspect without
  // replaying an old camera command, so the 2D control preserves user panning.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const cameraChanged =
      cameraTarget !== lastCameraTargetRef.current ||
      boundsTarget !== lastBoundsTargetRef.current;
    lastCameraTargetRef.current = cameraTarget;
    lastBoundsTargetRef.current = boundsTarget;

    const pitch = agent3DFocus ? LOCALIZED_3D_PITCH : 0;
    const bearing = agent3DFocus ? LOCALIZED_3D_BEARING : 0;
    const focusOffset = localized3DOffset(
      map.getContainer().clientHeight,
    );
    if (cameraChanged && boundsTarget) {
      if (agent3DFocus) {
        const fitted = map.cameraForBounds(boundsTarget.bounds, {
          padding: boundsTarget.padding ?? 48,
          bearing,
          maxZoom: 17,
          offset: focusOffset,
        });
        if (fitted) {
          map.flyTo({
            center: fitted.center,
            zoom: localized3DZoom(
              fitted.zoom ?? map.getZoom(),
              map.getMaxZoom(),
            ),
            duration: reducedMotion ? 0 : (boundsTarget.durationMs ?? 900),
            pitch,
            bearing,
            essential: true,
          });
          return;
        }
      }
      map.fitBounds(boundsTarget.bounds, {
        padding: boundsTarget.padding ?? 48,
        duration: reducedMotion ? 0 : (boundsTarget.durationMs ?? 900),
        pitch,
        bearing,
        essential: true,
      });
      return;
    }
    if (cameraChanged && cameraTarget) {
      map.flyTo({
        center: cameraTarget.center,
        zoom: agent3DFocus
          ? localized3DZoom(cameraTarget.zoom, map.getMaxZoom())
          : cameraTarget.zoom,
        offset: agent3DFocus ? focusOffset : [0, 0],
        duration: reducedMotion ? 0 : (cameraTarget.durationMs ?? 900),
        pitch,
        bearing,
        essential: true,
      });
      return;
    }
    map.easeTo({
      pitch,
      bearing,
      duration: reducedMotion ? 0 : 550,
      essential: true,
    });
  }, [agent3DFocus, boundsTarget, cameraTarget, ready, reducedMotion]);

  // Clip extrusions to the active focus and expose rotation only in 3D mode.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (map.getLayer(LOCALIZED_BUILDINGS_3D_LAYER)) {
      map.setFilter(
        LOCALIZED_BUILDINGS_3D_LAYER,
        localizedBuildingFilter(agent3DFocus, neighbourhoods),
      );
    }
    map.setLayoutProperty(
      SELECTED_BUILDING_EXTRUSION,
      "visibility",
      agent3DFocus ? "visible" : "none",
    );
    if (agent3DFocus) {
      map.dragRotate.enable();
      map.touchZoomRotate.enableRotation();
    } else {
      map.dragRotate.disable();
      map.touchZoomRotate.disableRotation();
    }
  }, [agent3DFocus, neighbourhoods, ready]);

  // Neighbourhood highlight by Coolness `code`
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !map.getSource("nbhd")) return;
    const layerId = "nbhd-agent-hl";
    const fillId = "nbhd-agent-hl-fill";
    if (!map.getLayer(fillId)) {
      map.addLayer({
        id: fillId,
        type: "fill",
        source: "nbhd",
        paint: { "fill-color": "#22d3ee", "fill-opacity": 0.16 },
        filter: ["==", ["get", "code"], "__none__"],
      });
    }
    if (!map.getLayer(layerId)) {
      map.addLayer({
        id: layerId,
        type: "line",
        source: "nbhd",
        paint: { "line-color": "#67e8f9", "line-width": 2.2 },
        filter: ["==", ["get", "code"], "__none__"],
      });
    }
    const filter =
      highlightedNeighbourhoodIds.length === 0
        ? (["==", ["get", "code"], "__none__"] as maplibregl.FilterSpecification)
        : ([
            "in",
            ["get", "code"],
            ["literal", highlightedNeighbourhoodIds],
          ] as maplibregl.FilterSpecification);
    map.setFilter(fillId, filter);
    map.setFilter(layerId, filter);
  }, [highlightedNeighbourhoodIds, ready]);

  // ---- subway/LRT cars: multiple vehicles per line, shuttling end-to-end --
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || trainConfigs.length === 0) return;
    let rafId: number | undefined;
    let cancelled = false;

    const tick = () => {
      if (cancelled) return;
      if (trainsLayerReadyRef.current && layersRef.current.rail) {
        const source = map.getSource<maplibregl.GeoJSONSource>("trains");
        if (source) {
          const elapsedSeconds = reducedMotionRef.current
            ? 0
            : (performance.now() - trainsStartRef.current) / 1000;
          source.setData(trainCollection(trainConfigs, elapsedSeconds));
        }
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      if (rafId !== undefined) cancelAnimationFrame(rafId);
    };
  }, [ready, trainConfigs]);

  // ---- streetcars: multiple vehicles per line, shuttling end-to-end ------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || streetcarConfigs.length === 0) return;
    let rafId: number | undefined;
    let cancelled = false;

    const tick = () => {
      if (cancelled) return;
      if (streetcarsLayerReadyRef.current && layersRef.current.streetcar) {
        const source = map.getSource<maplibregl.GeoJSONSource>("streetcars");
        if (source) {
          const elapsedSeconds = reducedMotionRef.current
            ? 0
            : (performance.now() - streetcarsStartRef.current) / 1000;
          source.setData(trainCollection(streetcarConfigs, elapsedSeconds));
        }
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      if (rafId !== undefined) cancelAnimationFrame(rafId);
    };
  }, [ready, streetcarConfigs]);

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="h-full w-full" />
      {ready && (
        <>
          <AgentOverlayLayer map={mapRef.current} />
          <CandidateMarkerLayer map={mapRef.current} />
        </>
      )}
      {tooltip && (
        <div
          className="pointer-events-none absolute z-20 max-w-[240px] -translate-y-full rounded-sm border border-white/10 bg-[#14181a]/95 px-2.5 py-1.5"
          style={{ left: tooltip.x + 12, top: tooltip.y - 8 }}
        >
          <div className="font-ui text-[12px] font-semibold leading-tight text-[#e8ede9]">
            {tooltip.title}
          </div>
          {tooltip.lines.map((line) => (
            <div
              key={line}
              className="font-mono text-[10.5px] leading-snug text-[#98a29b]"
            >
              {line}
            </div>
          ))}
        </div>
      )}
      {agent3DFocus && (
        <button
          type="button"
          data-testid="localized-3d-exit"
          onClick={clearAgent3DFocus}
          className="absolute bottom-20 right-3 z-20 border border-white/10 bg-[#14181a]/95 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wider text-[#98a29b] backdrop-blur transition-colors hover:text-[#e8ede9] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300 md:bottom-16"
          aria-label="Return to 2D overview"
        >
          2D overview
        </button>
      )}
    </div>
  );
}
