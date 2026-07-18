import type {
  BackboardAdapter,
  ChatToolCall,
  ChatToolDefinition,
  ChatRunResult,
  MemoryMode,
  StreamEventHandler,
  ThinkingConfig,
} from "@/lib/backboard/client";
import { dispatchToolCall, type RunContext, type ToolCallOutcome } from "@/lib/backboard/tool-dispatcher";

export class RunToolLoopError extends Error {}

export interface RunToolLoopOptions {
  adapter: BackboardAdapter;
  assistantId: string;
  content: string;
  context: RunContext;
  threadId?: string;
  systemPrompt?: string;
  modelName?: string;
  llmProvider?: string;
  tools?: ChatToolDefinition[];
  thinking?: ThinkingConfig;
  memory?: MemoryMode;
  jsonOutput?: boolean;
  metadata?: Record<string, unknown>;
  /** Safety bound on tool-call round trips for one logical turn. */
  maxRounds?: number;
  onEvent?: StreamEventHandler;
  onToolCallStart?: (call: ChatToolCall) => void;
  onToolCallEnd?: (outcome: ToolCallOutcome) => void;
}

export interface RunToolLoopResult {
  finalResult: ChatRunResult;
  rounds: number;
  toolCallLog: ToolCallOutcome[];
}

/**
 * Drives one assistant turn to completion: sends the message, and while the
 * run comes back REQUIRES_ACTION, dispatches every tool call in that round
 * concurrently (parallel tool calls) against the deterministic grid domain,
 * submits the outputs, and repeats (chained tool calls) until the assistant
 * produces a final answer or `maxRounds` is exceeded.
 */
export async function runToolLoop(options: RunToolLoopOptions): Promise<RunToolLoopResult> {
  const maxRounds = options.maxRounds ?? 6;
  const toolCallLog: ToolCallOutcome[] = [];

  let result = await options.adapter.sendMessage(
    {
      assistantId: options.assistantId,
      threadId: options.threadId,
      content: options.content,
      systemPrompt: options.systemPrompt,
      modelName: options.modelName,
      llmProvider: options.llmProvider,
      tools: options.tools,
      thinking: options.thinking,
      memory: options.memory,
      jsonOutput: options.jsonOutput,
      metadata: options.metadata,
    },
    options.onEvent,
  );

  let round = 0;
  while (result.status === "requires_action" && round < maxRounds) {
    round += 1;

    for (const call of result.toolCalls) {
      options.onToolCallStart?.(call);
    }

    const outcomes = await Promise.all(
      result.toolCalls.map((call) => dispatchToolCall(call, options.context, options.assistantId)),
    );

    for (const outcome of outcomes) {
      toolCallLog.push(outcome);
      options.onToolCallEnd?.(outcome);
    }

    result = await options.adapter.submitToolOutputs(
      {
        threadId: result.threadId,
        outputs: outcomes.map((outcome) => ({
          toolCallId: outcome.toolCallId,
          output: JSON.stringify(outcome.output),
        })),
      },
      options.onEvent,
    );
  }

  if (result.status === "requires_action") {
    throw new RunToolLoopError(
      `Assistant ${options.assistantId} still required tool action after ${maxRounds} round(s).`,
    );
  }

  return { finalResult: result, rounds: round, toolCallLog };
}
