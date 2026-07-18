import type { CityConfig } from "./types";
import { torontoConfig } from "./toronto";

export const cityRegistry: CityConfig[] = [
  torontoConfig,
];

export function getCityById(
  cityId: string
): CityConfig | undefined {
  return cityRegistry.find(
    (city) => city.id === cityId
  );
}

export function getEnabledCities(): CityConfig[] {
  return cityRegistry.filter(
    (city) => city.enabled
  );
}
