import { z } from "zod";

/** General city edit kinds: no nuclear-/stadium-specific APIs. */
export const cityEditSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("add_poi"),
    id: z.string().min(1),
    label: z.string().min(1),
    lng: z.number(),
    lat: z.number(),
    /** Soft tag for scoring heuristics, e.g. energy | stadium | station | other */
    kind: z.string().default("other"),
  }),
  z.object({
    type: z.literal("close_route"),
    routeRef: z.string().min(1),
    label: z.string().optional(),
  }),
  z.object({
    type: z.literal("add_corridor"),
    id: z.string().min(1),
    label: z.string().min(1),
    alignment: z.array(z.tuple([z.number(), z.number()])).min(2),
    reachKm: z.number().positive().optional(),
  }),
  z.object({
    type: z.literal("set_policy"),
    key: z.string().min(1, "set_policy edit requires a non-empty 'key', e.g. 'parking_levy_pct'."),
    value: z.union([z.number(), z.string(), z.boolean()]),
    label: z.string().optional(),
  }),
  z.object({
    type: z.literal("set_land_use"),
    neighbourhoodCode: z.string().min(1),
    use: z.string().min(1),
    label: z.string().optional(),
  }),
]);

export type CityEdit = z.infer<typeof cityEditSchema>;

export const scenarioPatchSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  rationale: z.string().min(1),
  edits: z.array(cityEditSchema).min(1),
});

export type ScenarioPatch = z.infer<typeof scenarioPatchSchema>;

export function parseScenarioPatch(raw: unknown): ScenarioPatch {
  return scenarioPatchSchema.parse(raw);
}

export function parseScenarioPatches(raw: unknown): ScenarioPatch[] {
  return z.array(scenarioPatchSchema).min(1).parse(raw);
}
