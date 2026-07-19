import { assertServerOnly, getBackboardBaseUrl, requireBackboardApiKey } from "@/lib/backboard/env";
import type {
  AddMemoryResponseWire,
  AssistantWire,
  BackboardMemoryModeWire,
  BackboardSseEventWire,
  BackboardThinkingConfigWire,
  BackboardToolDefinitionWire,
  BackboardWebSearchModeWire,
  CreateAssistantRequestWire,
  DocumentWire,
  MemoriesListResponseWire,
  MemorySearchResponseWire,
  MemoryWire,
  ModelWire,
  ModelsListResponseWire,
  SendMessageRequestWire,
  SubmitToolOutputsRequestWire,
} from "@/lib/backboard/wire-types";

export class BackboardApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "BackboardApiError";
  }
}

export type ChatRunStatus =
  | "completed"
  | "requires_action"
  | "in_progress"
  | "failed"
  | "cancelled"
  | "unknown";

export interface ChatToolParameterSchema {
  type: string;
  description?: string;
  enum?: string[];
  properties?: Record<string, unknown>;
  items?: Record<string, unknown>;
}

export interface ChatToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, ChatToolParameterSchema>;
    required?: string[];
  };
}

export interface ChatToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  rawArguments: string;
}

export interface ThinkingConfig {
  effort?: "low" | "medium" | "high" | "max";
  budgetTokens?: number;
  maxTokens?: number;
  excludeReasoning?: boolean;
}

export type MemoryMode = BackboardMemoryModeWire;
export type WebSearchMode = BackboardWebSearchModeWire;

export interface RetrievedMemory {
  id: string;
  memory: string;
  score: number;
}

export interface ChatRunResult {
  threadId: string;
  runId: string | null;
  assistantId: string | null;
  status: ChatRunStatus;
  content: string | null;
  reasoning: string | null;
  toolCalls: ChatToolCall[];
  modelProvider: string | null;
  modelName: string | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  retrievedMemories: RetrievedMemory[];
}

export type BackboardStreamEvent =
  | { type: "content_delta"; content: string }
  | { type: "reasoning_delta"; content: string }
  | { type: "reasoning_ended" }
  | { type: "tool_submit_required"; toolCalls: ChatToolCall[] }
  | { type: "run_ended"; status: ChatRunStatus };

export type StreamEventHandler = (event: BackboardStreamEvent) => void;

export interface SendMessageOptions {
  assistantId: string;
  threadId?: string;
  content: string;
  systemPrompt?: string;
  llmProvider?: string;
  modelName?: string;
  tools?: ChatToolDefinition[];
  thinking?: ThinkingConfig;
  memory?: MemoryMode;
  webSearch?: WebSearchMode;
  jsonOutput?: boolean;
  metadata?: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface SubmitToolOutputsOptions {
  threadId: string;
  outputs: { toolCallId: string; output: string }[];
  signal?: AbortSignal;
}

export interface CreateAssistantOptions {
  name: string;
  systemPrompt?: string;
  tools?: ChatToolDefinition[];
  topK?: number;
}

export interface AssistantRecord {
  assistantId: string;
  name: string;
  systemPrompt: string | null;
  createdAt: string;
}

export interface UploadDocumentResult {
  documentId: string;
  filename: string;
  status: string;
}

export interface ListModelsFilter {
  modelType?: "llm" | "embedding" | "image";
  supportsTools?: boolean;
  supportsThinking?: boolean;
  supportsJsonOutput?: boolean;
}

export interface ModelCapability {
  name: string;
  provider: string;
  modelType: string;
  contextLimit: number;
  supportsTools: boolean;
  supportsThinking: boolean;
  supportsJsonOutput: boolean;
}

export interface MemoryRecord {
  id: string;
  content: string;
  score: number | null;
  createdAt: string | null;
}

/**
 * Ergonomic, camelCase interface every part of the app codes against.
 * Live RestBackboardAdapter only; requires BACKBOARD_API_KEY.
 */
export interface BackboardAdapter {
  readonly mode: "live";
  sendMessage(options: SendMessageOptions, onEvent?: StreamEventHandler): Promise<ChatRunResult>;
  submitToolOutputs(
    options: SubmitToolOutputsOptions,
    onEvent?: StreamEventHandler,
  ): Promise<ChatRunResult>;
  cancelRun(threadId: string, runId: string): Promise<void>;
  createAssistant(options: CreateAssistantOptions): Promise<AssistantRecord>;
  listAssistants(): Promise<AssistantRecord[]>;
  updateAssistant(assistantId: string, options: Partial<CreateAssistantOptions>): Promise<AssistantRecord>;
  deleteAssistant(assistantId: string): Promise<void>;
  uploadAssistantDocument(
    assistantId: string,
    filename: string,
    content: string,
    mimeType: string,
  ): Promise<UploadDocumentResult>;
  getDocumentStatus(documentId: string): Promise<{ status: string }>;
  listModels(filter?: ListModelsFilter): Promise<ModelCapability[]>;
  listMemories(assistantId: string): Promise<MemoryRecord[]>;
  addMemory(assistantId: string, content: string, metadata?: Record<string, unknown>): Promise<MemoryRecord>;
  searchMemories(assistantId: string, query: string, limit?: number): Promise<MemoryRecord[]>;
  updateMemory(assistantId: string, memoryId: string, content: string): Promise<MemoryRecord>;
  deleteMemory(assistantId: string, memoryId: string): Promise<void>;
  resetMemories(assistantId: string): Promise<void>;
}

function toWireTools(tools?: ChatToolDefinition[]): BackboardToolDefinitionWire[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: "object",
        properties: tool.parameters.properties,
        required: tool.parameters.required,
      },
    },
  }));
}

