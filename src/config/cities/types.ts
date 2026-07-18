export type CameraPreset = {
  longitude: number;
  latitude: number;
  height: number;
  heading: number;
  pitch: number;
  roll?: number;
  duration?: number;
};

export type CityBounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};

export type CityConfig = {
  id: string;
  name: string;
  region: string;
  country: string;
  coordinates: {
    longitude: number;
    latitude: number;
  };
  bounds: CityBounds;
  cameras: {
    overview: CameraPreset;
    city: CameraPreset;
    close: CameraPreset;
  };
  marker: {
    label: string;
  };
  enabled: boolean;
};
