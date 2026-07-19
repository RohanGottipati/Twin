import {
  distanceKm,
  geometryBbox,
  pointInGeometry,
  type LngLat,
} from "@/lib/geo";
import { hashString, mulberry32 } from "@/lib/random";
import { sampleHomeSite, type HomeSitesByCode } from "@/lib/sim/home-sites";
import type { NeighbourhoodCollection, Persona } from "./types";

/** Each dot on the map stands in for roughly this many census residents. */
export const PERSONS_PER_DOT = 1382;

/** Nathan Phillips Square; used as the "downtown" anchor for behaviour priors. */
export const CITY_CENTER: LngLat = [-79.3832, 43.6532];

const CITY_MEDIAN_INCOME = 84_000;
const INCOME_SPREAD = 30_000;

/**
 * Build the synthetic population. Prefer residential building centroids from
 * home-sites.json (zoning-filtered 3D Massing); only fall back to polygon
 * rejection sampling when a neighbourhood has no sites.
 *
 * Prefer `/api/personas` for real Mongo residents. This path is offline fallback.
 */
export function buildPersonas(
  neighbourhoods: NeighbourhoodCollection,
  homes?: HomeSitesByCode | null,
): Persona[] {
  const personas: Persona[] = [];
  let id = 0;

  for (const feature of neighbourhoods.features) {
    const { code, population, income } = feature.properties;
    const rng = mulberry32(hashString(`techto:${code}`));
    const target = Math.max(3, Math.round(population / PERSONS_PER_DOT));
    const [minX, minY, maxX, maxY] = geometryBbox(feature.geometry);

    const incomeZ =
      income === null
        ? 0
        : Math.max(-2.5, Math.min(2.5, (income - CITY_MEDIAN_INCOME) / INCOME_SPREAD));

    let placed = 0;
    let attempts = 0;
    const maxAttempts = target * 60;
    while (placed < target && attempts < maxAttempts) {
      attempts++;
      // snap onto residential-zone building when we have sites for this nbhd
      const snapped = homes ? sampleHomeSite(homes, code, rng) : null;
      let p: LngLat;
      if (snapped) {
        p = snapped;
      } else {
        p = [
          minX + rng() * (maxX - minX),
          minY + rng() * (maxY - minY),
        ];
        if (!pointInGeometry(p, feature.geometry)) continue;
      }

      // Behaviour priors: transit propensity decays with distance from the
      // core (a real Toronto commute-mode gradient), with individual noise.
      const dCore = distanceKm(p, CITY_CENTER);
      const coreBias = Math.exp(-dCore / 9);
      const transitAffinity = clamp01(
        0.25 + 0.55 * coreBias + (rng() - 0.5) * 0.45
      );
      const carDependence = clamp01(
        0.95 - 0.75 * transitAffinity + (rng() - 0.5) * 0.3
      );

      personas.push({
        id: id++,
        lng: p[0],
        lat: p[1],
        code,
        incomeZ: incomeZ + (rng() - 0.5) * 0.6,
        transitAffinity,
        carDependence,
      });
      placed++;
    }
  }

  return personas;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}
