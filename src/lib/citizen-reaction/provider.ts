import { FreeSoloCitizenReactionProvider } from "@/lib/citizen-reaction/freesolo-provider";
import { MockCitizenReactionProvider } from "@/lib/citizen-reaction/mock-provider";
import type { CitizenReactionBatchInput, CitizenReactionBatchResult, ProviderStatus } from "@/lib/citizen-reaction/schemas";

export class CitizenReactionProviderConfigError extends Error {}

/**
 * The population-simulator boundary (AGENTS.md 4.3): implementations turn a
 * batch of census-weighted cohorts plus effect-graph context into a per-cohort
 * acceptance reading and a citywide/neighborhood aggregate. Swappable so the
 * eventual Freesolo-served Qwen model (see AGENTS.md section 5) can replace
 * the mock heuristic without touching any caller.
 */
export interface CitizenReactionProvider {
  predictBatch(input: CitizenReactionBatchInput): Promise<CitizenReactionBatchResult>;
  getStatus(): Promise<ProviderStatus>;
}

export function getCitizenReactionProviderMode(): string {
  return process.env.TWINTO_CITIZEN_REACTION_PROVIDER?.trim().toLowerCase() || "mock";
}

/**
 * Resolves the active provider from `TWINTO_CITIZEN_REACTION_PROVIDER`
 * (defaults to "mock"). Supported: mock | freesolo.
 */
export function getCitizenReactionProvider(): CitizenReactionProvider {
  const mode = getCitizenReactionProviderMode();

  if (mode === "mock") {
    return new MockCitizenReactionProvider();
  }

  if (mode === "freesolo" || mode === "live") {
    return new FreeSoloCitizenReactionProvider();
  }

  throw new CitizenReactionProviderConfigError(
    `Unknown TWINTO_CITIZEN_REACTION_PROVIDER "${mode}". Supported: "mock", "freesolo".`,
  );
}
