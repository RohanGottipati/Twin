import { readFile } from "node:fs/promises";
import path from "node:path";

import { geometryBbox, pointInGeometry, type PolygonGeometry } from "@/lib/geo";
import { getMongoDb } from "@/lib/mongodb/client";
import { COLLECTIONS } from "@/lib/mongodb/collections";
import { errorMessage, jsonError } from "@/lib/backboard/route-helpers";
import { hashString, mulberry32 } from "@/lib/random";
import { sampleHomeSite, type HomeSitesByCode } from "@/lib/sim/home-sites";
import type { Persona } from "@/lib/sim/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface NeighbourhoodGeoJsonFeature {
  properties: { code: string; name: string; population: number };
  geometry: PolygonGeometry;
}

interface ResidentPersonaDoc {
  neighbourhood_code: string;
  household_income_decile: number | null;
  commute_mode: string | null;
  age_band: string;
  gender: string;
  education: string;
  tenure: string;
  household_income_band: string;
  text: string;
}

/** Real household-income-decile -> approximate z-score, roughly [-2, 2]. */
function incomeZFromDecile(decile: number | null): number {
  if (decile === null) return 0;
  return Math.max(-2.5, Math.min(2.5, (decile - 5.5) / 2.25));
}

const CAR_MODES = new Set(["Car, truck or van - as a driver", "Car, truck or van - as a passenger"]);

/** Real commute-mode -> {transitAffinity, carDependence} proxy (documented derivation, not raw survey fields -- see AGENTS.md 6.1). */
function affinitiesFromCommuteMode(mode: string | null, rng: () => number): { transitAffinity: number; carDependence: number } {
  const noise = () => (rng() - 0.5) * 0.2;
  if (mode === "Public transit") return { transitAffinity: clamp01(0.85 + noise()), carDependence: clamp01(0.1 + noise()) };
  if (mode && CAR_MODES.has(mode)) return { transitAffinity: clamp01(0.1 + noise()), carDependence: clamp01(0.85 + noise()) };
  if (mode === "Walked") return { transitAffinity: clamp01(0.5 + noise()), carDependence: clamp01(0.1 + noise()) };
  if (mode === "Bicycle") return { transitAffinity: clamp01(0.4 + noise()), carDependence: clamp01(0.1 + noise()) };
  if (mode === "Motorcycle, scooter or moped") return { transitAffinity: clamp01(0.15 + noise()), carDependence: clamp01(0.7 + noise()) };
  // "Other method" or missing (not commuting): no real signal either way.
  return { transitAffinity: clamp01(0.4 + noise()), carDependence: clamp01(0.4 + noise()) };
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** Last-resort fallback only: polygon sample (should almost never run; every nbhd has massing sites). */
function samplePointInPolygon(geometry: PolygonGeometry, rng: () => number): [number, number] {
  const [minX, minY, maxX, maxY] = geometryBbox(geometry);
  for (let attempt = 0; attempt < 200; attempt++) {
    const p: [number, number] = [minX + rng() * (maxX - minX), minY + rng() * (maxY - minY)];
    if (pointInGeometry(p, geometry)) return p;
  }
  return [(minX + maxX) / 2, (minY + maxY) / 2];
}

/**
 * Serves real resident dots for the homepage map: one dot per real
 * `resident_personas` record, placed on a Toronto 3D Massing building
 * centroid inside that neighbourhood (never parks / water / empty lots).
 */
export async function GET() {
  try {
    const geojsonPath = path.join(process.cwd(), "public", "data", "neighbourhoods.geojson");
    const homesPath = path.join(process.cwd(), "public", "data", "home-sites.json");
    const [geojsonRaw, homesRaw] = await Promise.all([
      readFile(geojsonPath, "utf-8"),
      readFile(homesPath, "utf-8"),
    ]);
    const geojson = JSON.parse(geojsonRaw) as { features: NeighbourhoodGeoJsonFeature[] };
    const homes = JSON.parse(homesRaw) as HomeSitesByCode;

    const db = await getMongoDb();
    const docs = (await db
      .collection(COLLECTIONS.residentPersonas)
      .find(
        {},
        {
          projection: {
            neighbourhood_code: 1,
            household_income_decile: 1,
            household_income_band: 1,
            commute_mode: 1,
            age_band: 1,
            gender: 1,
            education: 1,
            tenure: 1,
            text: 1,
          },
        },
      )
      .toArray()) as unknown as ResidentPersonaDoc[];

    const byNeighbourhood = new Map<string, ResidentPersonaDoc[]>();
    for (const doc of docs) {
      const list = byNeighbourhood.get(doc.neighbourhood_code) ?? [];
      list.push(doc);
      byNeighbourhood.set(doc.neighbourhood_code, list);
    }

    const personas: Persona[] = [];
    let id = 0;

    for (const feature of geojson.features) {
      const { code } = feature.properties;
      const pool = byNeighbourhood.get(code);
      if (!pool || pool.length === 0) continue;

      const rng = mulberry32(hashString(`resident_personas:${code}`));

      for (const source of pool) {
        const home = sampleHomeSite(homes, code, rng) ?? samplePointInPolygon(feature.geometry, rng);
        const [lng, lat] = home;
        const { transitAffinity, carDependence } = affinitiesFromCommuteMode(source.commute_mode, rng);
        personas.push({
          id: id++,
          lng,
          lat,
          code,
          incomeZ: incomeZFromDecile(source.household_income_decile),
          transitAffinity,
          carDependence,
          ageBand: source.age_band,
          gender: source.gender,
          education: source.education,
          tenure: source.tenure,
          commuteMode: source.commute_mode,
          incomeBand: source.household_income_band,
          profileText: source.text,
        });
      }
    }

    return Response.json({ personas });
  } catch (error) {
    return jsonError(errorMessage(error), 500);
  }
}
