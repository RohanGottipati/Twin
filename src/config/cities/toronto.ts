import type { CityConfig } from "./types";

export const torontoConfig: CityConfig = {
  id: "toronto",
  name: "Toronto",
  region: "Ontario",
  country: "Canada",
  coordinates: {
    longitude: -79.3832,
    latitude: 43.6532,
  },
  bounds: {
    west: -79.64,
    south: 43.58,
    east: -79.11,
    north: 43.86,
  },
  cameras: {
    overview: {
      longitude: -79.3832,
      latitude: 43.6532,
      height: 14000,
      heading: 0,
      pitch: -65,
      roll: 0,
      duration: 2.8,
    },
    city: {
      longitude: -79.3832,
      latitude: 43.6475,
      height: 2600,
      heading: 0,
      pitch: -35,
      roll: 0,
      duration: 2.8,
    },
    close: {
      longitude: -79.3832,
      latitude: 43.6505,
      height: 700,
      heading: 0,
      pitch: -20,
      roll: 0,
      duration: 2.2,
    },
  },
  marker: {
    label: "Toronto",
  },
  enabled: true,
};
