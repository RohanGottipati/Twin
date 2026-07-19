import type {
  ExpressionSpecification,
  FilterSpecification,
  LayerSpecification,
} from "maplibre-gl";

import type { MapAction } from "@/lib/techto/map-actions";

export const LOCALIZED_BUILDINGS_3D_LAYER =
  "techto-localized-buildings-3d";
export const LOCALIZED_3D_PITCH = 58;
export const LOCALIZED_3D_BEARING = -35;
export const LOCALIZED_3D_MIN_ZOOM = 12.75;
export const LOCALIZED_3D_ZOOM_BOOST = 2.25;

const LINE_FOCUS_METERS = 120;
const POINT_FOCUS_METERS = 180;

export function localized3DZoom(baseZoom: number, maxZoom: number): number {
  return Math.min(maxZoom, baseZoom + LOCALIZED_3D_ZOOM_BOOST);
}

/** Keep the focused area above the bottom chat without hard-coding one screen size. */
export function localized3DOffset(viewportHeight: number): [number, number] {
  const upwardPixels = Math.round(
    Math.min(210, Math.max(110, viewportHeight * 0.2)),
  );
  return [0, -upwardPixels];
}

type FocusGeometry =
  | GeoJSON.Point
  | GeoJSON.LineString
  | GeoJSON.Polygon;

export interface Agent3DFocusTarget {
  id: string;
  geometry: FocusGeometry;
  radiusMeters: number;
}

export type Agent3DFocus =
  | {
      source: "drawings" | "markers" | "camera" | "bounds";
      targets: Agent3DFocusTarget[];
    }
  | {
      source: "highlights";
      neighbourhoodIds: string[];
    };

interface FocusContext {
  candidateMarkers: Array<{
    candidateId: string;
    coordinates: [number, number];
    rank: number;
  }>;
}

function closedPolygon(
  coordinates: [number, number][],
): GeoJSON.Polygon {
  const ring = [...coordinates];
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) {
    ring.push(first);
  }
  return { type: "Polygon", coordinates: [ring] };
}

function boundsPolygon(
  bounds: [number, number, number, number],
): GeoJSON.Polygon {
  const [west, south, east, north] = bounds;
  return {
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
  };
}

/**
 * Choose the most specific geographic focus emitted in one agent action batch.
 * Existing MapAction contracts stay unchanged; localized 3D is a presentation
 * behavior owned by the map rather than another domain-opinionated agent tool.
 */
export function deriveAgent3DFocus(
  actions: MapAction[],
  context: FocusContext,
): Agent3DFocus | undefined {
  const areaDrawings: Agent3DFocusTarget[] = [];
  for (const action of actions) {
    if (action.type === "draw_polygon") {
      areaDrawings.push({
        id: action.id,
        geometry: closedPolygon(action.coordinates),
        radiusMeters: 0,
      });
    } else if (action.type === "draw_line") {
      areaDrawings.push({
        id: action.id,
        geometry: { type: "LineString", coordinates: action.coordinates },
        radiusMeters: LINE_FOCUS_METERS,
      });
    }
  }
  if (areaDrawings.length > 0) {
    return { source: "drawings", targets: areaDrawings };
  }

  const neighbourhoodAction = actions.findLast(
    (action) => action.type === "highlight_neighbourhoods",
  );
  if (neighbourhoodAction?.type === "highlight_neighbourhoods") {
    return {
      source: "highlights",
      neighbourhoodIds: neighbourhoodAction.neighbourhoodIds,
    };
  }

  const candidatesFromBatch = actions.findLast(
    (action) => action.type === "show_candidate_markers",
  );
  const candidates =
    candidatesFromBatch?.type === "show_candidate_markers"
      ? candidatesFromBatch.candidates
      : context.candidateMarkers;
  const selectedCandidate = actions.findLast(
    (action) => action.type === "select_candidate",
  );
  if (selectedCandidate?.type === "select_candidate") {
    const marker = candidates.find(
      (candidate) => candidate.candidateId === selectedCandidate.candidateId,
    );
    if (marker) {
      return {
        source: "markers",
        targets: [
          {
            id: marker.candidateId,
            geometry: { type: "Point", coordinates: marker.coordinates },
            radiusMeters: POINT_FOCUS_METERS,
          },
        ],
      };
    }
  }

  const pointDrawings = actions
    .filter((action) => action.type === "draw_point")
    .map((action) => ({
      id: action.id,
      geometry: {
        type: "Point" as const,
        coordinates: action.coordinates,
      },
      radiusMeters: POINT_FOCUS_METERS,
    }));
  if (pointDrawings.length > 0) {
    return { source: "drawings", targets: pointDrawings };
  }

  if (candidatesFromBatch?.type === "show_candidate_markers") {
    const best = [...candidatesFromBatch.candidates].sort(
      (a, b) => a.rank - b.rank,
    )[0];
    if (best) {
      return {
        source: "markers",
        targets: [
          {
            id: best.candidateId,
            geometry: { type: "Point", coordinates: best.coordinates },
            radiusMeters: POINT_FOCUS_METERS,
          },
        ],
      };
    }
  }

  const flyAction = actions.findLast(
    (action) => action.type === "fly_to_center",
  );
  if (flyAction?.type === "fly_to_center") {
    return {
      source: "camera",
      targets: [
        {
          id: "agent-camera-center",
          geometry: { type: "Point", coordinates: flyAction.center },
          radiusMeters: POINT_FOCUS_METERS,
        },
      ],
    };
  }

  const boundsAction = actions.findLast(
    (action) => action.type === "fit_bounds",
  );
  if (boundsAction?.type === "fit_bounds") {
    return {
      source: "bounds",
      targets: [
        {
          id: "agent-camera-bounds",
          geometry: boundsPolygon(boundsAction.bounds),
          radiusMeters: 0,
        },
      ],
    };
  }

  return undefined;
}

