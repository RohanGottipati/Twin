import { FreeSoloCitizenReactionProvider } from "@/lib/citizen-reaction/freesolo-provider";
import { RealOpinionCitizenReactionProvider } from "@/lib/citizen-reaction/real-opinion-provider";
import type { CitizenReactionBatchInput, CitizenReactionBatchResult, ProviderStatus } from "@/lib/citizen-reaction/schemas";

export class CitizenReactionProviderConfigError extends Error {}

/**
 * Population-simulator boundary (AGENTS.md 4.3). Live only; no mock.
 */
export interface CitizenReactionProvider {
  predictBatch(input: CitizenReactionBatchInput): Promise<CitizenReactionBatchResult>;
  getStatus(): Promise<ProviderStatus>;
}

export function getCitizenReactionProviderMode(): string {
  return process.env.TECHTO_CITIZEN_REACTION_PROVIDER?.trim().toLowerCase() || "real-opinion";
}

export function getCitizenReactionProvider(): CitizenReactionProvider {
  const mode = getCitizenReactionProviderMode();
  if (mode === "real-opinion") {
    return new RealOpinionCitizenReactionProvider();
  }
  if (mode === "freesolo" || mode === "live") {
    return new FreeSoloCitizenReactionProvider();
  }
  throw new CitizenReactionProviderConfigError(
    `Unknown TECHTO_CITIZEN_REACTION_PROVIDER "${mode}". Supported: "real-opinion" (default, trained model + real personas), "freesolo" (legacy batch-JSON fallback).`,
  );
}
