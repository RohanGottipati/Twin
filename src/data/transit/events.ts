/**
 * Synthetic event, weather, and service-incident fixtures for the TechTO
 * transit domain layer. These back the "extenuating circumstances" stress
 * test in docs/techto-implementation.md section 2.5 and the
 * get_event_context / get_weather_context / get_service_incidents tools in
 * section 13.6. Nothing here is a live feed; all figures are synthetic
 * assumptions chosen for narrative plausibility in the demo.
 */

export interface ConcertEventFixture {
  id: string;
  venue: string;
  title: string;
  type: "concert";
  nearestStationId: string;
  startTime: string;
  endTime: string;
  expectedAttendance: number;
  /** Matches the arrivalSurgeMultiplier on the concert-surge stress overlay in ./scenarios.ts. */
  surgeMultiplier: number;
  description: string;
  dataMode: "synthetic-fixture";
}

export interface WeatherEventFixture {
  id: string;
  condition: "heavy_rain" | "snow" | "extreme_heat" | "clear";
  precipitationMmPerHour: number;
  temperatureC: number;
  /** Riders tolerate less walking to a stop or alternate entrance in this weather; multiplies walking tolerance. */
  walkingToleranceMultiplier: number;
  /** Riders tolerate more waiting under shelter than in the open in this weather; multiplies wait tolerance. */
  waitToleranceMultiplier: number;
  description: string;
  dataMode: "synthetic-fixture";
}

export interface ServiceIncidentFixture {
  id: string;
  routeId: string;
  type: "signal_problem" | "mechanical" | "medical_emergency" | "power_outage";
  delayMinutes: number;
  affectedStationIds: string[];
  description: string;
  dataMode: "synthetic-fixture";
}

export const CONCERT_EVENT: ConcertEventFixture = {
  id: "scotiabank-arena-concert-2026-07-18",
  venue: "Scotiabank Arena",
  title: "Evening concert release",
  type: "concert",
  nearestStationId: "union",
  startTime: "2026-07-18T19:00:00-04:00",
  endTime: "2026-07-18T22:30:00-04:00",
  expectedAttendance: 19800,
  surgeMultiplier: 1.25,
  description:
    "A sold-out evening concert at Scotiabank Arena releases a large crowd toward Union station within a short " +
    "window, the demo's flagship extenuating-circumstances test.",
  dataMode: "synthetic-fixture",
};

export const WEATHER_EVENT: WeatherEventFixture = {
  id: "weather-heavy-rain-2026-07-18",
  condition: "heavy_rain",
  precipitationMmPerHour: 12,
  temperatureC: 19,
  walkingToleranceMultiplier: 0.6,
  waitToleranceMultiplier: 1.3,
  description:
    "Heavy rain across downtown Toronto. Riders are less willing to walk to an alternate entrance or stop, and " +
    "more willing to wait under cover for the next vehicle rather than walk.",
  dataMode: "synthetic-fixture",
};

export const SERVICE_INCIDENTS: ServiceIncidentFixture[] = [
  {
    id: "service-incident-line-1-signal",
    routeId: "line-1",
    type: "signal_problem",
    delayMinutes: 5,
    affectedStationIds: ["union", "king", "st-andrew", "osgoode"],
    description: "A signal problem south of St George slows Line 1 service through the downtown segment.",
    dataMode: "synthetic-fixture",
  },
  {
    id: "service-incident-streetcar-501-mechanical",
    routeId: "streetcar-501",
    type: "mechanical",
    delayMinutes: 8,
    affectedStationIds: [],
    description: "A disabled streetcar on 501 Queen blocks the tracks near Spadina, delaying following cars.",
    dataMode: "synthetic-fixture",
  },
];

export interface EventContextBundle {
  concert: ConcertEventFixture;
  weather: WeatherEventFixture;
  incidents: ServiceIncidentFixture[];
}

export function getConcertEvent(): ConcertEventFixture {
  return CONCERT_EVENT;
}

export function getWeatherEvent(): WeatherEventFixture {
  return WEATHER_EVENT;
}

export function getServiceIncidents(): ServiceIncidentFixture[] {
  return SERVICE_INCIDENTS;
}

export function getServiceIncident(incidentId: string): ServiceIncidentFixture | undefined {
  return SERVICE_INCIDENTS.find((incident) => incident.id === incidentId);
}

export function getEventContext(): EventContextBundle {
  return {
    concert: getConcertEvent(),
    weather: getWeatherEvent(),
    incidents: getServiceIncidents(),
  };
}
