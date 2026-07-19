import type { CitizenReactionProvider } from "@/lib/citizen-reaction/provider";
import type {
  CitizenCohort,
  CitizenCohortDemographics,
  CitizenReaction,
  CitizenReactionAggregate,
  CitizenReactionBatchInput,
  CitizenReactionBatchResult,
  CitizenReactionContext,
  Intervention,
  ProviderStatus,
} from "@/lib/citizen-reaction/schemas";
import { archetypeKey, samplePersonasForArchetype } from "@/lib/citizen-reaction/persona-sampler";
import { getOrGenerateOpinion } from "@/lib/citizen-reaction/opinion-cache";
import { scoreOpinion } from "@/lib/citizen-reaction/opinion-score";
import { runWithLimit } from "@/lib/citizen-reaction/concurrency";

/**
 * Real opinion-model provider: for each unique demographic archetype
 * present in the batch (not per-cohort, not per-resident -- see the design
 * note in src/lib/citizen-reaction/persona-sampler.ts), Monte-Carlo-samples
 * a handful of real `resident_personas`, calls the actual trained model
 * (model/sft, model/grpo) for each, scores the returned opinion prose with
 * the placeholder lexicon scorer, and reuses that archetype's result
 * across every cohort sharing it. Sampling is adaptive: if the initial
 * samples disagree a lot, a few more are drawn before settling.
 */

const MIN_SAMPLES = Number(process.env.TECHTO_OPINION_SAMPLE_SIZE ?? 3);
const MAX_SAMPLES = Math.max(MIN_SAMPLES, Number(process.env.TECHTO_OPINION_MAX_SAMPLE_SIZE ?? 6));
const EXTRA_BATCH = 3;
const DISAGREEMENT_STDDEV_THRESHOLD = 0.18;
const CONCURRENCY = Number(process.env.TECHTO_OPINION_CONCURRENCY ?? 8);

