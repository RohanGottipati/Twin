import { z } from "zod";

import {
  isInsideToronto,
  torontoScopeViolationMessage,
} from "@/lib/twinto/toronto-scope";

/**
 * Allowlisted MapLibre actions the Explanation / Map Action agent may emit.
 * The frontend validates with Zod and remains the final executor.
 * Coordinates must fall inside the City of Toronto.
 */

const lonLat = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);

/** Non-secret map context attached to City Copilot turns (§3.3). */
export const mapChatContextSchema = z
  .object({
    cityId: z.literal("toronto"),
    viewport: z
      .object({
        longitude: z.number().min(-180).max(180),
        latitude: z.number().min(-90).max(90),
        zoom: z.number().min(0).max(22),
        bounds: z.tuple([z.number(), z.number(), z.number(), z.number()]),
      })
      .strict(),
    selectedRouteId: z.string().nullable(),
    selectedStopId: z.string().nullable(),
    selectedNeighbourhoodId: z.string().nullable(),
    activeScenarioId: z.string().nullable(),
    activeSimulationId: z.string().nullable(),
    simulationTime: z.string().nullable(),
    visibleLayers: z.array(z.string()).max(40),
    comparisonMode: z.enum(["baseline", "candidate", "difference"]),
  })
  .strict();

export type MapChatContext = z.output<typeof mapChatContextSchema>;

export const mapActionSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("fly_to_center"),
      center: lonLat,
      zoom: z.number().min(8).max(20),
      durationMs: z.number().int().min(0).max(10_000),
    })
    .strict(),
  z
    .object({
      type: z.literal("fit_bounds"),
      bounds: z.tuple([z.number(), z.number(), z.number(), z.number()]),
      padding: z.number().min(0).max(200),
      durationMs: z.number().int().min(0).max(10_000),
    })
    .strict(),
  z
    .object({
      type: z.literal("highlight_neighbourhoods"),
      neighbourhoodIds: z.array(z.string().min(1)).min(1).max(20),
    })
    .strict(),
  z
    .object({
      type: z.literal("show_candidate_markers"),
      candidates: z
        .array(
          z
            .object({
              candidateId: z.string().min(1),
              coordinates: lonLat,
              rank: z.number().int().positive(),
              label: z.string().min(1).max(120),
            })
            .strict(),
        )
        .min(1)
        .max(20),
    })
    .strict(),
  z
    .object({
      type: z.literal("show_route_overlay"),
      routeGeoJsonId: z.string().min(1).max(80),
    })
    .strict(),
  z
    .object({
      type: z.literal("show_accessibility_area"),
      geometryId: z.string().min(1).max(80),
    })
    .strict(),
  z
    .object({
      type: z.literal("set_layer_visibility"),
      layerId: z.string().min(1).max(80),
      visible: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal("select_candidate"),
      candidateId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("open_panel"),
      panel: z.enum([
        "candidate_details",
        "policy_comparison",
        "citizen_reactions",
        "evidence",
        "stress_tests",
      ]),
    })
    .strict(),
]);

export type MapAction = z.output<typeof mapActionSchema>;

export const mapActionListSchema = z.array(mapActionSchema).max(30);

export type MapActionParseResult =
  | { ok: true; actions: MapAction[] }
  | { ok: false; rejected: unknown[]; errors: string[] };

function torontoGeoErrors(action: MapAction): string[] {
  const errors: string[] = [];
  if (action.type === "fly_to_center") {
    const [lng, lat] = action.center;
    if (!isInsideToronto(lng, lat)) errors.push(torontoScopeViolationMessage(lng, lat));
  }
  if (action.type === "fit_bounds") {
    const [west, south, east, north] = action.bounds;
    const corners: Array<[number, number]> = [
      [west, south],
      [east, south],
      [east, north],
      [west, north],
    ];
    for (const [lng, lat] of corners) {
      if (!isInsideToronto(lng, lat)) {
        errors.push(torontoScopeViolationMessage(lng, lat));
        break;
      }
    }
  }
  if (action.type === "show_candidate_markers") {
    for (const candidate of action.candidates) {
      const [lng, lat] = candidate.coordinates;
      if (!isInsideToronto(lng, lat)) {
        errors.push(
          `Candidate "${candidate.candidateId}": ${torontoScopeViolationMessage(lng, lat)}`,
        );
      }
    }
  }
  return errors;
}

/**
 * Validates a list of proposed map actions. Unknown, invalid, or non-Toronto
 * geography is rejected; valid Toronto actions still apply.
 */
export function parseMapActions(input: unknown): MapActionParseResult {
  if (!Array.isArray(input)) {
    return { ok: false, rejected: [input], errors: ["Map actions payload must be an array."] };
  }
  const actions: MapAction[] = [];
  const rejected: unknown[] = [];
  const errors: string[] = [];
  for (const item of input) {
    const parsed = mapActionSchema.safeParse(item);
    if (!parsed.success) {
      rejected.push(item);
      errors.push(parsed.error.issues.map((i) => i.message).join("; "));
      continue;
    }
    const geoErrors = torontoGeoErrors(parsed.data);
    if (geoErrors.length > 0) {
      rejected.push(item);
      errors.push(...geoErrors);
      continue;
    }
    actions.push(parsed.data);
  }
  if (rejected.length > 0 && actions.length === 0) {
    return { ok: false, rejected, errors };
  }
  return { ok: true, actions };
}
