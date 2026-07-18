import { describe, expect, it } from "vitest";

import { ASSISTANT_ROSTER } from "@/lib/backboard/assistants";
import { TOOL_DEFINITIONS, TOOL_NAMES, getToolDefinitions, type ToolName } from "@/lib/backboard/tools";

const BATTERY_TOOL_NAMES = [
  "get_asset_spec",
  "get_market_window",
  "get_renewable_forecast",
  "get_similar_scenarios",
  "validate_dispatch_plan",
  "simulate_dispatch_plan",
  "stress_test_dispatch_plan",
  "rank_dispatch_candidates",
  "recall_operator_notes",
];

describe("TOOL_NAMES", () => {
  it("never carries a battery/GridTwin tool name", () => {
    const values = Object.values(TOOL_NAMES);
    for (const batteryName of BATTERY_TOOL_NAMES) {
      expect(values).not.toContain(batteryName);
    }
  });

  it("has a unique wire name for every constant", () => {
    const values = Object.values(TOOL_NAMES);
    expect(new Set(values).size).toBe(values.length);
  });

  it("uses transit-domain tool names", () => {
    expect(TOOL_NAMES.RUN_SIMULATION).toBe("run_transit_simulation");
    expect(TOOL_NAMES.CALL_CITIZEN_MODEL).toBe("call_citizen_reaction_model");
    expect(TOOL_NAMES.GET_DEMOGRAPHICS).toBe("get_neighbourhood_demographics");
  });
});

describe("TOOL_DEFINITIONS", () => {
  it("has a definition for every TOOL_NAMES entry, keyed by its own name", () => {
    const names = Object.values(TOOL_NAMES);
    expect(Object.keys(TOOL_DEFINITIONS).sort()).toEqual([...names].sort());
    for (const name of names) {
      expect(TOOL_DEFINITIONS[name as ToolName].name).toBe(name);
    }
  });

  it("gives every definition a non-empty description and a JSON-schema-shaped parameters object", () => {
    for (const definition of Object.values(TOOL_DEFINITIONS)) {
      expect(definition.description.length).toBeGreaterThan(10);
      expect(definition.parameters.type).toBe("object");
      expect(definition.parameters.properties).toBeTypeOf("object");
    }
  });

  it("getToolDefinitions returns definitions in the requested order", () => {
    const defs = getToolDefinitions([TOOL_NAMES.RUN_SIMULATION, TOOL_NAMES.CALCULATE_WAIT]);
    expect(defs.map((d) => d.name)).toEqual([TOOL_NAMES.RUN_SIMULATION, TOOL_NAMES.CALCULATE_WAIT]);
  });
});

describe("every assistant role's declared tools resolve to a real tool definition", () => {
  it("has no role referencing an unknown tool name", () => {
    for (const role of Object.values(ASSISTANT_ROSTER)) {
      for (const toolName of role.toolNames) {
        expect(TOOL_DEFINITIONS[toolName]).toBeDefined();
      }
    }
  });
});
