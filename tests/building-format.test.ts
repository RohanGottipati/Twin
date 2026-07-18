import { describe, expect, it } from "vitest";
import {
  formatCameraHeight,
  formatCoordinate,
} from "@/lib/utils/format";
import {
  deriveBuildingName,
  normalizeBuildingMetadata,
} from "@/lib/cesium/buildingMetadata";

describe("format utilities", () => {
  it("formats camera height below 1000m in metres", () => {
    expect(formatCameraHeight(720)).toBe("720 m");
  });

  it("formats camera height above 1000m in kilometres", () => {
    expect(formatCameraHeight(14000)).toBe("14.0 km");
  });

  it("formats coordinates to four decimal places", () => {
    expect(formatCoordinate(43.6532)).toBe("43.6532");
    expect(formatCoordinate(-79.3832)).toBe("-79.3832");
  });
});

describe("building metadata normalization", () => {
  it("normalizes property values and derives fields", () => {
    const metadata = normalizeBuildingMetadata({
      name: "CN Tower",
      building: "tower",
      height: 553,
      extra: { nested: true },
    });

    expect(metadata.name).toBe("CN Tower");
    expect(metadata.type).toBe("tower");
    expect(metadata.estimatedHeight).toBe(553);
    expect(typeof metadata.properties.extra).toBe("string");
  });

  it("falls back to Unnamed Building when no name exists", () => {
    const metadata = normalizeBuildingMetadata({
      someField: "value-without-name-keys",
    });
    expect(deriveBuildingName(metadata.properties)).toBe("Unnamed Building");
    expect(metadata.name).toBe("Unnamed Building");
    expect(metadata.type).toBeNull();
    expect(metadata.estimatedHeight).toBeNull();
  });

  it("parses numeric heights from string values", () => {
    const metadata = normalizeBuildingMetadata({
      cesium_estimated_height: "128.5",
    });
    expect(metadata.estimatedHeight).toBeCloseTo(128.5);
  });
});
