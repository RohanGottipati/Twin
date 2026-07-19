import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";

import {
  ASSISTANT_ROSTER,
  INTENT_BUNDLES,
  MODEL_PROFILES,
  PRINCIPLED_CITY_BUNDLE,
  TECHTO_ASSISTANT_KEYS,
  getAssistantRole,
  listAssistantRoles,
  selectAssistantsForIntent,
  selectAssistantBundle,
} from "@/lib/backboard/assistants";
import { TOOL_DEFINITIONS } from "@/lib/backboard/tools";
import { FLAGSHIP_SCENARIO_ID } from "@/data/transit/scenarios";

const OLD_SPECIALIST_KEYS = [
  "problem-definition",
  "passenger-arrival",
  "subway-scheduling",
  "mode-shift",
  "concert-event",
  "demand-mobility-analyst",
  "transit-network-planner",
  "events-incidents-agent",
  "simulation-optimization-agent",
];

describe("ASSISTANT_ROSTER principled city department", () => {
  it("has exactly 11 unique principled role keys", () => {
    expect(TECHTO_ASSISTANT_KEYS).toHaveLength(11);
    expect(Object.keys(ASSISTANT_ROSTER)).toHaveLength(11);
    expect(new Set(Object.keys(ASSISTANT_ROSTER)).size).toBe(11);
    for (const key of TECHTO_ASSISTANT_KEYS) {
      expect(ASSISTANT_ROSTER[key]).toBeDefined();
    }
  });

  it("has unique TechTO names and no GridTwin or battery roles", () => {
    const names = Object.values(ASSISTANT_ROSTER).map((role) => role.name);
    expect(new Set(names).size).toBe(11);
    for (const role of Object.values(ASSISTANT_ROSTER)) {
      expect(role.name).toMatch(/^TechTO —/);
      expect(role.name).not.toMatch(/gridtwin/i);
      expect(role.name).not.toMatch(/battery/i);
    }
  });

  it("does not keep niche one-use-case specialist keys", () => {
    for (const key of OLD_SPECIALIST_KEYS) {
      expect(ASSISTANT_ROSTER[key as keyof typeof ASSISTANT_ROSTER]).toBeUndefined();
    }
  });

  it("every system prompt carries the shared guard", () => {
    for (const role of Object.values(ASSISTANT_ROSTER)) {
      expect(role.systemPrompt).toContain("You must never represent simulated citizen reactions as real public opinion.");
      expect(role.systemPrompt).toContain("You must never reveal private chain-of-thought.");
    }
  });

  it("assigns only valid tools and existing knowledge documents", () => {
    for (const role of Object.values(ASSISTANT_ROSTER)) {
      for (const tool of role.toolNames) {
        expect(TOOL_DEFINITIONS[tool]).toBeDefined();
      }
      for (const doc of role.knowledgeDocuments) {
        expect(existsSync(path.join(process.cwd(), doc.repoPath))).toBe(true);
      }
    }
  });

  it("uses valid model profiles and memory policies", () => {
    expect(ASSISTANT_ROSTER["adversarial-reviewer"].memory).toBe("off");
    expect(ASSISTANT_ROSTER["city-copilot"].memory).toBe("Readonly");
    expect(ASSISTANT_ROSTER["final-policy-judge"].modelRequirement).toEqual(MODEL_PROFILES.RISK_REASONING);
    expect(getAssistantRole("final-policy-judge").name).toContain("Final Policy Judge");
    expect(listAssistantRoles()).toHaveLength(11);
  });

  it("assigns evidence-safe ROI analysis to the feasibility role", () => {
    const prompt = ASSISTANT_ROSTER.feasibility.systemPrompt;
    expect(prompt).toContain("validated monetized benefits");
    expect(prompt).toContain("lifecycle costs");
    expect(prompt).toContain("Never invent a return");
  });

  it("OPEN_CITY_ASK uses the full principled bundle", () => {
    expect(selectAssistantsForIntent("OPEN_CITY_ASK")).toEqual([...PRINCIPLED_CITY_BUNDLE]);
  });
});

describe("intent bundles", () => {
  it("keeps simple navigation to 3 or fewer assistants", () => {
    expect(selectAssistantsForIntent("SIMPLE_MAP_NAVIGATION").length).toBeLessThanOrEqual(3);
  });

  it("open city and station asks share the same principled agents", () => {
    expect(selectAssistantsForIntent("OPEN_CITY_ASK")).toEqual(
      selectAssistantsForIntent("NEW_STATION_LOCATION"),
    );
    expect(selectAssistantsForIntent("OPEN_CITY_ASK")).toContain("scenario-designer");
    expect(selectAssistantsForIntent("OPEN_CITY_ASK")).toContain("citizen-response");
  });

  it("maps the flagship scenario to a full planning bundle", () => {
    const bundle = selectAssistantBundle(FLAGSHIP_SCENARIO_ID);
    expect(bundle.length).toBeGreaterThanOrEqual(11);
    expect(bundle).toContain("final-policy-judge");
    expect(bundle).toContain("adversarial-reviewer");
  });

  it("exposes every intent bundle as unique keys from the roster", () => {
    for (const [intent, bundle] of Object.entries(INTENT_BUNDLES)) {
      expect(new Set(bundle).size).toBe(bundle.length);
      for (const key of bundle) {
        expect(ASSISTANT_ROSTER[key], intent).toBeDefined();
      }
    }
  });
});
