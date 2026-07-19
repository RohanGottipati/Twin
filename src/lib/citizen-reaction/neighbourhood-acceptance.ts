import { getMongoDb } from "@/lib/mongodb/client";
import { COLLECTIONS } from "@/lib/mongodb/collections";
import { getOrGenerateOpinion } from "@/lib/citizen-reaction/opinion-cache";
import { scoreOpinionWithEmbeddingProbe } from "@/lib/citizen-reaction/embedding-probe-score";
import { runWithLimit } from "@/lib/citizen-reaction/concurrency";
import type { Scenario } from "@/lib/sim/scenarios";

/**
 * Real per-neighbourhood acceptance for the homepage map: unlike
 * real-opinion-provider.ts (which groups by demographic archetype because
 * the orchestrator's shared effect-graph context makes neighbourhood
 * identity redundant there), this map is explicitly about SPATIAL
 * variation across Toronto -- so here neighbourhood identity is the whole
 * point, and each neighbourhood is sampled directly against its own real
 * resident_personas rather than pooled into archetypes.
 */

const SAMPLE_SIZE = Number(process.env.TECHTO_NEIGHBOURHOOD_SAMPLE_SIZE ?? 3);
const CONCURRENCY = Number(process.env.TECHTO_OPINION_CONCURRENCY ?? 8);

interface ResidentPersonaDoc {
  persona_id: string;
  text: string;
}

async function samplePersonasForNeighbourhood(code: string, size: number): Promise<ResidentPersonaDoc[]> {
  const db = await getMongoDb();
  const docs = await db
    .collection(COLLECTIONS.residentPersonas)
    .aggregate([
      { $match: { neighbourhood_code: code } },
      { $sample: { size } },
      { $project: { persona_id: 1, text: 1, _id: 0 } },
    ])
    .toArray();
  return docs as unknown as ResidentPersonaDoc[];
}

function scenarioPolicyText(scenario: Scenario): string {
  return `${scenario.name}. ${scenario.summary}`;
}

/**
 * Real acceptance per neighbourhood code, Monte-Carlo-sampled from that
 * neighbourhood's own real residents. Emits each neighbourhood's real
 * result via `onNeighbourhoodDone` as soon as it's ready -- one task per
 * neighbourhood (its small sample of personas scored together, in
 * parallel), run under one bounded pool so this streams results
 * incrementally instead of only resolving once everything is done.
 */
export async function computeRealNeighbourhoodAcceptance(
  scenario: Scenario,
  neighbourhoodCodes: string[],
  onNeighbourhoodDone?: (code: string, acceptance: number) => void,
): Promise<Map<string, number>> {
  const policyText = scenarioPolicyText(scenario);
  const result = new Map<string, number>();

  await runWithLimit(
    neighbourhoodCodes.map((code) => async () => {
      const personas = await samplePersonasForNeighbourhood(code, SAMPLE_SIZE);
      if (personas.length === 0) return;

      const scores = await Promise.all(
        personas.map(async (persona) => {
          const opinionText = await getOrGenerateOpinion(persona.persona_id, persona.text, policyText);
          return scoreOpinionWithEmbeddingProbe(opinionText);
        }),
      );
      const mean = scores.reduce((sum, s) => sum + s, 0) / scores.length;
      result.set(code, mean);
      onNeighbourhoodDone?.(code, mean);
    }),
    CONCURRENCY,
  );

  return result;
}
