import { getBackboardAdapter } from "@/lib/backboard/adapter";
import { resolveAssistant } from "@/lib/backboard/assistant-manifest";
import type { BackboardAdapter, WebSearchMode } from "@/lib/backboard/client";
import { runToolLoop } from "@/lib/backboard/run-tool-loop";
import { createRunContext } from "@/lib/backboard/tool-dispatcher";
import { getToolDefinitions } from "@/lib/backboard/tools";
import { operatorExplanationSchema, type OperatorExplanation } from "@/lib/transit/schemas";

export class OperatorQuestionError extends Error {}

const OPERATOR_ROLE = "explanation-map-action-agent" as const;

export interface AskOperatorQuestionInput {
  /** The scenario the operator's question concerns; used to give tool calls a real target. */
  scenarioId: string;
  /** Existing operator-explanation thread to continue; omit to start a fresh thread. */
  threadId?: string;
  /** Free-text recap of the run (recommendation, key metrics) so the answer does not have to be re-derived. */
  runContext?: string;
  question: string;
  webSearch?: WebSearchMode;
  adapter?: BackboardAdapter;
  /** Fired for each content token as it streams in; never fired for reasoning/thinking deltas. */
  onDelta?: (contentDelta: string) => void;
}

export interface AskOperatorQuestionResult {
  answer: OperatorExplanation;
  threadId: string;
  assistantId: string;
}

function buildOperatorPrompt(input: AskOperatorQuestionInput): string {
  const contextLines = [
    `Scenario: ${input.scenarioId}.`,
    input.runContext ? `Run context so far:\n${input.runContext}` : null,
  ].filter((line): line is string => line !== null);

  return `
${contextLines.join("\n")}

Operator question: ${input.question}

Answer as the TTC Operator Explanation Agent, addressing the operator directly.
Ground your answer in this specific run's evidence (candidateIds, tool
results, or memory items), not general knowledge. Call retrieve_policy_documents
if a term needs a plain-language definition.

Respond with ONLY JSON matching:
{"answer": string, "citedEvidence": string[]}
`.trim();
}

function parseOperatorAnswer(raw: string | null): { ok: true; value: OperatorExplanation } | { ok: false; error: string } {
  if (!raw || raw.trim().length === 0) {
    return { ok: false, error: "The response content was empty." };
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    return { ok: false, error: `The response was not valid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  const parsed = operatorExplanationSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((issue) => `- ${issue.path.join(".") || "(root)"}: ${issue.message}`).join("\n"),
    };
  }
  return { ok: true, value: parsed.data };
}

/**
 * Asks the operator's question to the TTC Operator Explanation Agent (a
 * low-cost synthesis role, see assistants.ts) and returns a structured,
 * evidence-cited answer. Retries once on malformed JSON, same as the
 * orchestrator's structured turns. `onDelta` lets a caller (the
 * operator-question SSE route) forward content as it streams without ever
 * seeing the model's raw reasoning, since reasoning deltas are never wired
 * into onDelta.
 */
export async function askOperatorQuestion(input: AskOperatorQuestionInput): Promise<AskOperatorQuestionResult> {
  const adapter = input.adapter ?? getBackboardAdapter();
  const resolved = await resolveAssistant(OPERATOR_ROLE, adapter);
  const context = createRunContext(input.scenarioId, adapter);
  const tools = getToolDefinitions(resolved.role.toolNames);

  let loop = await runToolLoop({
    adapter,
    assistantId: resolved.record.assistantId,
    threadId: input.threadId,
    content: buildOperatorPrompt(input),
    systemPrompt: resolved.role.systemPrompt,
    modelName: resolved.model.modelName,
    llmProvider: resolved.model.provider,
    tools,
    thinking: resolved.role.thinking,
    memory: resolved.role.memory,
    webSearch: input.webSearch,
    jsonOutput: true,
    context,
    onEvent: (event) => {
      if (event.type === "content_delta") {
        input.onDelta?.(event.content);
      }
    },
  });

  let attempt = parseOperatorAnswer(loop.finalResult.content);
  if (!attempt.ok) {
    const correction = `Your previous JSON response had the following problem(s):\n${attempt.error}\n\nReply again with ONLY the corrected, complete JSON object matching the required schema. Do not include any prose outside the JSON.`;
    loop = await runToolLoop({
      adapter,
      assistantId: resolved.record.assistantId,
      threadId: loop.finalResult.threadId,
      content: correction,
      systemPrompt: resolved.role.systemPrompt,
      modelName: resolved.model.modelName,
      llmProvider: resolved.model.provider,
      tools,
      thinking: resolved.role.thinking,
      memory: resolved.role.memory,
      webSearch: input.webSearch,
      jsonOutput: true,
      context,
      onEvent: (event) => {
        if (event.type === "content_delta") {
          input.onDelta?.(event.content);
        }
      },
    });
    attempt = parseOperatorAnswer(loop.finalResult.content);
  }

  if (!attempt.ok) {
    throw new OperatorQuestionError(`Operator question did not receive valid structured output: ${attempt.error}`);
  }

  return { answer: attempt.value, threadId: loop.finalResult.threadId, assistantId: resolved.record.assistantId };
}
