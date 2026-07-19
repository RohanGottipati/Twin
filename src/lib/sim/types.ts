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

/**
 * One resident dot. Real personas (from `/api/personas`, backed by
 * MongoDB's `resident_personas` -- StatCan-census-grounded individual
 * records, see `population/generate_and_store_personas.py`) each stand in
 * for one real adult resident, positioned by rejection sampling inside its
 * real neighbourhood polygon (no real home coordinate exists, so placement
 * within the boundary is illustrative, not measured). `incomeZ` is derived
 * from the persona's real household income decile; `transitAffinity` and
 * `carDependence` are derived from its real commute mode. `buildPersonas()`
 * (`@/lib/sim/personas`) is a fully-synthetic fallback used only if the API
 * is unavailable.
 */
export interface Persona {
  id: number;
  lng: number;
  lat: number;
  /** Neighbourhood code (zero-padded, matches AREA_SHORT_CODE). */
  code: string;
  /** Income-decile-derived z-score, roughly [-2, 2]. */
  incomeZ: number;
  /** Propensity to ride transit, [0, 1]. */
  transitAffinity: number;
  /** Reliance on driving, [0, 1]. */
  carDependence: number;
  /**
   * Real fields, present only when this persona came from `/api/personas`
   * (absent for the synthetic `buildPersonas()` fallback). All raw
   * StatCan-census-grounded categorical values -- not derived proxies.
   */
  ageBand?: string;
  gender?: string;
  education?: string;
  tenure?: string;
  commuteMode?: string | null;
  incomeBand?: string;
  /** The persona's LLM-rendered profile description (see population/persona_text.py). */
  profileText?: string;
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