function toWireThinking(thinking?: ThinkingConfig): BackboardThinkingConfigWire | undefined {
  if (!thinking) return undefined;
  const wire: BackboardThinkingConfigWire = {};
  if (thinking.effort) wire.effort = thinking.effort;
  if (thinking.budgetTokens !== undefined) wire.budget_tokens = thinking.budgetTokens;
  if (thinking.maxTokens !== undefined) wire.max_tokens = thinking.maxTokens;
  if (thinking.excludeReasoning !== undefined) wire.exclude_reasoning = thinking.excludeReasoning;
  return wire;
}

/**
 * Case-insensitive: the synchronous message-response endpoint documents
 * upper-case statuses (e.g. "COMPLETED"), but the live SSE `run_ended` event
 * sends lower-case ("completed"). Handle both.
 */
function mapRunStatus(status: string | null | undefined): ChatRunStatus {
  switch (status?.toUpperCase()) {
    case "COMPLETED":
      return "completed";
    case "REQUIRES_ACTION":
      return "requires_action";
    case "IN_PROGRESS":
      return "in_progress";
    case "FAILED":
      return "failed";
    case "CANCELLED":
      return "cancelled";
    default:
      return "unknown";
  }
}

function parseToolArguments(rawArguments: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(rawArguments || "{}");
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function mapToolCall(wire: { id: string; function: { name: string; arguments: string } }): ChatToolCall {
  return {
    id: wire.id,
    name: wire.function.name,
    arguments: parseToolArguments(wire.function.arguments),
    rawArguments: wire.function.arguments,
  };
}

/** First non-empty string among candidates (empty string is not usable content). */
export function firstNonEmptyText(
  ...candidates: Array<string | null | undefined>
): string | null {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate;
    }
  }
  return null;
}

/** Accumulates SSE chunks from /threads/messages or /threads/tool-outputs into one ChatRunResult. */
export class StreamAccumulator {
  private content = "";
  private reasoning = "";
  private toolCalls: ChatToolCall[] = [];
  private status: ChatRunStatus = "in_progress";
  private threadId: string;
  private runId: string | null = null;
  private assistantId: string | null = null;
  private modelProvider: string | null = null;
  private modelName: string | null = null;
  private inputTokens = 0;
  private outputTokens = 0;
  private totalTokens = 0;

  constructor(threadIdHint: string) {
    this.threadId = threadIdHint;
  }

