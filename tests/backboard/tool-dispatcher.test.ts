import { beforeEach, describe, expect, it } from "vitest";

import { getBackboardAdapter, resetBackboardAdapterForTests } from "@/lib/backboard/adapter";
import type { BackboardAdapter, ChatToolCall } from "@/lib/backboard/client";
import { createRunContext, dispatchToolCall, type RunContext } from "@/lib/backboard/tool-dispatcher";
import { TOOL_NAMES } from "@/lib/backboard/tools";
import { FLAGSHIP_SCENARIO_ID, requireScenario } from "@/data/transit/scenarios";
import type { TransitIntervention } from "@/lib/transit/schemas";

const scenario = requireScenario(FLAGSHIP_SCENARIO_ID);

function call(name: string, args: Record<string, unknown>): ChatToolCall {
  return { id: `call-${name}`, name, arguments: args, rawArguments: JSON.stringify(args) };
}

function retimeCandidate(id = "balanced-retime"): TransitIntervention {
  const [first, second] = scenario.baselineDepartures;
  return {
    id,
    label: "Balanced retime",
    actions: [
      { type: "shift_departure_minutes", departureId: first, deltaMinutes: 2 },
      { type: "shift_departure_minutes", departureId: second, deltaMinutes: 1 },
    ],
  };
}

