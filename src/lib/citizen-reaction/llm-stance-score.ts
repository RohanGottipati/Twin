import { z } from "zod";

import { getBackboardAdapter } from "@/lib/backboard/adapter";
import { resolveAssistant } from "@/lib/backboard/assistant-manifest";
import type { BackboardAdapter } from "@/lib/backboard/client";

/**
 * Stance classification for a generated resident opinion, via a fast LLM
 * call instead of the linear embedding-probe-score.ts. The embedding probe
 * is a single linear direction fit on ~1.7k Polis comments across only 12
 * unrelated topics (minimum wage, UBI, electoral reform, ...); it has no
 * signal for topics outside that set (e.g. a parking fee) and was observed
 * scoring clearly-supportive and clearly-opposing text about a new topic
 * nearly identically low -- a generalization failure, not a calibration one.
 * Reading comprehension of "does this text support the stated policy" is a
 * much better fit for a general LLM than a frozen sentence embedding + a
 * linear head trained on a handful of topics.
 *
 * This reuses the existing "city-copilot" assistant's identity/model
 * resolution (already the FAST_CLASSIFICATION tier, already live) purely as
 * infra -- assistantId and model selection -- rather than registering a new
 * roster role: ASSISTANT_ROSTER is deliberately capped at exactly 11
 * principled roles (assistants.test.ts asserts this), so a new niche
 * classification-only role isn't a fit. The system prompt below is passed
 * per-call, overriding city-copilot's own conversational prompt for just
 * this stateless request; no tools, no memory, no thread reuse.
 */

const ROLE = "city-copilot" as const;

const CLASSIFIER_SYSTEM_PROMPT = `
You classify a single piece of first-person resident opinion text against the
policy question it was responding to. Read the opinion's actual stance
(support, oppose, or neutral/mixed) -- not surface keywords, not topic, not
tone alone. Output only a 0-1 acceptance probability: near 1.0 = clearly
supports the policy, near 0.0 = clearly opposes it, ~0.5 = genuinely neutral,
mixed, or off-topic. This is a one-shot classification call, not a
conversation -- do not ask questions or add commentary.
`.trim();

const stanceResultSchema = z.object({ score: z.number().min(0).max(1) }).strict();

function buildPrompt(policyText: string, opinionText: string): string {
  return `
Policy question the resident was responding to:
${policyText}

Resident's opinion:
"""
${opinionText}
"""

Respond with ONLY JSON matching: {"score": number between 0 and 1}
`.trim();
}

function parseStanceScore(raw: string | null): { ok: true; value: number } | { ok: false; error: string } {
  if (!raw || raw.trim().length === 0) {
    return { ok: false, error: "The response content was empty." };
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    return { ok: false, error: `The response was not valid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  const parsed = stanceResultSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((issue) => `- ${issue.path.join(".") || "(root)"}: ${issue.message}`).join("\n"),
    };
  }
  return { ok: true, value: parsed.data.score };
}

/**
 * Score a generated opinion's acceptance of `policyText` in [0, 1] via a
 * fast, stateless (no thread reuse, no memory) classification call. Retries
 * once with a correction turn on malformed JSON, same convention as
 * askOperatorQuestion (operator.ts).
 */
export async function scoreOpinionWithLLM(
  policyText: string,
  opinionText: string,
  adapter?: BackboardAdapter,
): Promise<number> {
  const text = opinionText.trim();
  if (!text) return 0.5;

  const activeAdapter = adapter ?? getBackboardAdapter();
  const resolved = await resolveAssistant(ROLE, activeAdapter);

  const first = await activeAdapter.sendMessage({
    assistantId: resolved.record.assistantId,
    content: buildPrompt(policyText, text),
    systemPrompt: CLASSIFIER_SYSTEM_PROMPT,
    modelName: resolved.model.modelName,
    llmProvider: resolved.model.provider,
    memory: "off",
    jsonOutput: true,
  });
  let attempt = parseStanceScore(first.content);
  if (attempt.ok) return attempt.value;

  const correction = await activeAdapter.sendMessage({
    assistantId: resolved.record.assistantId,
    threadId: first.threadId,
    content: `Your previous JSON response had the following problem(s):\n${attempt.error}\n\nReply again with ONLY the corrected JSON object: {"score": number between 0 and 1}.`,
    systemPrompt: CLASSIFIER_SYSTEM_PROMPT,
    modelName: resolved.model.modelName,
    llmProvider: resolved.model.provider,
    memory: "off",
    jsonOutput: true,
  });
  attempt = parseStanceScore(correction.content);
  if (attempt.ok) return attempt.value;

  throw new Error(`scoreOpinionWithLLM: model did not return valid JSON after retry: ${attempt.error}`);
}
