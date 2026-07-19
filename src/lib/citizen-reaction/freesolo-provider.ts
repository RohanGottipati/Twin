import type {
  CitizenReactionBatchInput,
  CitizenReactionBatchResult,
  ProviderStatus,
} from "@/lib/citizen-reaction/schemas";
import type { CitizenReactionProvider } from "@/lib/citizen-reaction/provider";

/**
 * FreeSolo-backed citizen reaction provider. Requires FREESOLO_API_KEY + FREESOLO_BASE_URL.
 */
export class FreeSoloCitizenReactionProvider implements CitizenReactionProvider {
  private getConfig(): { baseUrl: string; apiKey: string; model: string; timeoutMs: number } {
    const baseUrl = process.env.FREESOLO_BASE_URL?.trim() ?? "";
    const apiKey = process.env.FREESOLO_API_KEY?.trim() ?? "";
    if (!baseUrl || !apiKey) {
      throw new Error("FREESOLO_BASE_URL and FREESOLO_API_KEY required (no mock citizen provider).");
    }
    return {
      baseUrl: baseUrl.replace(/\/$/, ""),
      apiKey,
      model: process.env.FREESOLO_REACTION_MODEL_ALIAS?.trim() || "techto-citizen-reaction",
      timeoutMs: Number(process.env.FREESOLO_TIMEOUT_SECONDS ?? 45) * 1000,
    };
  }

  async getStatus(): Promise<ProviderStatus> {
    const config = this.getConfig();
    return {
      provider: "freesolo",
      mode: "live",
      ready: true,
      label: `Configured model alias ${config.model}`,
    };
  }

  async predictBatch(input: CitizenReactionBatchInput): Promise<CitizenReactionBatchResult> {
    const config = this.getConfig();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);

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
              "You are TechTO CitizenReactionLM. Return ONLY JSON matching the TechTO citizen reaction batch schema. Label all outputs as simulated. Never invent impossible journeys.",
          },
          {
            role: "user",
            content: JSON.stringify(input),
          },
        ],
      }),
    });
    clearTimeout(timer);

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
  }
}
