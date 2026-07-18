import type { ChatToolDefinition } from "@/lib/backboard/client";

/**
 * Canonical tool names shared by assistant definitions (which tools an
 * assistant is offered) and the tool dispatcher (which TwinTO transit
 * function each name executes). Keeping this as a const object (not a plain
 * string union) lets both sides import the same runtime values. See
 * docs/twinto-implementation.md section 13.6 for the canonical catalogue.
 */
export const TOOL_NAMES = {
  GET_NETWORK_SNAPSHOT: "get_network_snapshot",
  GET_ROUTE_SCHEDULE: "get_route_schedule",
  GET_DEPARTURE_LOADS: "get_departure_loads",
  GET_PASSENGER_ARRIVALS: "get_passenger_arrivals",
  GET_OD_FLOWS: "get_origin_destination_flows",
  GET_STOP_CROWDING: "get_stop_crowding",
  GET_TRANSFER_DEMAND: "get_transfer_demand",
  GET_DELAY_HISTORY: "get_delay_history",
  GET_VEHICLE_CAPACITY: "get_vehicle_capacity",
  GET_FLEET_AVAILABILITY: "get_fleet_availability",
  GET_DEMOGRAPHICS: "get_neighbourhood_demographics",
  GET_ACCESSIBILITY: "get_accessibility_constraints",
  GET_EVENT_CONTEXT: "get_event_context",
  GET_WEATHER_CONTEXT: "get_weather_context",
  GET_INCIDENTS: "get_service_incidents",
  FIND_SIMILAR: "find_similar_interventions",
  PROPOSE_VARIANTS: "propose_schedule_variants",
  CALL_CITIZEN_MODEL: "call_citizen_reaction_model",
  AGGREGATE_REACTIONS: "aggregate_citizen_reactions",
  RUN_SIMULATION: "run_transit_simulation",
  CALCULATE_WAIT: "calculate_wait_metrics",
  CALCULATE_LOAD: "calculate_load_balance",
  CALCULATE_RELIABILITY: "calculate_reliability",
  CALCULATE_EQUITY: "calculate_equity",
  CALCULATE_ACCESSIBILITY: "calculate_accessibility",
  CALCULATE_COST: "calculate_operating_cost",
  CALCULATE_CARBON: "calculate_carbon",
  STRESS_TEST: "stress_test_intervention",
  COMPARE_POLICIES: "compare_interventions",
  SAVE_ITERATION: "save_policy_iteration",
  RETRIEVE_DOCUMENTS: "retrieve_policy_documents",
  WRITE_MEMORY: "write_approved_memory",
  CREATE_TRAINING: "create_training_examples",
} as const;

export type ToolName = (typeof TOOL_NAMES)[keyof typeof TOOL_NAMES];

const scenarioIdParameter = {
  type: "string" as const,
  description: 'Transit scenario id, e.g. "departure-406-412".',
};

const interventionIdParameter = {
  type: "string" as const,
  description: 'Intervention id previously proposed via propose_schedule_variants, e.g. "conservative".',
};

const scenarioOnlyParameters = {
  type: "object" as const,
  properties: {
    scenarioId: scenarioIdParameter,
  },
  required: ["scenarioId"],
};

const interventionActionSchemaProperty = {
  type: "object",
  description: "One discriminated-union action within an intervention. Set exactly one action shape per entry, matching `type`.",
  properties: {
    type: {
      type: "string",
      enum: [
        "shift_departure_minutes",
        "add_trip",
        "capacity_boost",
        "entrance_closure",
        "hold_departure",
        "retime_feeder",
      ],
      description: "Which action shape this entry uses.",
    },
    departureId: { type: "string", description: "Scheduled departure clock time this action targets, e.g. '16:06'. Used by shift_departure_minutes, capacity_boost, hold_departure." },
    deltaMinutes: { type: "number", description: "Minutes to shift a departure by, positive or negative, in [-30, 30]. Used by shift_departure_minutes." },
    afterDepartureId: { type: "string", description: "Departure this new trip is inserted after. Used by add_trip." },
    offsetMinutes: { type: "number", description: "Minutes after afterDepartureId the new trip departs, in [1, 30]. Used by add_trip." },
    vehicleCapacity: { type: "number", description: "Seated+standing capacity of the added vehicle. Used by add_trip." },
    extraCapacity: { type: "number", description: "Additional capacity added to an existing departure. Used by capacity_boost." },
    stationId: { type: "string", description: "Station id this action targets, e.g. 'union'. Used by entrance_closure." },
    entranceId: { type: "string", description: "Entrance id at the station. Used by entrance_closure." },
    capacityReductionFraction: { type: "number", description: "Fraction in [0, 1] of entrance throughput removed. Used by entrance_closure." },
    holdMinutes: { type: "number", description: "Minutes to hold a departure at the platform before dispatch, in [0, 10]. Used by hold_departure." },
    routeId: { type: "string", description: "Connecting route id this action targets, e.g. 'streetcar-501'. Used by retime_feeder." },
  },
  required: ["type"],
};