  /** Returns true when the caller should stop reading (a terminal event arrived). */
  handle(event: BackboardSseEventWire, onEvent?: StreamEventHandler): boolean {
    switch (event.type) {
      case "user_message": {
        const wire = event as Extract<BackboardSseEventWire, { type: "user_message" }>;
        this.threadId = wire.thread_id;
        return false;
      }
      case "run_started": {
        const wire = event as Extract<BackboardSseEventWire, { type: "run_started" }>;
        this.runId = wire.run_id ?? this.runId;
        this.modelProvider = wire.provider ?? this.modelProvider;
        this.modelName = wire.model_name ?? this.modelName;
        return false;
      }
      case "content_streaming": {
        const wire = event as {
          content?: string;
          accumulated_content?: string;
        };
        // Prefer snapshot when present: some providers send full text in
        // accumulated_content and leave content empty or as a tiny delta.
        const snapshot = firstNonEmptyText(wire.accumulated_content);
        if (snapshot) {
          const delta = snapshot.startsWith(this.content)
            ? snapshot.slice(this.content.length)
            : (firstNonEmptyText(wire.content) ?? snapshot);
          this.content = snapshot;
          if (delta) onEvent?.({ type: "content_delta", content: delta });
        } else {
          const delta = wire.content ?? "";
          if (delta) {
            this.content += delta;
            onEvent?.({ type: "content_delta", content: delta });
          }
        }
        return false;
      }
      case "reasoning_streaming": {
        const delta = (event as { content?: string }).content ?? "";
        this.reasoning += delta;
        onEvent?.({ type: "reasoning_delta", content: delta });
        return false;
      }
      case "reasoning_ended":
        onEvent?.({ type: "reasoning_ended" });
        return false;
      case "tool_submit_required": {
        const wire = event as Extract<BackboardSseEventWire, { type: "tool_submit_required" }>;
        this.runId = wire.run_id ?? this.runId;
        this.toolCalls = wire.tool_calls.map(mapToolCall);
        this.status = "requires_action";
        this.inputTokens = wire.input_tokens ?? this.inputTokens;
        this.outputTokens = wire.output_tokens ?? this.outputTokens;
        this.totalTokens = wire.total_tokens ?? this.totalTokens;
        onEvent?.({ type: "tool_submit_required", toolCalls: this.toolCalls });
        return true;
      }
      case "run_ended": {
        const wire = event as Extract<BackboardSseEventWire, { type: "run_ended" }>;
        this.status = mapRunStatus(wire.status);
        // Prefer final_content; never let empty-string `content` hide it
        // (`"" ?? final` is "" because ?? only skips null/undefined).
        const ended = firstNonEmptyText(wire.final_content, wire.content);
        if (ended) this.content = ended;
        if (wire.reasoning) this.reasoning = wire.reasoning;
        this.modelProvider = wire.model_provider ?? this.modelProvider;
        this.modelName = wire.model_name ?? this.modelName;
        this.inputTokens = wire.input_tokens ?? this.inputTokens;
        this.outputTokens = wire.output_tokens ?? this.outputTokens;
        this.totalTokens = wire.total_tokens ?? this.totalTokens;
        onEvent?.({ type: "run_ended", status: this.status });
        return true;
      }
      case "error": {
        // Backboard sometimes ends the stream with {type:"error"} and no run_ended
        // (e.g. billing: "Free credits cannot be used for LLM chat").
        const msg =
          (event as { error?: string; message?: string }).error ||
          (event as { message?: string }).message ||
          "Backboard stream error";
        this.status = "failed";
        throw new BackboardApiError(msg, 402);
      }
      default:
        return false;
    }
  }

  finalize(): ChatRunResult {
    return {
      threadId: this.threadId,
      runId: this.runId,
      assistantId: this.assistantId,
      status: this.status,
      content: this.content.length > 0 ? this.content : null,
      reasoning: this.reasoning.length > 0 ? this.reasoning : null,
      toolCalls: this.toolCalls,
      modelProvider: this.modelProvider,
      modelName: this.modelName,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      totalTokens: this.totalTokens,
      retrievedMemories: [],
    };
  }
}

async function consumeSseStream(
  response: Response,
  accumulator: StreamAccumulator,
  onEvent?: StreamEventHandler,
): Promise<void> {
  if (!response.body) {
    throw new BackboardApiError("Backboard streaming response had no body.", response.status);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload) continue;
        let parsed: BackboardSseEventWire;
        try {
          parsed = JSON.parse(payload) as BackboardSseEventWire;
        } catch {
          continue;
        }
        const stop = accumulator.handle(parsed, onEvent);
        if (stop) {
          await reader.cancel().catch(() => undefined);
          return;
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // already released
    }
  }
}

