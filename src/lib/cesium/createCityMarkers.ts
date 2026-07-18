import type { Entity, Viewer } from "cesium";
import type { CityConfig } from "@/config/cities/types";
import type { CesiumModule } from "./types";

export const CITY_MARKER_PROPERTY = "isCityMarker";
export const CITY_ID_PROPERTY = "cityId";

// City markers should only be visible at global / regional distances.
const MARKER_MAX_DISTANCE = 30_000_000;
const MARKER_MIN_DISTANCE = 200_000;

export type CreateCityMarkersOptions = {
  Cesium: CesiumModule;
  viewer: Viewer;
  cities: CityConfig[];
};

export function createCityMarkers({
  Cesium,
  viewer,
  cities,
}: CreateCityMarkersOptions): Entity[] {
  const entities: Entity[] = [];

  for (const city of cities) {
    const position = Cesium.Cartesian3.fromDegrees(
      city.coordinates.longitude,
      city.coordinates.latitude
    );

    const entity = viewer.entities.add({
      position,
      point: {
        pixelSize: 12,
        color: Cesium.Color.fromCssColorString("#55D8E6"),
        outlineColor: Cesium.Color.fromCssColorString("#070A0F"),
        outlineWidth: 2,
        // Keep the marker visible through terrain at global distance.
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        distanceDisplayCondition:
          new Cesium.DistanceDisplayCondition(
            MARKER_MIN_DISTANCE,
            MARKER_MAX_DISTANCE
          ),
      },
      label: {
        text: city.marker.label,
        font: "600 14px system-ui, sans-serif",
        fillColor: Cesium.Color.fromCssColorString("#F5F7FA"),
        outlineColor: Cesium.Color.fromCssColorString("#070A0F"),
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -22),
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        distanceDisplayCondition:
          new Cesium.DistanceDisplayCondition(
            MARKER_MIN_DISTANCE,
            MARKER_MAX_DISTANCE
          ),
      },
    });

    // Subtle pulsing size animation.
    const basePixelSize = 12;
    entity.point!.pixelSize = new Cesium.CallbackProperty(() => {
      const seconds = Date.now() / 1000;
      return basePixelSize + Math.sin(seconds * 2) * 2.5;
    }, false);

    entity.addProperty(CITY_MARKER_PROPERTY);
    entity.addProperty(CITY_ID_PROPERTY);
    (entity as unknown as Record<string, unknown>)[CITY_MARKER_PROPERTY] =
      true;
    (entity as unknown as Record<string, unknown>)[CITY_ID_PROPERTY] =
      city.id;

    entities.push(entity);
  }

  return entities;
}

export function setMarkersVisible(
  entities: Entity[],
  visible: boolean
): void {
  for (const entity of entities) {
    entity.show = visible;
  }
}

export function setMarkerLabelsVisible(
  Cesium: CesiumModule,
  entities: Entity[],
  visible: boolean
): void {
  for (const entity of entities) {
    if (entity.label) {
      entity.label.show = new Cesium.ConstantProperty(visible);
    }
  }
}

export function getCityIdFromEntity(entity: Entity): string | null {
  const value = (entity as unknown as Record<string, unknown>)[
    CITY_ID_PROPERTY
  ];
  return typeof value === "string" ? value : null;
}

export function isCityMarkerEntity(entity: Entity): boolean {
  return Boolean(
    (entity as unknown as Record<string, unknown>)[CITY_MARKER_PROPERTY]
  );
}
