import type {
  AssistantRecord,
  BackboardAdapter,
  ChatRunResult,
  ChatToolCall,
  CreateAssistantOptions,
  ListModelsFilter,
  MemoryRecord,
  ModelCapability,
  SendMessageOptions,
  StreamEventHandler,
  SubmitToolOutputsOptions,
  UploadDocumentResult,
} from "@/lib/backboard/client";

/**
 * Mock-only hints a caller can put in `metadata` to control the synthetic
 * response deterministically. Harmless if ever sent to the live adapter
 * (Backboard accepts arbitrary metadata and ignores unknown keys).
 */
export interface MockToolCallSpec {
  name: string;
  arguments: Record<string, unknown>;
}

export interface MockSendMessageHints {
  /** Rounds of tool calls to synthesize as REQUIRES_ACTION before completing. */
  mockToolPlan?: MockToolCallSpec[][];
  /** Returned verbatim as JSON content when jsonOutput is requested. */
  mockJsonResponse?: unknown;
  /** Returned verbatim as plain content when no tool plan/json response applies. */
  mockContent?: string;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function mockAssistantId(name: string): string {
  return `mock-assistant-${slugify(name)}`;
}

function generateId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

interface ThreadState {
  toolPlan: MockToolCallSpec[][];
  round: number;
  finalHints: MockSendMessageHints;
}

async function emitDelta(
  content: string,
  kind: "content_delta" | "reasoning_delta",
  onEvent: StreamEventHandler | undefined,
  delayMs: number,
): Promise<void> {
  if (!onEvent || content.length === 0) return;
  const words = content.split(/(\s+)/);
  const chunkSize = 4;
  for (let i = 0; i < words.length; i += chunkSize) {
    const chunk = words.slice(i, i + chunkSize).join("");
    if (chunk.length === 0) continue;
    onEvent({ type: kind, content: chunk } as never);
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

/**
 * Deterministic, offline stand-in for RestBackboardAdapter. It never calls
 * the network. Callers drive its behavior explicitly via `metadata` hints
 * (see MockSendMessageHints) so the orchestrator exercises the exact same
 * tool-loop, JSON-parsing, and Zod-validation code paths as live mode.
 */
export class MockBackboardAdapter implements BackboardAdapter {
  readonly mode = "mock" as const;

  private assistants = new Map<string, AssistantRecord>();
  private threads = new Map<string, ThreadState>();
  private memories = new Map<string, MemoryRecord[]>();
  private scriptedResponsesByAssistant = new Map<string, MockSendMessageHints[]>();
  private streamingDelayMs: number;

  constructor(options: { streamingDelayMs?: number } = {}) {
    this.streamingDelayMs = options.streamingDelayMs ?? 0;
  }

  /**
   * Test-only: queue the response(s) a given assistantId will give on its
   * next call(s) to sendMessage, used by orchestrator-level tests that call
   * runGridTwinOrchestration (which has no per-call metadata hook of its
   * own, unlike direct runToolLoop tests). Responses are consumed in order;
   * the last one repeats indefinitely once the queue is down to one, so a
   * stage that only needs a single scripted turn does not have to guess how
   * many times it will be called.
   */
  scriptAssistantResponses(assistantId: string, responses: MockSendMessageHints[]): void {
    this.scriptedResponsesByAssistant.set(assistantId, [...responses]);
  }

  private resolveHints(options: SendMessageOptions): MockSendMessageHints {
    const metadataHints = (options.metadata ?? {}) as MockSendMessageHints;
    if (
      metadataHints.mockToolPlan !== undefined ||
      metadataHints.mockJsonResponse !== undefined ||
      metadataHints.mockContent !== undefined
    ) {
      return metadataHints;
    }
    const queue = this.scriptedResponsesByAssistant.get(options.assistantId);
    if (queue && queue.length > 0) {
      return queue.length > 1 ? queue.shift()! : queue[0];
    }
    return {};
  }

  private toolRoundResult(threadId: string, round: MockToolCallSpec[]): ChatRunResult {
    const toolCalls: ChatToolCall[] = round.map((spec, index) => ({
      id: generateId(`mock-call-${index}`),
      name: spec.name,
      arguments: spec.arguments,
      rawArguments: JSON.stringify(spec.arguments),
    }));
    return {
      threadId,
      runId: generateId("mock-run"),
      assistantId: null,
      status: "requires_action",
      content: null,
      reasoning: null,
      toolCalls,
      modelProvider: "mock",
      modelName: "mock-model",
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      retrievedMemories: [],
    };
  }

  private async completionResult(
    threadId: string,
    hints: MockSendMessageHints,
    onEvent?: StreamEventHandler,
  ): Promise<ChatRunResult> {
    const content = hints.mockJsonResponse !== undefined
      ? JSON.stringify(hints.mockJsonResponse)
      : hints.mockContent ?? "";
    await emitDelta(content, "content_delta", onEvent, this.streamingDelayMs);
    onEvent?.({ type: "run_ended", status: "completed" });
    return {
      threadId,
      runId: generateId("mock-run"),
      assistantId: null,
      status: "completed",
      content,
      reasoning: null,
      toolCalls: [],
      modelProvider: "mock",
      modelName: "mock-model",
      inputTokens: Math.ceil(content.length / 4),
      outputTokens: Math.ceil(content.length / 4),
      totalTokens: Math.ceil(content.length / 2),
      retrievedMemories: [],
    };
  }

  async sendMessage(options: SendMessageOptions, onEvent?: StreamEventHandler): Promise<ChatRunResult> {
    const threadId = options.threadId ?? generateId("mock-thread");
    const hints = this.resolveHints(options);
    const toolPlan = hints.mockToolPlan ?? [];

    if (toolPlan.length > 0) {
      this.threads.set(threadId, { toolPlan, round: 0, finalHints: hints });
      const result = this.toolRoundResult(threadId, toolPlan[0]);
      onEvent?.({ type: "tool_submit_required", toolCalls: result.toolCalls });
      return result;
    }

    return this.completionResult(threadId, hints, onEvent);
  }

  async submitToolOutputs(
    options: SubmitToolOutputsOptions,
    onEvent?: StreamEventHandler,
  ): Promise<ChatRunResult> {
    const state = this.threads.get(options.threadId);
    if (!state) {
      return this.completionResult(options.threadId, {}, onEvent);
    }

    const nextRound = state.round + 1;
    if (nextRound < state.toolPlan.length) {
      state.round = nextRound;
      const result = this.toolRoundResult(options.threadId, state.toolPlan[nextRound]);
      onEvent?.({ type: "tool_submit_required", toolCalls: result.toolCalls });
      return result;
    }

    this.threads.delete(options.threadId);
    return this.completionResult(options.threadId, state.finalHints, onEvent);
  }

  async cancelRun(): Promise<void> {
    // Nothing to do: mock calls resolve synchronously/in-process.
  }

  async createAssistant(options: CreateAssistantOptions): Promise<AssistantRecord> {
    const id = mockAssistantId(options.name);
    const record: AssistantRecord = {
      assistantId: id,
      name: options.name,
      systemPrompt: options.systemPrompt ?? null,
      createdAt: new Date().toISOString(),
    };
    this.assistants.set(id, record);
    return record;
  }

  async listAssistants(): Promise<AssistantRecord[]> {
    return Array.from(this.assistants.values());
  }

  async updateAssistant(
    assistantId: string,
    options: Partial<CreateAssistantOptions>,
  ): Promise<AssistantRecord> {
    const existing = this.assistants.get(assistantId);
    if (!existing) {
      throw new Error(`Mock assistant ${assistantId} not found`);
    }
    const updated: AssistantRecord = {
      ...existing,
      name: options.name ?? existing.name,
      systemPrompt: options.systemPrompt ?? existing.systemPrompt,
    };
    this.assistants.set(assistantId, updated);
    return updated;
  }

  async uploadAssistantDocument(
    _assistantId: string,
    filename: string,
    _content: string,
    _mimeType: string,
  ): Promise<UploadDocumentResult> {
    return { documentId: generateId("mock-doc"), filename, status: "indexed" };
  }

  async getDocumentStatus(): Promise<{ status: string }> {
    return { status: "indexed" };
  }

  async listModels(filter?: ListModelsFilter): Promise<ModelCapability[]> {
    const catalog: ModelCapability[] = [
      {
        name: "gpt-4o",
        provider: "openai",
        modelType: "llm",
        contextLimit: 128000,
        supportsTools: true,
        supportsThinking: false,
        supportsJsonOutput: true,
      },
      {
        name: "o3",
        provider: "openai",
        modelType: "llm",
        contextLimit: 200000,
        supportsTools: true,
        supportsThinking: true,
        supportsJsonOutput: true,
      },
      {
        name: "claude-sonnet-4-20250514",
        provider: "anthropic",
        modelType: "llm",
        contextLimit: 200000,
        supportsTools: true,
        supportsThinking: true,
        supportsJsonOutput: true,
      },
      {
        name: "gemini-2.5-pro",
        provider: "google",
        modelType: "llm",
        contextLimit: 1000000,
        supportsTools: true,
        supportsThinking: true,
        supportsJsonOutput: true,
      },
    ];
    return catalog.filter((model) => {
      if (filter?.modelType && model.modelType !== filter.modelType) return false;
      if (filter?.supportsTools !== undefined && model.supportsTools !== filter.supportsTools) return false;
      if (filter?.supportsThinking !== undefined && model.supportsThinking !== filter.supportsThinking) {
        return false;
      }
      if (
        filter?.supportsJsonOutput !== undefined &&
        model.supportsJsonOutput !== filter.supportsJsonOutput
      ) {
        return false;
      }
      return true;
    });
  }

  async listMemories(assistantId: string): Promise<MemoryRecord[]> {
    return this.memories.get(assistantId) ?? [];
  }

  async addMemory(assistantId: string, content: string): Promise<MemoryRecord> {
    const record: MemoryRecord = {
      id: generateId("mock-memory"),
      content,
      score: null,
      createdAt: new Date().toISOString(),
    };
    const existing = this.memories.get(assistantId) ?? [];
    this.memories.set(assistantId, [...existing, record]);
    return record;
  }

  async searchMemories(assistantId: string, query: string, limit = 10): Promise<MemoryRecord[]> {
    const existing = this.memories.get(assistantId) ?? [];
    const lowerQuery = query.toLowerCase();
    return existing
      .filter((memory) => memory.content.toLowerCase().includes(lowerQuery))
      .slice(0, limit);
  }

  async updateMemory(assistantId: string, memoryId: string, content: string): Promise<MemoryRecord> {
    const existing = this.memories.get(assistantId) ?? [];
    const updated = existing.map((memory) =>
      memory.id === memoryId ? { ...memory, content } : memory,
    );
    this.memories.set(assistantId, updated);
    const found = updated.find((memory) => memory.id === memoryId);
    if (!found) {
      throw new Error(`Mock memory ${memoryId} not found for assistant ${assistantId}`);
    }
    return found;
  }

  async deleteMemory(assistantId: string, memoryId: string): Promise<void> {
    const existing = this.memories.get(assistantId) ?? [];
    this.memories.set(assistantId, existing.filter((memory) => memory.id !== memoryId));
  }

  async resetMemories(assistantId: string): Promise<void> {
    this.memories.set(assistantId, []);
  }
}
