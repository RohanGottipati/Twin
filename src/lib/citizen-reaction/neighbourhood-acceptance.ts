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
 *
 * Only the residents actually Monte-Carlo-sampled get a real result --
 * we never broadcast a neighbourhood's average onto every resident in it,
 * since that would misrepresent the handful of real model calls as if
 * every dot had been individually asked.
 */

const SAMPLE_SIZE = Number(process.env.TECHTO_NEIGHBOURHOOD_SAMPLE_SIZE ?? 3);
const CONCURRENCY = Number(process.env.TECHTO_OPINION_CONCURRENCY ?? 128);

interface ResidentPersonaDoc {
  persona_id: string;
  text: string;
}

export interface PersonaAcceptanceResult {
  code: string;
  personaId: string;
  acceptance: number;
  opinionText: string;
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
 * Real acceptance for a Monte-Carlo sample of residents drawn from every
 * neighbourhood, run as a single flat pool across every sampled resident
 * (not one pool per neighbourhood nested inside another) so the bounded
 * concurrency actually reflects "N real model calls in flight" rather than
 * "N neighbourhoods' worth of calls in flight, a few at a time each."
 * Emits each resident's real result via `onPersonaDone` as soon as it's
 * ready.
 */
export async function computeRealNeighbourhoodAcceptance(
  scenario: Scenario,
  neighbourhoodCodes: string[],
  onPersonaDone?: (result: PersonaAcceptanceResult) => void,
): Promise<PersonaAcceptanceResult[]> {
  const policyText = scenarioPolicyText(scenario);

  const perNeighbourhood = await runWithLimit(
    neighbourhoodCodes.map((code) => async () => ({
      code,
      personas: await samplePersonasForNeighbourhood(code, SAMPLE_SIZE),
    })),
    CONCURRENCY,
  );

  const tasks = perNeighbourhood.flatMap(({ code, personas }) =>
    personas.map(
      (persona) =>
        async (): Promise<PersonaAcceptanceResult> => {
          const opinionText = await getOrGenerateOpinion(persona.persona_id, persona.text, policyText);
          const acceptance = await scoreOpinionWithEmbeddingProbe(opinionText);
          const result: PersonaAcceptanceResult = { code, personaId: persona.persona_id, acceptance, opinionText };
          onPersonaDone?.(result);
          return result;
        },
    ),
  );

  return runWithLimit(tasks, CONCURRENCY);
}
