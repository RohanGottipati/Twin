/**
 * TwinTO operates only inside the City of Toronto. Every agent, map action,
 * chat assumption, and fixture load must stay within this scope. Outside
 * coordinates and non-Toronto cities are rejected.
 */

export const TWINTO_CITY_ID = "toronto" as const;

export const TWINTO_CITY_LABEL = "Toronto";

/** Approximate City of Toronto bounding box (WGS84): [west, south, east, north]. */
export const TORONTO_BOUNDS = {
  west: -79.6393,
  south: 43.5810,
  east: -79.1152,
  north: 43.8555,
} as const;

export const TORONTO_SCOPE_SHORT =
  "Toronto only: TwinTO covers the City of Toronto. No other city or region.";

export const TORONTO_SCOPE_AGENT_RULE = `
GEOGRAPHIC SCOPE (hard constraint):
- TwinTO is exclusively a City of Toronto product.
- Only Toronto neighbourhoods, TTC corridors, stops, stations, and policies are in scope.
- Never suggest, compare, or recommend locations, routes, or interventions outside Toronto.
- If a user asks about another city or region, refuse the out-of-scope geography and redirect to Toronto.
- Every map action, candidate coordinate, and station proposal must lie inside Toronto.
`.trim();

export const TORONTO_SCOPE_ASSUMPTIONS = [
  "City of Toronto only (no other municipalities or regions)",
  "TTC-oriented synthetic fixture network inside Toronto",
] as const;

export const TORONTO_SCOPE_LIMITATIONS = [
  "Locations outside Toronto are out of scope and will be rejected",
  "Neighbourhood fixtures are synthetic Toronto demo areas, not official boundaries",
] as const;

export function isInsideToronto(lng: number, lat: number): boolean {
  return (
    lng >= TORONTO_BOUNDS.west &&
    lng <= TORONTO_BOUNDS.east &&
    lat >= TORONTO_BOUNDS.south &&
    lat <= TORONTO_BOUNDS.north
  );
}

export function torontoScopeViolationMessage(lng: number, lat: number): string {
  return `Coordinate [${lng}, ${lat}] is outside the City of Toronto. TwinTO only accepts Toronto locations.`;
}
