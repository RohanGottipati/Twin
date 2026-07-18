import type {
  Viewer,
  Cesium3DTileset,
  Cesium3DTileFeature,
  Entity,
  ScreenSpaceEventHandler,
} from "cesium";

export type CesiumModule = typeof import("cesium");

export type CityMarkerEntity = Entity;

export type SceneRefs = {
  viewer: Viewer | null;
  buildingTileset: Cesium3DTileset | null;
  markerEntities: Entity[];
  selectionHandler: ScreenSpaceEventHandler | null;
  selectedFeature: Cesium3DTileFeature | null;
  selectedFeatureOriginalColor: unknown;
};

export function createSceneRefs(): SceneRefs {
  return {
    viewer: null,
    buildingTileset: null,
    markerEntities: [],
    selectionHandler: null,
    selectedFeature: null,
    selectedFeatureOriginalColor: null,
  };
}