export class RestBackboardAdapter implements BackboardAdapter {
  readonly mode = "live" as const;

  private baseUrl(): string {
    return getBackboardBaseUrl();
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    assertServerOnly("RestBackboardAdapter");
    return { "X-API-Key": requireBackboardApiKey(), ...extra };
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const response = await fetch(`${this.baseUrl()}${path}`, init);
    if (!response.ok && response.status !== 422) {
      const bodyText = await response.text().catch(() => "");
      throw new BackboardApiError(
        `Backboard API ${init.method ?? "GET"} ${path} failed with ${response.status}`,
        response.status,
        bodyText,
      );
    }
    return response;
  }

  async sendMessage(options: SendMessageOptions, onEvent?: StreamEventHandler): Promise<ChatRunResult> {
    const body: SendMessageRequestWire = {
      content: options.content,
      thread_id: options.threadId,
      assistant_id: options.assistantId,
      system_prompt: options.systemPrompt,
      llm_provider: options.llmProvider,
      model_name: options.modelName,
      stream: true,
      tools: toWireTools(options.tools),
      thinking: toWireThinking(options.thinking),
      memory: options.memory,
      web_search: options.webSearch,
      json_output: options.jsonOutput,
      metadata: options.metadata ? JSON.stringify(options.metadata) : undefined,
    };
    const response = await this.request("/threads/messages", {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
      signal: options.signal,
    });
    if (response.status === 422) {
      const errorBody = await response.text().catch(() => "");
      throw new BackboardApiError("Backboard rejected the message payload (422).", 422, errorBody);
    }
    const accumulator = new StreamAccumulator(options.threadId ?? "");
    await consumeSseStream(response, accumulator, onEvent);
    return accumulator.finalize();
  }

  async submitToolOutputs(
    options: SubmitToolOutputsOptions,
    onEvent?: StreamEventHandler,
  ): Promise<ChatRunResult> {
    const body: SubmitToolOutputsRequestWire = {
      thread_id: options.threadId,
      tool_outputs: options.outputs.map((o) => ({ tool_call_id: o.toolCallId, output: o.output })),
      stream: true,
    };
    const response = await this.request("/threads/tool-outputs", {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
      signal: options.signal,
    });
    if (response.status === 422) {
      const errorBody = await response.text().catch(() => "");
      throw new BackboardApiError("Backboard rejected the tool outputs payload (422).", 422, errorBody);
    }
    const accumulator = new StreamAccumulator(options.threadId);
    await consumeSseStream(response, accumulator, onEvent);
    return accumulator.finalize();
  }

  async cancelRun(threadId: string, runId: string): Promise<void> {
    await this.request(`/threads/${threadId}/runs/${runId}/cancel`, {
      method: "POST",
      headers: this.headers(),
    });
  }

  async createAssistant(options: CreateAssistantOptions): Promise<AssistantRecord> {
    const body: CreateAssistantRequestWire = {
      name: options.name,
      system_prompt: options.systemPrompt,
      tools: toWireTools(options.tools),
      tok_k: options.topK,
    };
    const response = await this.request("/assistants", {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    });
    const wire = (await response.json()) as AssistantWire;
    return mapAssistant(wire);
  }

  async listAssistants(): Promise<AssistantRecord[]> {
    const response = await this.request("/assistants?limit=200", {
      method: "GET",
      headers: this.headers(),
    });
    const wire = (await response.json()) as AssistantWire[];
    return wire.map(mapAssistant);
  }

  async updateAssistant(
    assistantId: string,
    options: Partial<CreateAssistantOptions>,
  ): Promise<AssistantRecord> {
    const body: Partial<CreateAssistantRequestWire> = {
      name: options.name,
      system_prompt: options.systemPrompt,
      tools: toWireTools(options.tools),
      tok_k: options.topK,
    };
    const response = await this.request(`/assistants/${assistantId}`, {
      method: "PUT",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    });
    const wire = (await response.json()) as AssistantWire;
    return mapAssistant(wire);
  }

  async deleteAssistant(assistantId: string): Promise<void> {
    await this.request(`/assistants/${assistantId}`, {
      method: "DELETE",
      headers: this.headers(),
    });
  }

