import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { scoreTwinAgainstPersonas, type PopulationProvider, type PopulationScoreInput, type PopulationScoreResult } from "@/lib/population/score";
import type { Persona } from "@/lib/sim/types";
import { mulberry32 } from "@/lib/random";

export type { PopulationProvider, PopulationScoreInput, PopulationScoreResult };

const SEED = 2262;

/** Tiny offline personas for headless tests / server without browser geodata. */
export function buildToyPersonas(count = 40): Persona[] {
  const rng = mulberry32(SEED);
  const codes = ["020", "085", "078", "014", "123"];
  const out: Persona[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      id: i,
      lng: -79.5 + rng() * 0.35,
      lat: 43.6 + rng() * 0.2,
      code: codes[i % codes.length],
      incomeZ: (rng() - 0.5) * 2,
      transitAffinity: rng(),
      carDependence: rng(),
    });
  }
  return out;
}

export class SyntheticPopulationProvider implements PopulationProvider {
  private personas: Persona[];

  constructor(personas?: Persona[]) {
    this.personas = personas ?? buildToyPersonas();
  }

  async load(): Promise<Persona[]> {
    return this.personas;
  }

  async score(input: PopulationScoreInput): Promise<PopulationScoreResult> {
    return scoreTwinAgainstPersonas({
      ...input,
      personas: input.personas.length ? input.personas : this.personas,
      seed: input.seed ?? SEED,
    });
  }

  async getStatus() {
    return { mode: "synthetic", personaCount: this.personas.length };
  }
}

/**
 * Loads census-weighted personas from JSON when present.
 * Expected shape: { personas: Persona[] } under data/processed/census_personas.json
 * or path in CENSUS_PERSONAS_PATH.
 */
export class CensusPopulationProvider implements PopulationProvider {
  private personas: Persona[] | null = null;
  private pathHint: string;

  constructor(filePath?: string) {
    this.pathHint =
      filePath ??
      process.env.CENSUS_PERSONAS_PATH?.trim() ??
      path.join(process.cwd(), "data/processed/census_personas.json");
  }

  private ensureLoaded(): Persona[] {
    if (this.personas) return this.personas;
    if (!existsSync(this.pathHint)) {
      // fall through to toy until census file lands
      this.personas = buildToyPersonas(60);
      return this.personas;
    }
    const raw = JSON.parse(readFileSync(this.pathHint, "utf-8")) as {
      personas: Persona[];
    };
    // empty file = not ready yet, keep toy personas
    this.personas = raw.personas?.length ? raw.personas : buildToyPersonas(60);
    return this.personas;
  }

  private fileHasRealPersonas(): boolean {
    if (!existsSync(this.pathHint)) return false;
    const raw = JSON.parse(readFileSync(this.pathHint, "utf-8")) as { personas?: Persona[] };
    return Boolean(raw.personas?.length);
  }

  async load(): Promise<Persona[]> {
    return this.ensureLoaded();
  }

  async score(input: PopulationScoreInput): Promise<PopulationScoreResult> {
    const personas = input.personas.length ? input.personas : this.ensureLoaded();
    const result = scoreTwinAgainstPersonas({ ...input, personas, seed: input.seed ?? SEED });
    return {
      ...result,
      provider: this.fileHasRealPersonas() ? "census" : "census-fallback-synthetic",
    };
  }

  async getStatus() {
    const personas = this.ensureLoaded();
    return {
      mode: this.fileHasRealPersonas() ? "census" : "census-fallback-synthetic",
      personaCount: personas.length,
    };
  }
}

export function getPopulationProviderMode(): string {
  return process.env.TECHTO_POPULATION_PROVIDER?.trim().toLowerCase() || "synthetic";
}

export function getPopulationProvider(): PopulationProvider {
  const mode = getPopulationProviderMode();
  if (mode === "census") return new CensusPopulationProvider();
  return new SyntheticPopulationProvider();
}
