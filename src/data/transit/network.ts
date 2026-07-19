/**
 * Synthetic Toronto TTC network fixture for the TechTO transit domain layer.
 *
 * Station names, route names, and approximate downtown positions are drawn
 * from real TTC geography for narrative plausibility, but every operational
 * figure here (vehicle capacity, headway, entrance flags) is a synthetic
 * assumption chosen for this demo. This is NOT a live GTFS feed and NOT a
 * measured TTC capacity table; see AGENTS.md section 2 and
 * docs/techto-implementation.md section 8.1 for the offline-first,
 * fixture-first rule this file follows.
 */

export type TransitMode = "subway" | "streetcar" | "bus";

export interface TransitStationFixture {
  id: string;
  name: string;
  lat: number;
  lng: number;
  /** Whether the station fixture has at least one elevator to the platform. */
  hasElevator: boolean;
  /** Whether a second, independently operable accessible entrance exists (used for entrance-closure accessibility checks). */
  alternateAccessibleEntrance: boolean;
}

export interface TransitStopFixture {
  id: string;
  routeId: string;
  name: string;
  lat: number;
  lng: number;
  /** Position of this stop along its route, starting at 0. */
  sequence: number;
  /** Set when this stop sits at (or immediately outside) a subway station, for transfer modeling. */
  stationId?: string;
}

export interface TransitRouteFixture {
  id: string;
  name: string;
  mode: TransitMode;
  color: string;
  stopIds: string[];
  vehicleCapacity: number;
  /** Nominal peak headway in minutes, before any scenario intervention. */
  headwayMinutes: number;
}

export interface NetworkSnapshot {
  dataMode: "synthetic-fixture";
  /** Fixed for reproducibility; this snapshot does not change between runs. */
  generatedAt: string;
  stations: TransitStationFixture[];
  routes: TransitRouteFixture[];
  stops: TransitStopFixture[];
}

const LINE_1_STATIONS: TransitStationFixture[] = [
  { id: "union", name: "Union", lat: 43.6453, lng: -79.3806, hasElevator: true, alternateAccessibleEntrance: true },
  { id: "king", name: "King", lat: 43.6488, lng: -79.3788, hasElevator: true, alternateAccessibleEntrance: false },
  {
    id: "st-andrew",
    name: "St Andrew",
    lat: 43.6484,
    lng: -79.3839,
    hasElevator: true,
    alternateAccessibleEntrance: false,
  },
  {
    id: "osgoode",
    name: "Osgoode",
    lat: 43.6507,
    lng: -79.3865,
    hasElevator: true,
    alternateAccessibleEntrance: false,
  },
  {
    id: "st-patrick",
    name: "St Patrick",
    lat: 43.6547,
    lng: -79.3891,
    hasElevator: false,
    alternateAccessibleEntrance: false,
  },
  {
    id: "queens-park",
    name: "Queen's Park",
    lat: 43.6599,
    lng: -79.3915,
    hasElevator: true,
    alternateAccessibleEntrance: false,
  },
  {
    id: "museum",
    name: "Museum",
    lat: 43.6677,
    lng: -79.3948,
    hasElevator: true,
    alternateAccessibleEntrance: false,
  },
  {
    id: "st-george",
    name: "St George",
    lat: 43.6686,
    lng: -79.3997,
    hasElevator: true,
    alternateAccessibleEntrance: true,
  },
];

const LINE_1_STOPS: TransitStopFixture[] = LINE_1_STATIONS.map((station, index) => ({
  id: `line-1-${station.id}`,
  routeId: "line-1",
  name: station.name,
  lat: station.lat,
  lng: station.lng,
  sequence: index,
  stationId: station.id,
}));

