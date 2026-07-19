import { z } from "zod";

import { scenarioPatchSchema } from "@/lib/planner/scenario";

const overlaySchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("point"),
      id: z.string(),
      coordinates: z.tuple([z.number(), z.number()]),
      label: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("line"),
      id: z.string(),
      coordinates: z.array(z.tuple([z.number(), z.number()])),
      label: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("polygon"),
      id: z.string(),
      coordinates: z.array(z.tuple([z.number(), z.number()])),
      label: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("annotation"),
      id: z.string(),
      coordinates: z.tuple([z.number(), z.number()]),
      text: z.string(),
    })
    .strict(),
]);

export const plannerRunBodySchema = z.object({
  question: z.string().min(1),
  patches: z.array(scenarioPatchSchema).optional(),
  seed: z.number().optional(),
  agentOverlays: z.array(overlaySchema).optional(),
  /** Reuse Backboard thread so City Code can follow up / clarify across turns. */
  threadId: z.string().min(1).optional(),
  /** Recent user/assistant turns when the client has local transcript context. */
  history: z
    .array(
      z
        .object({
          role: z.enum(["user", "assistant"]),
          content: z.string().min(1).max(8000),
        })
        .strict(),
    )
    .max(24)
    .optional(),
});

export type PlannerRunBody = z.infer<typeof plannerRunBodySchema>;
