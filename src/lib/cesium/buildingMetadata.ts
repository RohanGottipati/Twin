export type BuildingPropertyValue = string | number | boolean | null;

export type NormalizedBuildingMetadata = {
  name: string;
  type: string | null;
  estimatedHeight: number | null;
  properties: Record<string, BuildingPropertyValue>;
};

export const NAME_KEYS = ["name", "Name", "building", "class", "type"] as const;

export const TYPE_KEYS = ["type", "class", "building"] as const;

export const HEIGHT_KEYS = [
  "height",
  "estimatedHeight",
  "cesium#estimated_height",
  "cesium_estimated_height",
] as const;

export function normalizePropertyValue(
  value: unknown
): BuildingPropertyValue {
  if (value === null || value === undefined) {
    return null;
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  try {
    return String(value);
  } catch {
    return null;
  }
}

export function normalizeProperties(
  raw: Record<string, unknown>
): Record<string, BuildingPropertyValue> {
  const result: Record<string, BuildingPropertyValue> = {};
  for (const [key, value] of Object.entries(raw)) {
    result[key] = normalizePropertyValue(value);
  }
  return result;
}

function firstStringValue(
  properties: Record<string, BuildingPropertyValue>,
  keys: readonly string[]
): string | null {
  for (const key of keys) {
    const value = properties[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return null;
}

export function deriveBuildingName(
  properties: Record<string, BuildingPropertyValue>
): string {
  return firstStringValue(properties, NAME_KEYS) ?? "Unnamed Building";
}

export function deriveBuildingType(
  properties: Record<string, BuildingPropertyValue>
): string | null {
  return firstStringValue(properties, TYPE_KEYS);
}

export function deriveEstimatedHeight(
  properties: Record<string, BuildingPropertyValue>
): number | null {
  for (const key of HEIGHT_KEYS) {
    const value = properties[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number.parseFloat(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return null;
}

export function makeBuildingId(
  longitude: number,
  latitude: number,
  name: string
): string {
  const lon = longitude.toFixed(5);
  const lat = latitude.toFixed(5);
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return `building:${slug}:${lon}:${lat}`;
}

export function normalizeBuildingMetadata(
  raw: Record<string, unknown>
): NormalizedBuildingMetadata {
  const properties = normalizeProperties(raw);
  return {
    name: deriveBuildingName(properties),
    type: deriveBuildingType(properties),
    estimatedHeight: deriveEstimatedHeight(properties),
    properties,
  };
}
