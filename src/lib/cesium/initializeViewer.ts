import type { Viewer } from "cesium";
import type { CesiumModule } from "./types";

export type InitializeViewerOptions = {
  Cesium: CesiumModule;
  container: HTMLElement;
  token: string;
};

export function isWebGLAvailable(): boolean {
  if (typeof document === "undefined") {
    return false;
  }
  try {
    const canvas = document.createElement("canvas");
    const context =
      canvas.getContext("webgl2") ||
      canvas.getContext("webgl") ||
      canvas.getContext("experimental-webgl");
    return Boolean(context);
  } catch {
    return false;
  }
}

export function initializeViewer({
  Cesium,
  container,
  token,
}: InitializeViewerOptions): Viewer {
  if (!container) {
    throw new Error("A valid container element is required.");
  }

  if (!token || token.trim().length === 0) {
    throw new Error("A Cesium ion access token is required.");
  }

  Cesium.Ion.defaultAccessToken = token;

  const viewer = new Cesium.Viewer(container, {
    terrain: Cesium.Terrain.fromWorldTerrain(),
    animation: false,
    timeline: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    baseLayerPicker: false,
    navigationHelpButton: false,
    fullscreenButton: false,
    selectionIndicator: false,
    infoBox: false,
    shouldAnimate: true,
  });

  // Keep the Cesium attribution/credit display visible at all times.
  const scene = viewer.scene;
  scene.globe.depthTestAgainstTerrain = true;
  scene.fog.enabled = true;
  scene.highDynamicRange = true;
  scene.skyAtmosphere.show = true;
  scene.globe.showGroundAtmosphere = true;
  scene.globe.enableLighting = false;

  viewer.resolutionScale = Math.min(
    window.devicePixelRatio || 1,
    window.innerWidth < 768 ? 1 : 1.5
  );

  // Reasonable default so the globe is not overly aggressive on refinement.
  scene.globe.maximumScreenSpaceError = 2;

  return viewer;
}