const STREETCAR_501_STOPS: TransitStopFixture[] = [
  { id: "queen-yonge", routeId: "streetcar-501", name: "Queen & Yonge", lat: 43.6547, lng: -79.3789, sequence: 0 },
  {
    id: "queen-university",
    routeId: "streetcar-501",
    name: "Queen & University",
    lat: 43.6521,
    lng: -79.3853,
    sequence: 1,
    stationId: "osgoode",
  },
  {
    id: "queen-spadina",
    routeId: "streetcar-501",
    name: "Queen & Spadina",
    lat: 43.6489,
    lng: -79.3963,
    sequence: 2,
  },
  {
    id: "queen-bathurst",
    routeId: "streetcar-501",
    name: "Queen & Bathurst",
    lat: 43.6473,
    lng: -79.4059,
    sequence: 3,
  },
];

const BUS_FEEDER_STOPS: TransitStopFixture[] = [
  {
    id: "cityplace-park",
    routeId: "bus-6a",
    name: "CityPlace Park",
    lat: 43.6398,
    lng: -79.3931,
    sequence: 0,
  },
  {
    id: "bremner-fort-york",
    routeId: "bus-6a",
    name: "Bremner & Fort York",
    lat: 43.6417,
    lng: -79.3878,
    sequence: 1,
  },
  {
    id: "union-bus-terminal",
    routeId: "bus-6a",
    name: "Union Station Bus Terminal",
    lat: 43.6453,
    lng: -79.3806,
    sequence: 2,
    stationId: "union",
  },
];

const ROUTES: TransitRouteFixture[] = [
  {
    id: "line-1",
    name: "Line 1 Yonge-University (downtown segment)",
    mode: "subway",
    color: "#F8A200",
    stopIds: LINE_1_STOPS.map((stop) => stop.id),
    vehicleCapacity: 800,
    headwayMinutes: 6,
  },
  {
    id: "streetcar-501",
    name: "501 Queen",
    mode: "streetcar",
    color: "#C81E3A",
    stopIds: STREETCAR_501_STOPS.map((stop) => stop.id),
    vehicleCapacity: 130,
    headwayMinutes: 8,
  },
  {
    id: "bus-6a",
    name: "6A Union Station Connector",
    mode: "bus",
    color: "#2E7D32",
    stopIds: BUS_FEEDER_STOPS.map((stop) => stop.id),
    vehicleCapacity: 60,
    headwayMinutes: 10,
  },
];

export const TORONTO_NETWORK: NetworkSnapshot = {
  dataMode: "synthetic-fixture",
  generatedAt: "2026-07-18T00:00:00.000Z",
  stations: LINE_1_STATIONS,
  routes: ROUTES,
  stops: [...LINE_1_STOPS, ...STREETCAR_501_STOPS, ...BUS_FEEDER_STOPS],
};

export function getNetworkSnapshot(): NetworkSnapshot {
  return TORONTO_NETWORK;
}

export function listStations(): TransitStationFixture[] {
  return TORONTO_NETWORK.stations;
}

export function getStation(stationId: string): TransitStationFixture | undefined {
  return TORONTO_NETWORK.stations.find((station) => station.id === stationId);
}

export function requireStation(stationId: string): TransitStationFixture {
  const station = getStation(stationId);
  if (!station) {
    throw new Error(`Unknown transit station id: "${stationId}"`);
  }
  return station;
}

export function listRoutes(): TransitRouteFixture[] {
  return TORONTO_NETWORK.routes;
}

export function getRoute(routeId: string): TransitRouteFixture | undefined {
  return TORONTO_NETWORK.routes.find((route) => route.id === routeId);
}

export function requireRoute(routeId: string): TransitRouteFixture {
  const route = getRoute(routeId);
  if (!route) {
    throw new Error(`Unknown transit route id: "${routeId}"`);
  }
  return route;
}

export function listStops(routeId?: string): TransitStopFixture[] {
  if (!routeId) {
    return TORONTO_NETWORK.stops;
  }
  return TORONTO_NETWORK.stops.filter((stop) => stop.routeId === routeId);
}

export function getStop(stopId: string): TransitStopFixture | undefined {
  return TORONTO_NETWORK.stops.find((stop) => stop.id === stopId);
}

export function getVehicleCapacity(routeId: string): number {
  return requireRoute(routeId).vehicleCapacity;
}