describe("dispatchToolCall: fixture read tools", () => {
  let adapter: BackboardAdapter;
  let context: RunContext;

  beforeEach(() => {
    process.env.BACKBOARD_MOCK_MODE = "true";
    resetBackboardAdapterForTests();
    adapter = getBackboardAdapter();
    context = createRunContext(scenario.id, adapter);
  });

  it("get_network_snapshot returns the synthetic-fixture TTC network", async () => {
    const outcome = await dispatchToolCall(call(TOOL_NAMES.GET_NETWORK_SNAPSHOT, {}), context, "a1");
    expect(outcome.ok).toBe(true);
    expect((outcome.output as { dataMode: string }).dataMode).toBe("synthetic-fixture");
  });

  it("get_route_schedule returns the scenario's baseline departures for its own route", async () => {
    const outcome = await dispatchToolCall(
      call(TOOL_NAMES.GET_ROUTE_SCHEDULE, { routeId: scenario.routeId, scenarioId: scenario.id }),
      context,
      "a1",
    );
    expect(outcome.ok).toBe(true);
    const entries = outcome.output as { departureId: string }[];
    expect(entries.map((entry) => entry.departureId).sort()).toEqual([...scenario.baselineDepartures].sort());
  });

  it("get_departure_loads with no interventionId returns baseline loads", async () => {
    const outcome = await dispatchToolCall(
      call(TOOL_NAMES.GET_DEPARTURE_LOADS, { scenarioId: scenario.id }),
      context,
      "a1",
    );
    expect(outcome.ok).toBe(true);
    const { interventionId, departureLoads } = outcome.output as { interventionId: string | null; departureLoads: unknown[] };
    expect(interventionId).toBeNull();
    expect(departureLoads.length).toBeGreaterThan(0);
  });

  it("get_departure_loads with an unregistered interventionId fails gracefully", async () => {
    const outcome = await dispatchToolCall(
      call(TOOL_NAMES.GET_DEPARTURE_LOADS, { scenarioId: scenario.id, interventionId: "never-registered" }),
      context,
      "a1",
    );
    expect(outcome.ok).toBe(false);
    expect((outcome.output as { error: string }).error).toContain("never-registered");
  });

  it("get_passenger_arrivals returns the scenario's arrival curve", async () => {
    const outcome = await dispatchToolCall(call(TOOL_NAMES.GET_PASSENGER_ARRIVALS, { scenarioId: scenario.id }), context, "a1");
    expect(outcome.ok).toBe(true);
    const { arrivals } = outcome.output as { arrivals: unknown[] };
    expect(arrivals.length).toBe(scenario.arrivalsByMinute.length);
  });

  it("get_origin_destination_flows returns synthetic-fixture flows", async () => {
    const outcome = await dispatchToolCall(call(TOOL_NAMES.GET_OD_FLOWS, { scenarioId: scenario.id }), context, "a1");
    expect(outcome.ok).toBe(true);
    const { flows } = outcome.output as { flows: { dataMode: string }[] };
    expect(flows.length).toBeGreaterThan(0);
    expect(flows.every((flow) => flow.dataMode === "synthetic-fixture")).toBe(true);
  });

  it("get_stop_crowding with no interventionId reports baseline crowding at the scenario's station", async () => {
    const outcome = await dispatchToolCall(
      call(TOOL_NAMES.GET_STOP_CROWDING, { scenarioId: scenario.id }),
      context,
      "a1",
    );
    expect(outcome.ok).toBe(true);
    expect((outcome.output as { stationId: string }).stationId).toBe(scenario.stationId);
  });

  it("get_transfer_demand returns connecting-route demand for the scenario's route", async () => {
    const outcome = await dispatchToolCall(call(TOOL_NAMES.GET_TRANSFER_DEMAND, { scenarioId: scenario.id }), context, "a1");
    expect(outcome.ok).toBe(true);
    expect((outcome.output as { routeId: string }).routeId).toBe(scenario.routeId);
  });

  it("get_delay_history returns synthetic-fixture entries for a known route", async () => {
    const outcome = await dispatchToolCall(call(TOOL_NAMES.GET_DELAY_HISTORY, { routeId: "line-1" }), context, "a1");
    expect(outcome.ok).toBe(true);
    const { history } = outcome.output as { history: { dataMode: string }[] };
    expect(history.length).toBeGreaterThan(0);
  });

  it("get_vehicle_capacity returns a positive number for a known route", async () => {
    const outcome = await dispatchToolCall(call(TOOL_NAMES.GET_VEHICLE_CAPACITY, { routeId: "line-1" }), context, "a1");
    expect(outcome.ok).toBe(true);
    expect((outcome.output as { vehicleCapacity: number }).vehicleCapacity).toBeGreaterThan(0);
  });

  it("get_fleet_availability returns spare-vehicle counts for a known route", async () => {
    const outcome = await dispatchToolCall(call(TOOL_NAMES.GET_FLEET_AVAILABILITY, { routeId: "line-1" }), context, "a1");
    expect(outcome.ok).toBe(true);
    expect((outcome.output as { spareVehicles: number }).spareVehicles).toBeGreaterThanOrEqual(0);
  });

  it("get_neighbourhood_demographics returns synthetic-fixture cohort summaries", async () => {
    const outcome = await dispatchToolCall(call(TOOL_NAMES.GET_DEMOGRAPHICS, { scenarioId: scenario.id }), context, "a1");
    expect(outcome.ok).toBe(true);
    const { demographics } = outcome.output as { demographics: { dataMode: string }[] };
    expect(demographics.length).toBeGreaterThan(0);
  });

  it("get_accessibility_constraints returns the scenario station's accessibility fixture", async () => {
    const outcome = await dispatchToolCall(call(TOOL_NAMES.GET_ACCESSIBILITY, { scenarioId: scenario.id }), context, "a1");
    expect(outcome.ok).toBe(true);
    expect((outcome.output as { stationId: string }).stationId).toBe(scenario.stationId);
  });

  it("get_event_context, get_weather_context, and get_service_incidents all return synthetic-fixture data", async () => {
    const eventOutcome = await dispatchToolCall(call(TOOL_NAMES.GET_EVENT_CONTEXT, {}), context, "a1");
    const weatherOutcome = await dispatchToolCall(call(TOOL_NAMES.GET_WEATHER_CONTEXT, {}), context, "a1");
    const incidentsOutcome = await dispatchToolCall(call(TOOL_NAMES.GET_INCIDENTS, {}), context, "a1");
    expect(eventOutcome.ok).toBe(true);
    expect(weatherOutcome.ok).toBe(true);
    expect(incidentsOutcome.ok).toBe(true);
    expect((incidentsOutcome.output as { incidents: unknown[] }).incidents.length).toBeGreaterThan(0);
  });

  it("find_similar_interventions returns ranked fixture precedent records", async () => {
    const outcome = await dispatchToolCall(call(TOOL_NAMES.FIND_SIMILAR, { limit: 2 }), context, "a1");
    expect(outcome.ok).toBe(true);
    const { records } = outcome.output as { records: unknown[] };
    expect(records.length).toBeGreaterThan(0);
    expect(records.length).toBeLessThanOrEqual(2);
  });
});