interface ArchetypeResult {
  meanAcceptance: number;
  confidence: number;
  representativeOpinion: string;
}

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function stddev(values: number[], avg: number): number {
  return Math.sqrt(mean(values.map((v) => (v - avg) ** 2)));
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** Human-readable rendering of the deterministic intervention + effect-graph context; matches the model's POLICY: input. */
function renderPolicyText(intervention: Intervention, context: CitizenReactionContext): string {
  const lines = [`${intervention.title} (${intervention.category}). ${intervention.description}`];
  if (context.wait) {
    lines.push(`Average transit wait time would change from ${context.wait.beforeMinutes.toFixed(1)} to ${context.wait.afterMinutes.toFixed(1)} minutes.`);
  }
  if (context.crowding) {
    lines.push(`Crowding index (0-1) would change from ${context.crowding.beforeIndex.toFixed(2)} to ${context.crowding.afterIndex.toFixed(2)}.`);
  }
  if (context.transfer) {
    lines.push(`Required transfers would change from ${context.transfer.beforeCount} to ${context.transfer.afterCount}.`);
  }
  if (context.price) {
    lines.push(`Fare would change from $${context.price.beforeCad.toFixed(2)} to $${context.price.afterCad.toFixed(2)} CAD.`);
  }
  if (context.accessibility) {
    lines.push(`Accessibility score (0-1) would change from ${context.accessibility.beforeScore.toFixed(2)} to ${context.accessibility.afterScore.toFixed(2)}.`);
  }
  if (context.event) {
    lines.push(`Related event: ${context.event.description}`);
  }
  return lines.join("\n");
}

async function resolveArchetype(
  demographics: CitizenCohortDemographics | undefined,
  policyText: string,
): Promise<ArchetypeResult> {
  const seenPersonaIds = new Set<string>();
  const scores: number[] = [];
  const texts: string[] = [];

  async function drawAndScore(size: number): Promise<void> {
    const samples = await samplePersonasForArchetype(demographics, size + seenPersonaIds.size);
    const fresh = samples.filter((s) => !seenPersonaIds.has(s.personaId)).slice(0, size);
    const opinions = await runWithLimit(
      fresh.map((persona) => async () => {
        const text = await getOrGenerateOpinion(persona.personaId, persona.text, policyText);
        return { personaId: persona.personaId, text };
      }),
      CONCURRENCY,
    );
    for (const opinion of opinions) {
      seenPersonaIds.add(opinion.personaId);
      texts.push(opinion.text);
      scores.push(scoreOpinion(opinion.text));
    }
  }

  await drawAndScore(MIN_SAMPLES);

  if (scores.length > 0) {
    let avg = mean(scores);
    let spread = stddev(scores, avg);
    while (spread > DISAGREEMENT_STDDEV_THRESHOLD && seenPersonaIds.size < MAX_SAMPLES) {
      await drawAndScore(Math.min(EXTRA_BATCH, MAX_SAMPLES - seenPersonaIds.size));
      avg = mean(scores);
      spread = stddev(scores, avg);
    }
  }

  if (scores.length === 0) {
    // No real persona matched even the fully relaxed filter -- neutral, low-confidence reading rather than a crash.
    return { meanAcceptance: 0.5, confidence: 0, representativeOpinion: "No matching resident records were available for this archetype." };
  }

  const avg = mean(scores);
  const spread = stddev(scores, avg);
  const confidence = clamp01(1 - spread * 2);
  const representativeIndex = scores.reduce(
    (bestIndex, score, index) => (Math.abs(score - avg) < Math.abs(scores[bestIndex] - avg) ? index : bestIndex),
    0,
  );
  return { meanAcceptance: avg, confidence, representativeOpinion: texts[representativeIndex].slice(0, 1000) };
}

function deriveModeShiftProb(intervention: Intervention, cohort: CitizenCohort, acceptance: number, context: CitizenReactionContext): number {
  if (intervention.category !== "transit" || cohort.demographics?.primaryMode === "transit" || !context.wait) return 0;
  const waitImprovement = clamp01((context.wait.beforeMinutes - context.wait.afterMinutes) / Math.max(context.wait.beforeMinutes, 1));
  return clamp01(acceptance * waitImprovement);
}

function derivePreferredDepartureShiftMinutes(acceptance: number, context: CitizenReactionContext): number {
  if (!context.wait) return 0;
  return (context.wait.afterMinutes - context.wait.beforeMinutes) * (1 - acceptance);
}

function computeAggregate(reactions: CitizenReaction[], cohorts: CitizenCohort[]): CitizenReactionAggregate {
  const weightByCohortId = new Map(cohorts.map((c) => [c.cohortId, c.populationWeight]));
  const acceptances = reactions.map((r) => r.acceptance);
  const n = acceptances.length;
  const meanAcceptance = mean(acceptances);

  const sorted = [...acceptances].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const medianAcceptance = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  const stdDevAcceptance = stddev(acceptances, meanAcceptance);

  let weightedSum = 0;
  let totalWeight = 0;
  for (const reaction of reactions) {
    const weight = weightByCohortId.get(reaction.cohortId) ?? 1;
    weightedSum += reaction.acceptance * weight;
    totalWeight += weight;
  }
  const populationWeightedAcceptance = totalWeight > 0 ? weightedSum / totalWeight : meanAcceptance;

  const meanModeShiftProb = mean(reactions.map((r) => r.modeShiftProb));
  const meanPreferredDepartureShiftMinutes = mean(reactions.map((r) => r.preferredDepartureShiftMinutes));

  let acceptCount = 0;
  let rejectCount = 0;
  let neutralCount = 0;
  for (const reaction of reactions) {
    if (reaction.acceptance >= 0.6) acceptCount += 1;
    else if (reaction.acceptance <= 0.4) rejectCount += 1;
    else neutralCount += 1;
  }

  return {
    cohortCount: n,
    meanAcceptance,
    medianAcceptance,
    stdDevAcceptance,
    populationWeightedAcceptance,
    meanModeShiftProb,
    meanPreferredDepartureShiftMinutes,
    acceptCount,
    neutralCount,
    rejectCount,
  };
}

export class RealOpinionCitizenReactionProvider implements CitizenReactionProvider {
  async getStatus(): Promise<ProviderStatus> {
    return {
      provider: "real-opinion",
      mode: "live",
      label: `Real trained opinion model (${process.env.TECHTO_OPINION_MODEL_ALIAS?.trim() || "flash-1784401342-0d51be72"}), sampling real resident_personas`,
      ready: Boolean(process.env.FREESOLO_BASE_URL && process.env.FREESOLO_API_KEY),
    };
  }

  async predictBatch(input: CitizenReactionBatchInput): Promise<CitizenReactionBatchResult> {
    const policyText = renderPolicyText(input.intervention, input.context);

    const archetypeToCohorts = new Map<string, CitizenCohort[]>();
    for (const cohort of input.cohorts) {
      const key = archetypeKey(cohort.demographics);
      const list = archetypeToCohorts.get(key) ?? [];
      list.push(cohort);
      archetypeToCohorts.set(key, list);
    }

    const archetypeEntries = [...archetypeToCohorts.entries()];
    const archetypeResults = await runWithLimit(
      archetypeEntries.map(([, cohorts]) => async () => resolveArchetype(cohorts[0].demographics, policyText)),
      CONCURRENCY,
    );

    const reactions: CitizenReaction[] = [];
    archetypeEntries.forEach(([, cohorts], i) => {
      const result = archetypeResults[i];
      for (const cohort of cohorts) {
        reactions.push({
          cohortId: cohort.cohortId,
          acceptance: result.meanAcceptance,
          modeShiftProb: deriveModeShiftProb(input.intervention, cohort, result.meanAcceptance, input.context),
          preferredDepartureShiftMinutes: derivePreferredDepartureShiftMinutes(result.meanAcceptance, input.context),
          rationale: result.representativeOpinion,
          confidence: result.confidence,
        });
      }
    });

    return {
      provider: "live",
      scenarioId: input.scenarioId,
      generatedAt: new Date().toISOString(),
      reactions,
      aggregate: computeAggregate(reactions, input.cohorts),
    };
  }
}
