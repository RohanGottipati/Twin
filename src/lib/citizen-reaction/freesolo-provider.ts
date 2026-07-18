import type {
  CitizenReactionBatchInput,
  CitizenReactionBatchResult,
  ProviderStatus,
} from "@/lib/citizen-reaction/schemas";
import type { CitizenReactionProvider } from "@/lib/citizen-reaction/provider";
import { MockCitizenReactionProvider } from "@/lib/citizen-reaction/mock-provider";

/**
 * FreeSolo-backed citizen reaction provider. Calls the configured FreeSolo
 * OpenAI-compatible endpoint when FREESOLO_API_KEY + FREESOLO_BASE_URL are set;
 * otherwise falls back to the deterministic mock with an explicit label so
 * planners never mistake the output for a live FreeSolo deployment.
 */
export class FreeSoloCitizenReactionProvider implements CitizenReactionProvider {
  private readonly fallback = new MockCitizenReactionProvider();

  private getConfig(): { baseUrl: string; apiKey: string; model: string; timeoutMs: number } | null {
    const baseUrl = process.env.FREESOLO_BASE_URL?.trim() ?? "";
    const apiKey = process.env.FREESOLO_API_KEY?.trim() ?? "";
    if (!baseUrl || !apiKey) return null;
    return {
      baseUrl: baseUrl.replace(/\/$/, ""),
      apiKey,
      model: process.env.FREESOLO_REACTION_MODEL_ALIAS?.trim() || "twinto-citizen-reaction",
      timeoutMs: Number(process.env.FREESOLO_TIMEOUT_SECONDS ?? 45) * 1000,
    };
  }

  async getStatus(): Promise<ProviderStatus> {
    const config = this.getConfig();
    if (!config) {
      return {
        provider: "freesolo-fallback-mock",
        mode: "mock",
        ready: true,
        label: "FREESOLO_API_KEY/BASE_URL unset; using mock heuristic with simulated labels.",
      };
    }
    return {
      provider: "freesolo",
      mode: "live",
      ready: true,
      label: `Configured model alias ${config.model}`,
    };
  }

  async predictBatch(input: CitizenReactionBatchInput): Promise<CitizenReactionBatchResult> {
    const config = this.getConfig();
    if (!config) {
      const result = await this.fallback.predictBatch(input);
      return { ...result, provider: "mock" };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      const response = await fetch(`${config.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: config.model,
          temperature: 0.2,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                "You are TwinTO CitizenReactionLM. Return ONLY JSON matching the TwinTO citizen reaction batch schema. Label all outputs as simulated. Never invent impossible journeys.",
            },
            {
              role: "user",
              content: JSON.stringify(input),
            },
          ],
        }),
      });

      if (!response.ok) {
        throw new Error(`FreeSolo HTTP ${response.status}`);
      }

      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = payload.choices?.[0]?.message?.content;
      if (!content) throw new Error("FreeSolo returned empty content.");

      const parsed = JSON.parse(content) as CitizenReactionBatchResult;
      return {
        ...parsed,
        provider: "live",
        scenarioId: parsed.scenarioId ?? input.scenarioId,
        generatedAt: parsed.generatedAt ?? new Date().toISOString(),
      };
    } catch {
      const result = await this.fallback.predictBatch(input);
      return { ...result, provider: "mock" };
    } finally {
      clearTimeout(timer);
    }
  }
}