describe("dispatchToolCall: intervention lifecycle", () => {
  let adapter: BackboardAdapter;
  let context: RunContext;

  beforeEach(() => {
    process.env.BACKBOARD_MOCK_MODE = "true";
    resetBackboardAdapterForTests();
    adapter = getBackboardAdapter();
    context = createRunContext(scenario.id, adapter);
  });

  it("propose_schedule_variants registers candidates for later reference by id", async () => {
    const candidate = retimeCandidate();
    const outcome = await dispatchToolCall(
      call(TOOL_NAMES.PROPOSE_VARIANTS, { scenarioId: scenario.id, candidates: [candidate] }),
      context,
      "a1",
    );
    expect(outcome.ok).toBe(true);
    expect(context.simulationsByCandidateId.get(candidate.id)?.intervention).toEqual(candidate);
  });

  it("run_transit_simulation records the result for later calculate_* and compare_interventions calls", async () => {
    const candidate = retimeCandidate();
    const outcome = await dispatchToolCall(
      call(TOOL_NAMES.RUN_SIMULATION, { scenarioId: scenario.id, intervention: candidate }),
      context,
      "a1",
    );
    expect(outcome.ok).toBe(true);
    expect(context.simulationsByCandidateId.get(candidate.id)?.visible).toBeDefined();
  });

  it("calculate_wait_metrics, calculate_load_balance, calculate_equity, calculate_accessibility, calculate_operating_cost, and calculate_carbon each simulate on demand and read off the same result", async () => {
    const candidate = retimeCandidate();
    const args = { scenarioId: scenario.id, intervention: candidate };

    const wait = await dispatchToolCall(call(TOOL_NAMES.CALCULATE_WAIT, args), context, "a1");
    const load = await dispatchToolCall(call(TOOL_NAMES.CALCULATE_LOAD, args), context, "a1");
    const equity = await dispatchToolCall(call(TOOL_NAMES.CALCULATE_EQUITY, args), context, "a1");
    const accessibility = await dispatchToolCall(call(TOOL_NAMES.CALCULATE_ACCESSIBILITY, args), context, "a1");
    const cost = await dispatchToolCall(call(TOOL_NAMES.CALCULATE_COST, args), context, "a1");
    const carbon = await dispatchToolCall(call(TOOL_NAMES.CALCULATE_CARBON, args), context, "a1");

    for (const outcome of [wait, load, equity, accessibility, cost, carbon]) {
      expect(outcome.ok).toBe(true);
      expect((outcome.output as { interventionId: string }).interventionId).toBe(candidate.id);
    }
    expect((wait.output as { meanWaitMinutes: number }).meanWaitMinutes).toBeGreaterThanOrEqual(0);
    expect((cost.output as { operatingCostScore: number }).operatingCostScore).toBeGreaterThanOrEqual(0);
  });

  it("stress_test_intervention reveals worse outcomes under the concert-surge overlay", async () => {
    const candidate = retimeCandidate();
    const args = { scenarioId: scenario.id, intervention: candidate };
    await dispatchToolCall(call(TOOL_NAMES.RUN_SIMULATION, args), context, "a1");
    const outcome = await dispatchToolCall(call(TOOL_NAMES.STRESS_TEST, args), context, "a1");

    expect(outcome.ok).toBe(true);
    const result = outcome.output as { baseline: { metrics: { deniedBoardings: number } }; stressed: { metrics: { deniedBoardings: number } } };
    expect(result.stressed.metrics.deniedBoardings).toBeGreaterThanOrEqual(result.baseline.metrics.deniedBoardings);
  });

  it("compare_interventions ranks simulated candidates and rejects one that was never simulated", async () => {
    const [first] = scenario.baselineDepartures;
    const idle: TransitIntervention = {
      id: "idle",
      label: "No-op baseline",
      actions: [{ type: "shift_departure_minutes", departureId: first, deltaMinutes: 0 }],
    };
    const retimed = retimeCandidate();

    await dispatchToolCall(call(TOOL_NAMES.RUN_SIMULATION, { scenarioId: scenario.id, intervention: idle }), context, "a1");
    await dispatchToolCall(call(TOOL_NAMES.RUN_SIMULATION, { scenarioId: scenario.id, intervention: retimed }), context, "a1");

    const rankOutcome = await dispatchToolCall(
      call(TOOL_NAMES.COMPARE_POLICIES, { scenarioId: scenario.id, interventionIds: ["idle", retimed.id] }),
      context,
      "a1",
    );
    expect(rankOutcome.ok).toBe(true);
    const { ranked } = rankOutcome.output as { ranked: { interventionId: string }[] };
    expect(ranked.map((r) => r.interventionId).sort()).toEqual(["idle", retimed.id].sort());

    const badOutcome = await dispatchToolCall(
      call(TOOL_NAMES.COMPARE_POLICIES, { scenarioId: scenario.id, interventionIds: ["idle", "never-simulated"] }),
      context,
      "a1",
    );
    expect(badOutcome.ok).toBe(false);
    expect((badOutcome.output as { error: string }).error).toContain("never-simulated");
  });

  it("save_policy_iteration appends to the run's iteration history", async () => {
    const candidate = retimeCandidate();
    const outcome = await dispatchToolCall(
      call(TOOL_NAMES.SAVE_ITERATION, {
        scenarioId: scenario.id,
        intervention: candidate,
        iterationLabel: "iteration-1",
        notes: "initial retiming",
      }),
      context,
      "a1",
    );
    expect(outcome.ok).toBe(true);
    expect(context.iterations).toHaveLength(1);
    expect(context.iterations[0].iterationLabel).toBe("iteration-1");
  });
});

