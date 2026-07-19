/**
 * Thin client for the real trained opinion model: Qwen3.5-9B + LoRA,
 * SFT then GRPO (model/sft, model/grpo), served live via FreeSolo/Modal.
 * Same credentials as the (now-superseded) FreeSoloCitizenReactionProvider
 * batch call, but the real single-turn contract it was actually trained
 * on: one persona + one policy in, free-text first-person opinion prose
 * out (model/sft/prompt.py::build_user_content). No system message --
 * training used a bare user-role message, so inference mirrors that.
 */

function getConfig(): { baseUrl: string; apiKey: string; model: string; timeoutMs: number } {
  const baseUrl = process.env.FREESOLO_BASE_URL?.trim() ?? "";
  const apiKey = process.env.FREESOLO_API_KEY?.trim() ?? "";
  if (!baseUrl || !apiKey) {
    throw new Error("FREESOLO_BASE_URL and FREESOLO_API_KEY required for the real opinion model.");
  }
  return {
    baseUrl: baseUrl.replace(/\/$/, ""),
    apiKey,
    model: process.env.TECHTO_OPINION_MODEL_ALIAS?.trim() || "flash-1784401342-0d51be72",
    timeoutMs: Number(process.env.FREESOLO_TIMEOUT_SECONDS ?? 45) * 1000,
  };
}

/**
 * Real SFT training `policy_text` (data/ingest_polis.py, data/ingest_toronto_consultation.py,
 * data/ingest_anes_openends.py) is always short civic context ending in an
 * explicit question addressed to the resident -- e.g. "The City of Toronto
 * is conducting a review of its core services... Residents are asked: which
 * city services matter most to you...?" or "Should the city adopt a $15/hour
 * minimum wage?". Inference-time policy text built from a bare ScenarioPatch
 * title/rationale or a freeform agent question doesn't necessarily end in a
 * question, which is a real distribution shift from what the model saw in
 * training -- so every caller funnels through this before the model sees it.
 */
export function formatPolicyTextForModel(text: string): string {
  const trimmed = text.trim();
  if (!trimmed || /[?]\s*$/.test(trimmed)) return trimmed;
  return `${trimmed.replace(/[.\s]+$/, "")}. Do you support this?`;
}

/** Mirrors model/sft/prompt.py::build_user_content exactly. */
export function buildOpinionPrompt(personaText: string, policyText: string, spatialFeaturesText?: string | null): string {
  const parts: string[] = [];
  if (personaText) parts.push(`PERSONA:\n${personaText}`);
  if (policyText) parts.push(`POLICY:\n${policyText}`);
  if (spatialFeaturesText) {
    parts.push(spatialFeaturesText.startsWith("SPATIAL:") ? spatialFeaturesText : `SPATIAL:\n${spatialFeaturesText}`);
  }
  parts.push(
    "Write your opinion on this policy in first person, in your own voice. Be concrete about how it affects you.",
  );
  return parts.join("\n\n");
}

/** Calls the real model for one persona and returns its raw opinion prose. */
export async function generateOpinion(personaText: string, policyText: string): Promise<string> {
  const config = getConfig();
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
        temperature: 0.7,
        messages: [{ role: "user", content: buildOpinionPrompt(personaText, policyText) }],
      }),
    });

    if (!response.ok) {
      throw new Error(`Opinion model HTTP ${response.status}`);
    }

    const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error("Opinion model returned empty content.");
    return content.trim();
  } finally {
    clearTimeout(timer);
  }
}
