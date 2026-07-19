/** Pure helpers for sampling Toronto 3D Massing building centroids. */

export type HomeSitesByCode = Record<string, Array<[number, number]>>;

/** Pick a building centroid inside the neighbourhood; null if that nbhd has no sites. */
export function sampleHomeSite(
  homes: HomeSitesByCode,
  code: string,
  rng: () => number,
): [number, number] | null {
  const sites = homes[code];
  if (!sites || sites.length === 0) return null;
  const idx = Math.floor(rng() * sites.length) % sites.length;
  const spot = sites[idx];
  return [spot[0], spot[1]];
}