describe("dispatchToolCall: citizen reaction, memory, and errors", () => {
  let adapter: BackboardAdapter;
  let context: RunContext;

  beforeEach(() => {
    process.env.BACKBOARD_MOCK_MODE = "true";
    resetBackboardAdapterForTests();
    adapter = getBackboardAdapter();
    context = createRunContext(scenario.id, adapter);
  });

  it("call_citizen_reaction_model returns a simulated batch labeled provider: mock", async () => {
    const outcome = await dispatchToolCall(
      call(TOOL_NAMES.CALL_CITIZEN_MODEL, {
        scenarioId: scenario.id,
        intervention: { id: "retime", title: "Retime departure", description: "Shift later.", category: "transit" },
        cohorts: [{ cohortId: "downtown-commuters", populationWeight: 10 }],
        context: { wait: { beforeMinutes: 6, afterMinutes: 5 } },
      }),
      context,
      "a1",
    );
    expect(outcome.ok).toBe(true);
    expect((outcome.output as { provider: string }).provider).toBe("mock");
  });

  it("aggregate_citizen_reactions computes population-weighted acceptance from an explicit reaction batch", async () => {
    const outcome = await dispatchToolCall(
      call(TOOL_NAMES.AGGREGATE_REACTIONS, {
        scenarioId: scenario.id,
        reactions: [
          { cohortId: "downtown-commuters", acceptance: 0.8, modeShiftProb: 0.1, preferredDepartureShiftMinutes: 0, rationale: "fine", confidence: 0.7 },
          { cohortId: "seniors", acceptance: 0.2, modeShiftProb: 0.2, preferredDepartureShiftMinutes: 5, rationale: "bad", confidence: 0.6 },
        ],
      }),
      context,
      "a1",
    );
    expect(outcome.ok).toBe(true);
    const { aggregate } = outcome.output as { aggregate: { cohortCount: number; meanAcceptance: number } };
    expect(aggregate.cohortCount).toBe(2);
    expect(aggregate.meanAcceptance).toBeCloseTo(0.5, 5);
  });

  it("retrieve_policy_documents never throws even when no matching knowledge document exists", async () => {
    const outcome = await dispatchToolCall(call(TOOL_NAMES.RETRIEVE_DOCUMENTS, { query: "zzz-nonsense-query-zzz" }), context, "a1");
    expect(outcome.ok).toBe(true);
    expect((outcome.output as { excerpts: unknown[] }).excerpts).toEqual([]);
  });

  it("write_approved_memory persists via the adapter and returns a memoryId", async () => {
    const outcome = await dispatchToolCall(
      call(TOOL_NAMES.WRITE_MEMORY, { memory: "Operators prefer retiming over capacity boosts for this station." }),
      context,
      "assistant-1",
    );
    expect(outcome.ok).toBe(true);
    expect((outcome.output as { memoryId: string }).memoryId).toBeTruthy();
    const memories = await adapter.listMemories("assistant-1");
    expect(memories).toHaveLength(1);
  });

  it("create_training_examples fails gracefully for an interventionId that was never simulated", async () => {
    const outcome = await dispatchToolCall(
      call(TOOL_NAMES.CREATE_TRAINING, { scenarioId: scenario.id, interventionId: "never-simulated", label: "example-set" }),
      context,
      "a1",
    );
    expect(outcome.ok).toBe(false);
  });

  it("returns a graceful error for malformed arguments instead of throwing", async () => {
    const outcome = await dispatchToolCall(call(TOOL_NAMES.GET_ROUTE_SCHEDULE, {}), context, "a1");
    expect(outcome.ok).toBe(false);
    expect((outcome.output as { error: string }).error).toBeTruthy();
  });

  it("returns a graceful error for an unknown tool name rather than throwing", async () => {
    const outcome = await dispatchToolCall(call("delete_the_transit_network", {}), context, "a1");
    expect(outcome.ok).toBe(false);
    expect((outcome.output as { error: string }).error).toContain("Unknown tool");
  });
});