const interventionSchemaProperty = {
  type: "object",
  description: "A candidate schedule intervention: a short id, label, and one or more discrete actions.",
  properties: {
    id: { type: "string", description: "Short, unique, memorable id for this candidate, e.g. 'conservative'." },
    label: { type: "string", description: "Human-readable label for this intervention." },
    description: { type: "string", description: "One or two sentence description of the intervention's intent." },
    actions: {
      type: "array",
      description: "One to ten discrete actions that together make up this intervention.",
      items: interventionActionSchemaProperty,
    },
  },
  required: ["id", "label", "actions"],
};

const interventionEvaluationParameters = {
  type: "object" as const,
  properties: {
    scenarioId: scenarioIdParameter,
    intervention: interventionSchemaProperty,
  },
  required: ["scenarioId", "intervention"],
};

const cohortDemographicsSchemaProperty = {
  type: "object",
  description: "Optional demographic attributes for a cohort; leave fields unset when unknown.",
  properties: {
    ageBand: { type: "string", enum: ["youth", "adult", "senior"] },
    incomeBand: { type: "string", enum: ["low", "middle", "high"] },
    householdType: { type: "string" },
    primaryMode: { type: "string", enum: ["transit", "car", "walk", "bike", "other"] },
    hasDisability: { type: "boolean" },
  },
  required: [],
};

const citizenCohortSchemaProperty = {
  type: "object",
  description: "One census-weighted rider cohort to condition the citizen reaction model on.",
  properties: {
    cohortId: { type: "string", description: "Cohort id, e.g. 'downtown-commuters' or 'accessibility-users'." },
    label: { type: "string" },
    populationWeight: { type: "number", description: "Relative population weight for aggregation; not used per-reaction." },
    homeNeighborhood: { type: "string" },
    demographics: cohortDemographicsSchemaProperty,
  },
  required: ["cohortId"],
};

const citizenModelInterventionSchemaProperty = {
  type: "object",
  description: "The intervention being reacted to.",
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    description: { type: "string" },
    category: { type: "string", enum: ["transit", "road", "zoning", "tax", "parks", "housing", "other"] },
  },
  required: ["title", "description"],
};

const citizenReactionContextSchemaProperty = {
  type: "object",
  description: "Deterministic before/after effect-graph features computed by the simulator for this intervention. Only include the blocks that actually changed.",
  properties: {
    wait: {
      type: "object",
      properties: {
        beforeMinutes: { type: "number" },
        afterMinutes: { type: "number" },
      },
      required: ["beforeMinutes", "afterMinutes"],
    },
    crowding: {
      type: "object",
      properties: {
        beforeIndex: { type: "number" },
        afterIndex: { type: "number" },
      },
      required: ["beforeIndex", "afterIndex"],
    },
    transfer: {
      type: "object",
      properties: {
        beforeCount: { type: "number" },
        afterCount: { type: "number" },
      },
      required: ["beforeCount", "afterCount"],
    },
    price: {
      type: "object",
      properties: {
        beforeCad: { type: "number" },
        afterCad: { type: "number" },
      },
      required: ["beforeCad", "afterCad"],
    },
    accessibility: {
      type: "object",
      properties: {
        beforeScore: { type: "number" },
        afterScore: { type: "number" },
      },
      required: ["beforeScore", "afterScore"],
    },
    event: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["construction", "closure", "service_change", "fare_change", "other"] },
        description: { type: "string" },
      },
      required: ["description"],
    },
  },
  required: [],
};