const NO_BUILDINGS_FILTER = [
  "==",
  ["get", "__techto_never_3d__"],
  true,
] as FilterSpecification;

/** Build a vector-tile filter that extrudes only the current agent focus. */
export function localizedBuildingFilter(
  focus: Agent3DFocus | null,
  neighbourhoods: GeoJSON.FeatureCollection,
): FilterSpecification {
  if (!focus) return NO_BUILDINGS_FILTER;

  const distanceFilters: unknown[] = [];
  if (focus.source === "highlights") {
    const ids = new Set(focus.neighbourhoodIds);
    const features = neighbourhoods.features
      .filter((feature) => ids.has(String(feature.properties?.code ?? "")))
      .filter(
        (feature) =>
          feature.geometry.type === "Polygon" ||
          feature.geometry.type === "MultiPolygon",
      )
      .map((feature) => ({
        type: "Feature" as const,
        properties: {},
        geometry: feature.geometry,
      }));
    if (features.length > 0) {
      distanceFilters.push([
        "<=",
        ["distance", { type: "FeatureCollection", features }],
        0,
      ]);
    }
  } else {
    for (const target of focus.targets) {
      distanceFilters.push([
        "<=",
        ["distance", target.geometry],
        target.radiusMeters,
      ]);
    }
  }

  if (distanceFilters.length === 0) return NO_BUILDINGS_FILTER;
  return [
    "all",
    ["!=", ["coalesce", ["get", "hide_3d"], false], true],
    distanceFilters.length === 1
      ? distanceFilters[0]
      : ["any", ...distanceFilters],
  ] as FilterSpecification;
}

export const BUILDING_HEIGHT_EXPRESSION = [
  "max",
  3,
  ["to-number", ["get", "render_height"], 10],
] as ExpressionSpecification;

export const BUILDING_BASE_EXPRESSION = [
  "max",
  0,
  ["to-number", ["get", "render_min_height"], 0],
] as ExpressionSpecification;

const BUILDING_COLOR_EXPRESSION = [
  "step",
  ["to-number", ["get", "render_height"], 10],
  "#182226",
  8,
  "#1e2b30",
  20,
  "#26373d",
  45,
  "#2e454c",
  90,
  "#38545c",
] as ExpressionSpecification;

export function localizedBuildingLayer(
  filter: FilterSpecification = NO_BUILDINGS_FILTER,
): LayerSpecification {
  return {
    id: LOCALIZED_BUILDINGS_3D_LAYER,
    type: "fill-extrusion",
    source: "carto",
    "source-layer": "building",
    minzoom: LOCALIZED_3D_MIN_ZOOM,
    filter,
    paint: {
      "fill-extrusion-color": BUILDING_COLOR_EXPRESSION,
      "fill-extrusion-height": BUILDING_HEIGHT_EXPRESSION,
      "fill-extrusion-base": BUILDING_BASE_EXPRESSION,
      "fill-extrusion-opacity": 0.95,
      "fill-extrusion-vertical-gradient": true,
    },
  };
}
