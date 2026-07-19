import { listNeighbourhoods, type NeighbourhoodFixture } from "@/data/transit/neighbourhoods";
import { listStations, type TransitStationFixture } from "@/data/transit/network";

/** A map feature the user selected for place-scoped chat. */
export interface SelectedMapPlace {
  kind: "building" | "station" | "neighbourhood";
  id: string;
  label: string;
  coordinates: [number, number];
  stationId: string | null;
  neighbourhoodId: string | null;
  /** Raw MapLibre / OpenMapTiles properties when kind is building. */
  properties?: Record<string, unknown>;
}

function haversineKm(a: [number, number], b: [number, number]): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

export function nearestStation(coordinates: [number, number]): TransitStationFixture | null {
  const stations = listStations();
  if (stations.length === 0) return null;
  let best = stations[0];
  let bestKm = haversineKm(coordinates, [best.lng, best.lat]);
  for (let i = 1; i < stations.length; i += 1) {
    const station = stations[i];
    const km = haversineKm(coordinates, [station.lng, station.lat]);
    if (km < bestKm) {
      best = station;
      bestKm = km;
    }
  }
  return best;
}

export function nearestNeighbourhood(coordinates: [number, number]): NeighbourhoodFixture | null {
  const neighbourhoods = listNeighbourhoods();
  if (neighbourhoods.length === 0) return null;
  let best = neighbourhoods[0];
  let bestKm = haversineKm(coordinates, best.center);
  for (let i = 1; i < neighbourhoods.length; i += 1) {
    const neighbourhood = neighbourhoods[i];
    const km = haversineKm(coordinates, neighbourhood.center);
    if (km < bestKm) {
      best = neighbourhood;
      bestKm = km;
    }
  }
  return best;
}

export function placeFromStation(stationId: string): SelectedMapPlace | null {
  const station = listStations().find((entry) => entry.id === stationId);
  if (!station) return null;
  const coordinates: [number, number] = [station.lng, station.lat];
  const neighbourhood = nearestNeighbourhood(coordinates);
  return {
    kind: "station",
    id: `station:${station.id}`,
    label: station.name,
    coordinates,
    stationId: station.id,
    neighbourhoodId: neighbourhood?.id ?? null,
  };
}

export function placeFromBuildingFeature(input: {
  featureId: string | number | undefined;
  coordinates: [number, number];
  properties?: Record<string, unknown> | null;
}): SelectedMapPlace {
  const station = nearestStation(input.coordinates);
  const neighbourhood = nearestNeighbourhood(input.coordinates);
  const props = input.properties ?? {};
  const nameCandidate =
    (typeof props.name === "string" && props.name) ||
    (typeof props["name:en"] === "string" && props["name:en"]) ||
    null;
  const label =
    nameCandidate ??
    (neighbourhood ? `${neighbourhood.name} building` : "Selected building");
  const idSuffix =
    input.featureId !== undefined && input.featureId !== null
      ? String(input.featureId)
      : `${input.coordinates[0].toFixed(5)},${input.coordinates[1].toFixed(5)}`;
  return {
    kind: "building",
    id: `building:${idSuffix}`,
    label,
    coordinates: input.coordinates,
    stationId: station?.id ?? null,
    neighbourhoodId: neighbourhood?.id ?? null,
    properties: props,
  };
}

/** Neighbourhood click on the TechTO dashboard map. */
export function placeFromNeighbourhoodArea(input: {
  code: string;
  name: string;
  coordinates: [number, number];
}): SelectedMapPlace {
  const station = nearestStation(input.coordinates);
  const neighbourhood = nearestNeighbourhood(input.coordinates);
  return {
    kind: "neighbourhood",
    id: `neighbourhood:${input.code}`,
    label: input.name,
    coordinates: input.coordinates,
    stationId: station?.id ?? null,
    neighbourhoodId: neighbourhood?.id ?? null,
    properties: { code: input.code, name: input.name },
  };
}

/** Polygon centroid for MapLibre building footprints (ring average). */
export function polygonCentroid(geometry: GeoJSON.Geometry): [number, number] | null {
  if (geometry.type === "Point") {
    return [geometry.coordinates[0], geometry.coordinates[1]];
  }
  let ring: number[][] | null = null;
  if (geometry.type === "Polygon") ring = geometry.coordinates[0] ?? null;
  if (geometry.type === "MultiPolygon") ring = geometry.coordinates[0]?.[0] ?? null;
  if (!ring || ring.length === 0) return null;
  let lng = 0;
  let lat = 0;
  let n = 0;
  for (const coord of ring) {
    if (coord.length < 2) continue;
    lng += coord[0];
    lat += coord[1];
    n += 1;
  }
  if (n === 0) return null;
  return [lng / n, lat / n];
}
