import type { CesiumModule, SceneRefs } from "./types";

export function cleanupScene(
  _Cesium: CesiumModule,
  refs: SceneRefs
): void {
  // Restore the selected feature color when possible.
  if (refs.selectedFeature && refs.selectedFeatureOriginalColor) {
    try {
      refs.selectedFeature.color = (
        refs.selectedFeatureOriginalColor as InstanceType<
          CesiumModule["Color"]
        >
      ).clone();
    } catch {
      // Feature may already be gone; ignore.
    }
  }
  refs.selectedFeature = null;
  refs.selectedFeatureOriginalColor = null;

  if (refs.selectionHandler) {
    try {
      if (!refs.selectionHandler.isDestroyed()) {
        refs.selectionHandler.destroy();
      }
    } catch {
      // ignore
    }
    refs.selectionHandler = null;
  }

  if (refs.viewer) {
    try {
      refs.viewer.camera.cancelFlight();
    } catch {
      // ignore
    }
    try {
      if (!refs.viewer.isDestroyed()) {
        refs.viewer.destroy();
      }
    } catch {
      // ignore
    }
    refs.viewer = null;
  }

  refs.buildingTileset = null;
  refs.markerEntities = [];
}