export const TOOL_DEFINITIONS: Record<ToolName, ChatToolDefinition> = {
  [TOOL_NAMES.GET_NETWORK_SNAPSHOT]: {
    name: TOOL_NAMES.GET_NETWORK_SNAPSHOT,
    description:
      "Fetch the synthetic-fixture TTC network snapshot: stations, routes (subway, streetcar, bus), stops, and their positions, elevator/accessible-entrance flags, and nominal capacities. Always synthetic-fixture data, never a live GTFS feed.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  [TOOL_NAMES.GET_ROUTE_SCHEDULE]: {
    name: TOOL_NAMES.GET_ROUTE_SCHEDULE,
    description:
      "Fetch a route's nominal headway and the scenario's baseline scheduled departure times for the relevant station.",
    parameters: {
      type: "object",
      properties: {
        routeId: { type: "string", description: "Route id, e.g. 'line-1', 'streetcar-501', 'bus-6a'." },
        scenarioId: scenarioIdParameter,
      },
      required: ["routeId", "scenarioId"],
    },
  },
  [TOOL_NAMES.GET_DEPARTURE_LOADS]: {
    name: TOOL_NAMES.GET_DEPARTURE_LOADS,
    description:
      "Fetch per-departure boarding load results (capacity, boarded, denied, load factor) for a scenario, optionally re-computed under a candidate intervention.",
    parameters: {
      type: "object",
      properties: {
        scenarioId: scenarioIdParameter,
        interventionId: { ...interventionIdParameter, description: "Optional; omit to see baseline loads with no intervention applied." },
      },
      required: ["scenarioId"],
    },
  },
  [TOOL_NAMES.GET_PASSENGER_ARRIVALS]: {
    name: TOOL_NAMES.GET_PASSENGER_ARRIVALS,
    description:
      "Fetch the scenario's minute-by-minute passenger arrival curve at the platform or stop, used to identify surge windows ahead of a departure.",
    parameters: scenarioOnlyParameters,
  },
  [TOOL_NAMES.GET_OD_FLOWS]: {
    name: TOOL_NAMES.GET_OD_FLOWS,
    description:
      "Fetch approximate origin-destination zone flows for the scenario's affected cohorts: which home zones feed which destination zones through the affected station or stop.",
    parameters: scenarioOnlyParameters,
  },
  [TOOL_NAMES.GET_STOP_CROWDING]: {
    name: TOOL_NAMES.GET_STOP_CROWDING,
    description:
      "Fetch the platform or stop queue-length trace over the scenario window, optionally re-computed under a candidate intervention, to assess platform crowding and safety margin.",
    parameters: {
      type: "object",
      properties: {
        scenarioId: scenarioIdParameter,
        interventionId: { ...interventionIdParameter, description: "Optional; omit to see baseline crowding with no intervention applied." },
      },
      required: ["scenarioId"],
    },
  },
  [TOOL_NAMES.GET_TRANSFER_DEMAND]: {
    name: TOOL_NAMES.GET_TRANSFER_DEMAND,
    description:
      "Fetch the volume of riders transferring between the primary route and each connecting route at the scenario's station, used to check missed-transfer risk from a schedule change.",
    parameters: scenarioOnlyParameters,
  },
  [TOOL_NAMES.GET_DELAY_HISTORY]: {
    name: TOOL_NAMES.GET_DELAY_HISTORY,
    description:
      "Fetch recent synthetic-fixture delay and bunching history for a route, used to characterize reliability risk independent of any single scenario.",
    parameters: {
      type: "object",
      properties: {
        routeId: { type: "string", description: "Route id, e.g. 'line-1', 'streetcar-501', 'bus-6a'." },
      },
      required: ["routeId"],
    },
  },
  [TOOL_NAMES.GET_VEHICLE_CAPACITY]: {
    name: TOOL_NAMES.GET_VEHICLE_CAPACITY,
    description: "Fetch the nominal seated-plus-standing vehicle capacity for a route.",
    parameters: {
      type: "object",
      properties: {
        routeId: { type: "string", description: "Route id, e.g. 'line-1', 'streetcar-501', 'bus-6a'." },
      },
      required: ["routeId"],
    },
  },
  [TOOL_NAMES.GET_FLEET_AVAILABILITY]: {
    name: TOOL_NAMES.GET_FLEET_AVAILABILITY,
    description:
      "Fetch how many spare vehicles and crews are available on a route at short notice, used to check whether an add_trip or capacity_boost action is operationally feasible.",
    parameters: {
      type: "object",
      properties: {
        routeId: { type: "string", description: "Route id, e.g. 'line-1', 'streetcar-501', 'bus-6a'." },
      },
      required: ["routeId"],
    },
  },
  [TOOL_NAMES.GET_DEMOGRAPHICS]: {
    name: TOOL_NAMES.GET_DEMOGRAPHICS,
    description:
      "Fetch the census-weighted synthetic rider cohorts affected by a scenario: home/destination zones, income and age bands, mobility needs, and sensitivity priors. Never a real Statistics Canada extract; illustrative weights for this demo only.",
    parameters: scenarioOnlyParameters,
  },
  [TOOL_NAMES.GET_ACCESSIBILITY]: {
    name: TOOL_NAMES.GET_ACCESSIBILITY,
    description:
      "Fetch accessibility constraints relevant to a scenario's station(s): elevator presence, alternate accessible entrances, and which cohorts have mobility needs that make an entrance closure or added walking distance a hard failure rather than an inconvenience.",
    parameters: scenarioOnlyParameters,
  },
  [TOOL_NAMES.GET_EVENT_CONTEXT]: {
    name: TOOL_NAMES.GET_EVENT_CONTEXT,
    description:
      "Fetch the synthetic-fixture concert/event, weather, and service-incident bundle relevant to the flagship extenuating-circumstances stress test (a Scotiabank Arena concert near Union station). Never a live events feed.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  [TOOL_NAMES.GET_WEATHER_CONTEXT]: {
    name: TOOL_NAMES.GET_WEATHER_CONTEXT,
    description:
      "Fetch the synthetic-fixture weather condition affecting rider walking and waiting tolerance (e.g. heavy rain reducing willingness to walk to an alternate entrance). Never a live forecast.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  [TOOL_NAMES.GET_INCIDENTS]: {
    name: TOOL_NAMES.GET_INCIDENTS,
    description:
      "Fetch synthetic-fixture active service incidents (signal problems, mechanical failures, medical emergencies, power outages) by route, with delay minutes and affected stations. Never a live incident feed.",
    parameters: {
      type: "object",
      properties: {
        routeId: { type: "string", description: "Optional route id to filter incidents to, e.g. 'line-1'." },
      },
      required: [],
    },
  },
  [TOOL_NAMES.FIND_SIMILAR]: {
    name: TOOL_NAMES.FIND_SIMILAR,
    description:
      "Retrieve illustrative past-intervention precedent records similar to an intervention type or tag set, to ground planning in precedent. These are demo fixtures, never a real TTC service-change archive.",
    parameters: {
      type: "object",
      properties: {
        interventionType: {
          type: "string",
          description: "Optional action type to match, e.g. 'shift_departure_minutes', 'add_trip', 'entrance_closure'.",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Optional tags to match, e.g. ['subway', 'peak', 'load-imbalance'].",
        },
        limit: { type: "number", description: "Maximum records to return (default 3)." },
      },
      required: [],
    },
  },
  [TOOL_NAMES.PROPOSE_VARIANTS]: {
    name: TOOL_NAMES.PROPOSE_VARIANTS,
    description:
      "Register 2-3 candidate schedule-intervention variants for a scenario so downstream tools (simulation, citizen reaction, ranking) can reference them by id in the same run. This does not simulate anything itself; call run_transit_simulation separately per candidate.",
    parameters: {
      type: "object",
      properties: {
        scenarioId: scenarioIdParameter,
        candidates: {
          type: "array",
          description: "2-3 distinct candidate interventions exploring genuinely different strategies.",
          items: interventionSchemaProperty,
        },
      },
      required: ["scenarioId", "candidates"],
    },
  },
  [TOOL_NAMES.CALL_CITIZEN_MODEL]: {
    name: TOOL_NAMES.CALL_CITIZEN_MODEL,
    description:
      "Call the citizen reaction model for a batch of cohorts against a specific intervention and its deterministic before/after effect features. Returns one legible, per-cohort rationale plus an acceptance reading derived from that rationale. This is always a SIMULATED reaction, never real public opinion, and must be labeled as such wherever it is surfaced.",
    parameters: {
      type: "object",
      properties: {
        scenarioId: scenarioIdParameter,
        intervention: citizenModelInterventionSchemaProperty,
        cohorts: {
          type: "array",
          description: "1-500 cohorts to generate reactions for.",
          items: citizenCohortSchemaProperty,
        },
        context: citizenReactionContextSchemaProperty,
      },
      required: ["scenarioId", "intervention", "cohorts", "context"],
    },
  },
  [TOOL_NAMES.AGGREGATE_REACTIONS]: {
    name: TOOL_NAMES.AGGREGATE_REACTIONS,
    description:
      "Deterministically aggregate a batch of per-cohort citizen reactions (from call_citizen_reaction_model) into population-weighted summary statistics: mean/median/population-weighted acceptance, mode-shift probability, and accept/neutral/reject counts. Never recompute these by hand; always call this tool.",
    parameters: {
      type: "object",
      properties: {
        scenarioId: scenarioIdParameter,
        reactions: {
          type: "array",
          description: "The exact per-cohort reaction objects returned by call_citizen_reaction_model for this intervention.",
          items: {
            type: "object",
            properties: {
              cohortId: { type: "string" },
              acceptance: { type: "number" },
              modeShiftProb: { type: "number" },
              preferredDepartureShiftMinutes: { type: "number" },
              rationale: { type: "string" },
              confidence: { type: "number" },
            },
            required: ["cohortId", "acceptance", "modeShiftProb", "preferredDepartureShiftMinutes", "rationale", "confidence"],
          },
        },
      },
      required: ["scenarioId", "reactions"],
    },
  },
  [TOOL_NAMES.RUN_SIMULATION]: {
    name: TOOL_NAMES.RUN_SIMULATION,
    description:
      "Run the deterministic transit queue/boarding simulator for a candidate intervention against a scenario's VISIBLE conditions only. Returns violations, per-departure loads, the platform queue trace, and the full transit metrics bundle (wait, load imbalance, denied boardings, missed transfers, carbon, accessibility failures, equity gap, operating cost). This never reveals hidden stress-overlay conditions; use stress_test_intervention for that.",
    parameters: interventionEvaluationParameters,
  },
  [TOOL_NAMES.CALCULATE_WAIT]: {
    name: TOOL_NAMES.CALCULATE_WAIT,
    description:
      "Deterministically compute mean and p90 wait-time metrics from a simulation's departure loads and queue trace. Always call this rather than estimating wait times yourself.",
    parameters: interventionEvaluationParameters,
  },
  [TOOL_NAMES.CALCULATE_LOAD]: {
    name: TOOL_NAMES.CALCULATE_LOAD,
    description:
      "Deterministically compute the load-imbalance metric across consecutive departures for a candidate intervention: how unevenly boardings are distributed relative to an ideal balanced split.",
    parameters: interventionEvaluationParameters,
  },
  [TOOL_NAMES.CALCULATE_RELIABILITY]: {
    name: TOOL_NAMES.CALCULATE_RELIABILITY,
    description:
      "Deterministically compute a reliability and bunching score for a candidate intervention, combining scenario delay history with any hold/retime actions the intervention introduces.",
    parameters: interventionEvaluationParameters,
  },
  [TOOL_NAMES.CALCULATE_EQUITY]: {
    name: TOOL_NAMES.CALCULATE_EQUITY,
    description:
      "Deterministically compute the equity gap metric: how outcomes for vulnerable cohorts (mobility-device users, low-income transit-dependent riders, seniors) differ from the full population under a candidate intervention.",
    parameters: interventionEvaluationParameters,
  },
  [TOOL_NAMES.CALCULATE_ACCESSIBILITY]: {
    name: TOOL_NAMES.CALCULATE_ACCESSIBILITY,
    description:
      "Deterministically compute accessibility-failure counts for a candidate intervention: entrance closures without an alternate accessible entrance, added walking distance, or capacity changes that fail a hard accessibility check.",
    parameters: interventionEvaluationParameters,
  },
  [TOOL_NAMES.CALCULATE_COST]: {
    name: TOOL_NAMES.CALCULATE_COST,
    description:
      "Deterministically compute the operating-cost score for a candidate intervention (added vehicle-hours, crew, and fleet strain from add_trip or capacity_boost actions).",
    parameters: interventionEvaluationParameters,
  },
  [TOOL_NAMES.CALCULATE_CARBON]: {
    name: TOOL_NAMES.CALCULATE_CARBON,
    description:
      "Deterministically compute the estimated carbon impact of a candidate intervention, from estimated car-trip mode shift avoided or induced against added service carbon cost.",
    parameters: interventionEvaluationParameters,
  },
  [TOOL_NAMES.STRESS_TEST]: {
    name: TOOL_NAMES.STRESS_TEST,
    description:
      "Re-run the deterministic simulator against the SAME candidate intervention under a scenario's hidden stress overlay (event surge, entrance closure, departure delay, connecting delay) that was withheld during planning. Use this to check whether an intervention that looks safe on visible data survives extenuating circumstances. Call this only after run_transit_simulation has already run for the same interventionId.",
    parameters: {
      type: "object",
      properties: {
        scenarioId: scenarioIdParameter,
        intervention: interventionSchemaProperty,
        stressOverlayId: {
          type: "string",
          description: "Stress overlay id to apply, e.g. 'concert-surge-scotiabank'. Omit to use the scenario's default overlay if one exists.",
        },
      },
      required: ["scenarioId", "intervention"],
    },
  },
  [TOOL_NAMES.COMPARE_POLICIES]: {
    name: TOOL_NAMES.COMPARE_POLICIES,
    description:
      "Deterministically rank previously-simulated candidate interventions by a weighted combination of wait, crowding, reliability, equity, carbon, and operating-cost metrics. Candidates that failed validation are automatically disqualified regardless of score. Each interventionId must already have been simulated via run_transit_simulation earlier in this same conversation.",
    parameters: {
      type: "object",
      properties: {
        scenarioId: scenarioIdParameter,
        interventionIds: {
          type: "array",
          items: { type: "string" },
          description: "Intervention ids to rank, in any order.",
        },
      },
      required: ["scenarioId", "interventionIds"],
    },
  },
  [TOOL_NAMES.SAVE_ITERATION]: {
    name: TOOL_NAMES.SAVE_ITERATION,
    description:
      "Persist one planning iteration (scenario, candidate intervention, simulation result, and citizen-reaction summary) to the run history so later agents and the operator can review how the plan evolved across iterations.",
    parameters: {
      type: "object",
      properties: {
        scenarioId: scenarioIdParameter,
        intervention: interventionSchemaProperty,
        iterationLabel: { type: "string", description: "Short label for this iteration, e.g. 'iteration-2: added hold at 16:06'." },
        notes: { type: "string", description: "Why this iteration was produced and what changed from the previous one." },
      },
      required: ["scenarioId", "intervention", "iterationLabel"],
    },
  },
  [TOOL_NAMES.RETRIEVE_DOCUMENTS]: {
    name: TOOL_NAMES.RETRIEVE_DOCUMENTS,
    description:
      "Retrieve relevant excerpts from the uploaded policy and methodology knowledge documents (TTC network primer, scheduling methodology, accessibility policy, equity evaluation, safety rules, and related documents) for a query, with citations back to the source document.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to search for, e.g. 'minimum reserve headway during a platform crowding event'." },
        limit: { type: "number", description: "Maximum excerpts to return (default 5)." },
      },
      required: ["query"],
    },
  },
  [TOOL_NAMES.WRITE_MEMORY]: {
    name: TOOL_NAMES.WRITE_MEMORY,
    description:
      "Explicitly write an operator-approved lesson or preference to curated long-term memory. Use ONLY for content an operator has actually approved in this run; never write an unreviewed model output or a raw simulated citizen reaction as if it were a durable fact.",
    parameters: {
      type: "object",
      properties: {
        memory: { type: "string", description: "The approved lesson or preference to persist, written as a durable, standalone statement." },
        scenarioId: { type: "string", description: "Optional scenario id this memory is scoped to." },
        tags: { type: "array", items: { type: "string" }, description: "Optional tags for later retrieval." },
      },
      required: ["memory"],
    },
  },
  [TOOL_NAMES.CREATE_TRAINING]: {
    name: TOOL_NAMES.CREATE_TRAINING,
    description:
      "Package a completed, human-reviewed planning run (scenario, intervention, simulation result, citizen-reaction summary, and final recommendation) into training example rows for later SFT/GRPO use, per AGENTS.md section 5. Only call this on runs that have already been reviewed; never on an in-progress or rejected run.",
    parameters: {
      type: "object",
      properties: {
        scenarioId: scenarioIdParameter,
        interventionId: interventionIdParameter,
        label: { type: "string", description: "Short label for this training example set, e.g. 'flagship-approved-hold-plus-boost'." },
      },
      required: ["scenarioId", "interventionId", "label"],
    },
  },
};

export function getToolDefinitions(names: ToolName[]): ChatToolDefinition[] {
  return names.map((name) => TOOL_DEFINITIONS[name]);
}
