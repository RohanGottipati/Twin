export const LAYER_IDS = {
  routes: "twinto-transit-routes",
  stops: "twinto-transit-stops",
  stations: "twinto-stations",
  vehicles: "twinto-vehicles",
  density: "twinto-citizen-density",
  crowd: "twinto-crowd-heat",
  events: "twinto-events",
  neighbourhoods: "twinto-neighbourhood-highlights",
  candidates: "twinto-candidate-markers",
  interventionDiff: "twinto-intervention-diff",
} as const;

export const SOURCE_IDS = {
  routes: "twinto-routes-src",
  stops: "twinto-stops-src",
  stations: "twinto-stations-src",
  vehicles: "twinto-vehicles-src",
  density: "twinto-density-src",
  crowd: "twinto-crowd-src",
  events: "twinto-events-src",
  neighbourhoods: "twinto-neighbourhoods-src",
  candidates: "twinto-candidates-src",
  interventionDiff: "twinto-diff-src",
} as const;
