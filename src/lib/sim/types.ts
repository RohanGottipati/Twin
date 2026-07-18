import type { LngLat, PolygonGeometry } from "@/lib/geo";

export interface NeighbourhoodProps {
  code: string;
  name: string;
  /** 2021 Census population (StatCan via open.toronto.ca neighbourhood-profiles). */
  population: number;
  /** Median 2020 household income, dollars. */
  income: number | null;
}

export interface NeighbourhoodFeature {
  type: "Feature";
  id: number;
  properties: NeighbourhoodProps;
  geometry: PolygonGeometry;
}

export interface NeighbourhoodCollection {
  type: "FeatureCollection";
  features: NeighbourhoodFeature[];
}

export interface RouteProps {
  route: string;
  name: string;
  mode: "subway" | "lrt" | "streetcar" | "bus";
  gtfs_color: string;
}

export interface RouteFeature {
  type: "Feature";
  properties: RouteProps;
  geometry: { type: "LineString"; coordinates: LngLat[] };
}

export interface RouteCollection {
  type: "FeatureCollection";
  features: RouteFeature[];
}

export interface StreetFeature {
  type: "Feature";
  properties: Record<string, never>;
  geometry: { type: "LineString"; coordinates: LngLat[] };
}

/** Toronto Centreline links (streets, lanes, trails), citywide. */
export interface StreetCollection {
  type: "FeatureCollection";
  features: StreetFeature[];
}

/**
 * One synthetic resident. Each persona stands in for ~PERSONS_PER_DOT real
 * residents of its neighbourhood; home locations are sampled inside the real
 * neighbourhood polygon, weighted by census population.
 */
export interface Persona {
  id: number;
  lng: number;
  lat: number;
  /** Neighbourhood code (zero-padded, matches AREA_SHORT_CODE). */
  code: string;
  /** Standardized neighbourhood median-income score, roughly [-2, 2]. */
  incomeZ: number;
  /** Propensity to ride transit, [0, 1]. */
  transitAffinity: number;
  /** Reliance on driving, [0, 1]. */
  carDependence: number;
}

export interface NeighbourhoodAggregate {
  mean: number;
  count: number;
}

export interface ScenarioResult {
  scenarioId: string;
  /** Per-persona acceptance in [0, 1]; index matches Persona.id. */
  acceptance: Float32Array;
  /** Distance (km) from each persona to the scenario focus, for the reveal sweep. */
  sweepKm: Float32Array;
  byNeighbourhood: Map<string, NeighbourhoodAggregate>;
  /** HISTOGRAM_BINS counts over [0, 1]. */
  histogram: number[];
  supportShare: number;
  opposeShare: number;
  mean: number;
}

export const HISTOGRAM_BINS = 22;
export const SUPPORT_THRESHOLD = 0.55;
export const OPPOSE_THRESHOLD = 0.45;
