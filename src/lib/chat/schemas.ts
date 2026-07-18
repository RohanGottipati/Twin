import { z } from "zod";

import { mapChatContextSchema } from "@/lib/twinto/map-actions";

export const chatMessageSchema = z
  .object({
    messageId: z.string().min(1),
    role: z.enum(["user", "assistant", "system"]),
    content: z.string().min(1).max(8000),
    recordedAt: z.string().min(1),
    intent: z.string().optional(),
    mapActions: z.array(z.unknown()).optional(),
    planningRunId: z.string().optional(),
  })
  .strict();

export type ChatMessageRecord = z.output<typeof chatMessageSchema>;

export const chatThreadSchema = z
  .object({
    threadId: z.string().min(1),
    cityId: z.literal("toronto"),
    status: z.enum(["active", "archived"]),
    messages: z.array(chatMessageSchema),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .strict();

export type ChatThreadRecord = z.output<typeof chatThreadSchema>;

export const postChatMessageSchema = z
  .object({
    threadId: z.string().min(1).max(120).optional(),
    message: z.string().min(1).max(4000),
    mapContext: mapChatContextSchema.optional(),
    startPlanningRun: z.boolean().optional(),
  })
  .strict();

export type PostChatMessageInput = z.output<typeof postChatMessageSchema>;

export const cityCopilotResponseSchema = z
  .object({
    schemaVersion: z.literal(1),
    messageId: z.string(),
    threadId: z.string(),
    intent: z.array(z.string()),
    answer: z.string(),
    summary: z.string(),
    assumptions: z.array(z.string()),
    limitations: z.array(z.string()),
    mapActions: z.array(z.unknown()),
    suggestedFollowUps: z.array(z.string()),
    startPlanningRun: z.boolean(),
    scenarioId: z.string().nullable(),
  })
  .strict();

export type CityCopilotResponse = z.output<typeof cityCopilotResponseSchema>;
