import { getMongoDb } from "@/lib/mongodb/client";
import { COLLECTIONS } from "@/lib/mongodb/collections";
import type { CitizenCohortDemographics } from "@/lib/citizen-reaction/schemas";

/**
 * Maps a cohort's coarse demographics (`CitizenCohortDemographics`) to a
 * Mongo filter over real `resident_personas` fields, and samples real
 * persona records matching it. Cohort-level neighbourhood identity is
 * deliberately NOT used here: the shared `CitizenReactionContext` in a
 * batch already applies city-wide, so the only signal a real persona can
 * add is demographic, not geographic -- sampling by archetype instead of
 * per-neighbourhood cuts model calls by roughly the number of
 * neighbourhoods without losing any signal the pipeline actually models.
 */

export interface PersonaSample {
  personaId: string;
  text: string;
}

interface ResidentPersonaDoc {
  persona_id: string;
  text: string;
}

const CAR_MODES = ["Car, truck or van - as a driver", "Car, truck or van - as a passenger"];

/** Stable grouping key so cohorts sharing an archetype reuse one set of samples. */
export function archetypeKey(demographics: CitizenCohortDemographics | undefined): string {
  if (!demographics) return "unknown";
  const { ageBand, incomeBand, primaryMode, hasDisability } = demographics;
  return [ageBand ?? "any", incomeBand ?? "any", primaryMode ?? "any", hasDisability ? "disability" : "no-disability"].join("|");
}

/**
 * Real `resident_personas` has no disability field and only two age
 * buckets ("15-64"/"65+"), coarser than the cohort's youth/adult/senior --
 * "youth" and "adult" both map to "15-64" (documented gap, not a bug).
 */
function buildFilter(demographics: CitizenCohortDemographics | undefined): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  if (!demographics) return filter;

  if (demographics.ageBand === "senior") {
    filter.age_band = "65+";
  } else if (demographics.ageBand === "youth" || demographics.ageBand === "adult") {
    filter.age_band = "15-64";
  }

  if (demographics.incomeBand === "low") {
    filter.household_income_decile = { $gte: 1, $lte: 3 };
  } else if (demographics.incomeBand === "middle") {
    filter.household_income_decile = { $gte: 4, $lte: 7 };
  } else if (demographics.incomeBand === "high") {
    filter.household_income_decile = { $gte: 8, $lte: 10 };
  }

  if (demographics.primaryMode === "transit") {
    filter.commute_mode = "Public transit";
  } else if (demographics.primaryMode === "car") {
    filter.commute_mode = { $in: CAR_MODES };
  } else if (demographics.primaryMode === "walk") {
    filter.commute_mode = "Walked";
  } else if (demographics.primaryMode === "bike") {
    filter.commute_mode = "Bicycle";
  }

  return filter;
}

/** Progressively drops filter dimensions (mode, then income, then age) until a real sample is found. */
async function sampleWithFallback(
  filter: Record<string, unknown>,
  size: number,
): Promise<ResidentPersonaDoc[]> {
  const db = await getMongoDb();
  const collection = db.collection(COLLECTIONS.residentPersonas);

  const attempts: Record<string, unknown>[] = [
    filter,
    { ...filter, commute_mode: undefined },
    { ...filter, commute_mode: undefined, household_income_decile: undefined },
    {},
  ].map((f) => Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined)));

  for (const attempt of attempts) {
    const docs = (await collection
      .aggregate([
        { $match: attempt },
        { $sample: { size } },
        { $project: { persona_id: 1, text: 1, _id: 0 } },
      ])
      .toArray()) as unknown as ResidentPersonaDoc[];
    if (docs.length > 0) return docs;
  }
  return [];
}

export async function samplePersonasForArchetype(
  demographics: CitizenCohortDemographics | undefined,
  size: number,
): Promise<PersonaSample[]> {
  const filter = buildFilter(demographics);
  const docs = await sampleWithFallback(filter, size);
  return docs.map((doc) => ({ personaId: doc.persona_id, text: doc.text }));
}
