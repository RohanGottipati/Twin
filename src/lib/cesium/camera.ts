import type { Viewer } from "cesium";
import type { CameraPreset, CityConfig } from "@/config/cities/types";
import type { CesiumModule } from "./types";

export const WORLD_CAMERA: CameraPreset = {
  longitude: -35,
  latitude: 27,
  height: 20000000,
  heading: 0,
  pitch: -90,
  roll: 0,
};

type FlyCallbacks = {
  onComplete?: () => void;
  onCancel?: () => void;
};

function orientation(Cesium: CesiumModule, preset: CameraPreset) {
  return {
    heading: Cesium.Math.toRadians(preset.heading),
    pitch: Cesium.Math.toRadians(preset.pitch),
    roll: Cesium.Math.toRadians(preset.roll ?? 0),
  };
}

function resolveDuration(
  preset: CameraPreset,
  reducedMotion: boolean
): number {
  if (reducedMotion) {
    return 0;
  }
  return preset.duration ?? 2.5;
}

export function setWorldView(
  Cesium: CesiumModule,
  viewer: Viewer
): void {
  viewer.camera.cancelFlight();
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(
      WORLD_CAMERA.longitude,
      WORLD_CAMERA.latitude,
      WORLD_CAMERA.height
    ),
    orientation: orientation(Cesium, WORLD_CAMERA),
  });
}

export function flyToWorld(
  Cesium: CesiumModule,
  viewer: Viewer,
  reducedMotion: boolean,
  callbacks: FlyCallbacks = {}
): void {
  flyToPreset(Cesium, viewer, WORLD_CAMERA, reducedMotion, {
    duration: reducedMotion ? 0 : 2.8,
    ...callbacks,
  });
}

function flyToPreset(
  Cesium: CesiumModule,
  viewer: Viewer,
  preset: CameraPreset,
  reducedMotion: boolean,
  callbacks: FlyCallbacks & { duration?: number } = {}
): void {
  viewer.camera.cancelFlight();
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(
      preset.longitude,
      preset.latitude,
      preset.height
    ),
    orientation: orientation(Cesium, preset),
    duration: callbacks.duration ?? resolveDuration(preset, reducedMotion),
    complete: callbacks.onComplete,
    cancel: callbacks.onCancel,
  });
}

export function flyToCityOverview(
  Cesium: CesiumModule,
  viewer: Viewer,
  city: CityConfig,
  reducedMotion: boolean,
  callbacks: FlyCallbacks = {}
): void {
  flyToPreset(Cesium, viewer, city.cameras.overview, reducedMotion, callbacks);
}

export function flyToCity(
  Cesium: CesiumModule,
  viewer: Viewer,
  city: CityConfig,
  reducedMotion: boolean,
  callbacks: FlyCallbacks = {}
): void {
  flyToPreset(Cesium, viewer, city.cameras.city, reducedMotion, callbacks);
}

export function flyToCityClose(
  Cesium: CesiumModule,
  viewer: Viewer,
  city: CityConfig,
  reducedMotion: boolean,
  callbacks: FlyCallbacks = {}
): void {
  flyToPreset(Cesium, viewer, city.cameras.close, reducedMotion, callbacks);
}

export function resetCurrentView(
  Cesium: CesiumModule,
  viewer: Viewer,
  preset: CameraPreset,
  reducedMotion: boolean,
  callbacks: FlyCallbacks = {}
): void {
  flyToPreset(Cesium, viewer, preset, reducedMotion, callbacks);
}

export function resetNorth(
  _Cesium: CesiumModule,
  viewer: Viewer,
  reducedMotion: boolean
): void {
  const camera = viewer.camera;
  camera.cancelFlight();
  camera.flyTo({
    destination: camera.positionWC.clone(),
    orientation: {
      heading: 0,
      pitch: camera.pitch,
      roll: 0,
    },
    duration: reducedMotion ? 0 : 0.8,
  });
}

export function zoomIn(viewer: Viewer): void {
  const height = viewer.camera.positionCartographic.height;
  viewer.camera.zoomIn(height * 0.35);
}

export function zoomOut(viewer: Viewer): void {
  const height = viewer.camera.positionCartographic.height;
  viewer.camera.zoomOut(height * 0.5);
}
