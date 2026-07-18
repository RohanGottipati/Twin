import type {
  Cartesian2,
  Cesium3DTileFeature,
  Viewer,
} from "cesium";
import type { SelectedBuilding } from "@/store/useWorldStore";
import type { CesiumModule, SceneRefs } from "./types";
import {
  makeBuildingId,
  normalizeBuildingMetadata,
} from "./buildingMetadata";

const HIGHLIGHT_COLOR_CSS = "#55D8E6";

export type SelectionCallbacks = {
  onSelect: (building: SelectedBuilding) => void;
  onClear: () => void;
};

function restorePreviousFeature(
  _Cesium: CesiumModule,
  refs: SceneRefs
): void {
  if (refs.selectedFeature && refs.selectedFeatureOriginalColor) {
    try {
      refs.selectedFeature.color = (
        refs.selectedFeatureOriginalColor as InstanceType<
          CesiumModule["Color"]
        >
      ).clone();
    } catch {
      // Feature may have been unloaded; ignore.
    }
  }
  refs.selectedFeature = null;
  refs.selectedFeatureOriginalColor = null;
}

export function restoreSelectedFeatureColor(
  Cesium: CesiumModule,
  refs: SceneRefs
): void {
  restorePreviousFeature(Cesium, refs);
}

function readFeatureProperties(
  feature: Cesium3DTileFeature
): Record<string, unknown> {
  const raw: Record<string, unknown> = {};
  try {
    const ids = feature.getPropertyIds();
    for (const id of ids) {
      raw[id] = feature.getProperty(id);
    }
  } catch {
    // Some features may not expose property ids; return what we have.
  }
  return raw;
}

function pickWorldPosition(
  Cesium: CesiumModule,
  viewer: Viewer,
  position: Cartesian2
): { longitude: number; latitude: number } | null {
  const scene = viewer.scene;
  let cartesian: InstanceType<CesiumModule["Cartesian3"]> | undefined;

  if (scene.pickPositionSupported) {
    const picked = scene.pickPosition(position);
    if (picked && Cesium.defined(picked)) {
      cartesian = picked;
    }
  }

  if (!cartesian) {
    const ray = viewer.camera.getPickRay(position);
    if (ray) {
      const globePick = scene.globe.pick(ray, scene);
      if (globePick) {
        cartesian = globePick;
      }
    }
  }

  if (!cartesian) {
    const ellipsoidPick = viewer.camera.pickEllipsoid(
      position,
      scene.globe.ellipsoid
    );
    if (ellipsoidPick) {
      cartesian = ellipsoidPick;
    }
  }

  if (!cartesian) {
    return null;
  }

  const cartographic =
    Cesium.Cartographic.fromCartesian(cartesian);
  return {
    longitude: Cesium.Math.toDegrees(cartographic.longitude),
    latitude: Cesium.Math.toDegrees(cartographic.latitude),
  };
}

export function attachBuildingSelection(
  Cesium: CesiumModule,
  viewer: Viewer,
  refs: SceneRefs,
  callbacks: SelectionCallbacks,
  isSelectable: () => boolean
) {
  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  const highlightColor = Cesium.Color.fromCssColorString(
    HIGHLIGHT_COLOR_CSS
  ).withAlpha(0.7);

  handler.setInputAction(
    (movement: { position: Cartesian2 }) => {
      if (!isSelectable()) {
        return;
      }

      const picked = viewer.scene.pick(movement.position);

      // Always restore the previously highlighted feature first.
      restorePreviousFeature(Cesium, refs);

      const isFeature =
        Cesium.defined(picked) &&
        picked instanceof Cesium.Cesium3DTileFeature;

      if (!isFeature) {
        callbacks.onClear();
        return;
      }

      const feature = picked as Cesium3DTileFeature;
      refs.selectedFeature = feature;
      refs.selectedFeatureOriginalColor = feature.color.clone();
      feature.color = highlightColor;

      const worldPosition = pickWorldPosition(
        Cesium,
        viewer,
        movement.position
      );
      const longitude = worldPosition?.longitude ?? 0;
      const latitude = worldPosition?.latitude ?? 0;

      const raw = readFeatureProperties(feature);
      const metadata = normalizeBuildingMetadata(raw);

      const building: SelectedBuilding = {
        id: makeBuildingId(longitude, latitude, metadata.name),
        name: metadata.name,
        type: metadata.type,
        estimatedHeight: metadata.estimatedHeight,
        longitude,
        latitude,
        properties: metadata.properties,
      };

      callbacks.onSelect(building);
    },
    Cesium.ScreenSpaceEventType.LEFT_CLICK
  );

  refs.selectionHandler = handler;
  return handler;
}
