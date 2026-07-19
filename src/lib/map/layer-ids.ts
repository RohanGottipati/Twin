export const LAYER_IDS = {
  routes: "techto-transit-routes",
  stops: "techto-transit-stops",
  stations: "techto-stations",
  vehicles: "techto-vehicles",
  density: "techto-citizen-density",
  crowd: "techto-crowd-heat",
  events: "techto-events",
  neighbourhoods: "techto-neighbourhood-highlights",
  candidates: "techto-candidate-markers",
  interventionDiff: "techto-intervention-diff",
} as const;

export const SOURCE_IDS = {
  routes: "techto-routes-src",
  stops: "techto-stops-src",
  stations: "techto-stations-src",
  vehicles: "techto-vehicles-src",
  density: "techto-density-src",
  crowd: "techto-crowd-src",
  events: "techto-events-src",
  neighbourhoods: "techto-neighbourhoods-src",
  candidates: "techto-candidates-src",
  interventionDiff: "techto-diff-src",
} as const;