  async uploadAssistantDocument(
    assistantId: string,
    filename: string,
    content: string,
    mimeType: string,
  ): Promise<UploadDocumentResult> {
    const form = new FormData();
    form.append("file", new Blob([content], { type: mimeType }), filename);
    const response = await this.request(`/assistants/${assistantId}/documents`, {
      method: "POST",
      headers: this.headers(),
      body: form,
    });
    const wire = (await response.json()) as DocumentWire;
    return { documentId: wire.document_id, filename: wire.filename, status: wire.status };
  }

  async getDocumentStatus(documentId: string): Promise<{ status: string }> {
    const response = await this.request(`/documents/${documentId}/status`, {
      method: "GET",
      headers: this.headers(),
    });
    const wire = (await response.json()) as DocumentWire;
    return { status: wire.status };
  }

  async listModels(filter?: ListModelsFilter): Promise<ModelCapability[]> {
    const params = new URLSearchParams();
    params.set("limit", "200");
    if (filter?.modelType) params.set("model_type", filter.modelType);
    if (filter?.supportsTools !== undefined) params.set("supports_tools", String(filter.supportsTools));
    if (filter?.supportsThinking !== undefined) params.set("supports_thinking", String(filter.supportsThinking));
    if (filter?.supportsJsonOutput !== undefined) {
      params.set("supports_json_output", String(filter.supportsJsonOutput));
    }
    const response = await this.request(`/models?${params.toString()}`, {
      method: "GET",
      headers: this.headers(),
    });
    const wire = (await response.json()) as ModelsListResponseWire;
    return wire.models.map(mapModel);
  }

  async listMemories(assistantId: string): Promise<MemoryRecord[]> {
    const response = await this.request(`/assistants/${assistantId}/memories?page_size=100`, {
      method: "GET",
      headers: this.headers(),
    });
    const wire = (await response.json()) as MemoriesListResponseWire;
    return wire.memories.map(mapMemory);
  }

  async addMemory(
    assistantId: string,
    content: string,
    metadata?: Record<string, unknown>,
  ): Promise<MemoryRecord> {
    const response = await this.request(`/assistants/${assistantId}/memories`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ content, metadata }),
    });
    const wire = (await response.json()) as AddMemoryResponseWire;
    return {
      id: wire.memory_id,
      content: wire.content,
      score: null,
      createdAt: null,
    };
  }

  async searchMemories(assistantId: string, query: string, limit = 10): Promise<MemoryRecord[]> {
    const response = await this.request(`/assistants/${assistantId}/memories/search`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ query, limit }),
    });
    const wire = (await response.json()) as MemorySearchResponseWire;
    return wire.memories.map(mapMemory);
  }

  async updateMemory(assistantId: string, memoryId: string, content: string): Promise<MemoryRecord> {
    const response = await this.request(`/assistants/${assistantId}/memories/${memoryId}`, {
      method: "PUT",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ content }),
    });
    const wire = (await response.json()) as MemoryWire;
    return mapMemory(wire);
  }

  async deleteMemory(assistantId: string, memoryId: string): Promise<void> {
    await this.request(`/assistants/${assistantId}/memories/${memoryId}`, {
      method: "DELETE",
      headers: this.headers(),
    });
  }

  async resetMemories(assistantId: string): Promise<void> {
    await this.request(`/assistants/${assistantId}/memories`, {
      method: "DELETE",
      headers: this.headers(),
    });
  }
}

function mapAssistant(wire: AssistantWire): AssistantRecord {
  return {
    assistantId: wire.assistant_id,
    name: wire.name,
    systemPrompt: wire.system_prompt ?? null,
    createdAt: wire.created_at,
  };
}

function mapModel(wire: ModelWire): ModelCapability {
  return {
    name: wire.name,
    provider: wire.provider,
    modelType: wire.model_type,
    contextLimit: wire.context_limit,
    supportsTools: wire.supports_tools ?? false,
    supportsThinking: wire.supports_thinking ?? false,
    supportsJsonOutput: wire.supports_json_output ?? false,
  };
}

function mapMemory(wire: MemoryWire): MemoryRecord {
  return {
    id: wire.id,
    content: wire.content,
    score: wire.score ?? null,
    createdAt: wire.created_at ?? null,
  };
}
