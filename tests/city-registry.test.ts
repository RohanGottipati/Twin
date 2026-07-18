import { describe, expect, it } from "vitest";
import {
  cityRegistry,
  getCityById,
  getEnabledCities,
} from "@/config/cities/registry";

describe("city registry", () => {
  it("returns Toronto from the registry", () => {
    const toronto = getCityById("toronto");
    expect(toronto).toBeDefined();
    expect(toronto?.name).toBe("Toronto");
    expect(toronto?.region).toBe("Ontario");
    expect(toronto?.country).toBe("Canada");
  });

  it("returns undefined for an unknown city", () => {
    expect(getCityById("atlantis")).toBeUndefined();
  });

  it("only lists enabled cities", () => {
    const enabled = getEnabledCities();
    expect(enabled.length).toBeGreaterThan(0);
    expect(enabled.every((city) => city.enabled)).toBe(true);
  });

  it("contains exactly the configured cities", () => {
    expect(cityRegistry.map((city) => city.id)).toContain("toronto");
  });
});
