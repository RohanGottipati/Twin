import type { Cesium3DTileset, Viewer } from "cesium";
import type { CesiumModule } from "./types";

export type CreateBuildingLayerOptions = {
  Cesium: CesiumModule;
  viewer: Viewer;
};

export async function createBuildingLayer({
  Cesium,
  viewer,
}: CreateBuildingLayerOptions): Promise<Cesium3DTileset> {
  const tileset = await Cesium.createOsmBuildingsAsync();

  // Reasonable performance/quality balance for city viewing.
  tileset.maximumScreenSpaceError = 16;
  // Hidden initially; only shown in city modes when buildings are enabled.
  tileset.show = false;

  viewer.scene.primitives.add(tileset);

  return tileset;
}

export function setBuildingsVisible(
  tileset: Cesium3DTileset | null,
  visible: boolean
): void {
  if (tileset) {
    tileset.show = visible;
  }
}
