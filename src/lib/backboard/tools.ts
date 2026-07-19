import type { ChatToolDefinition } from "@/lib/backboard/client";

/**
 * Canonical tool names shared by assistant definitions (which tools an
 * assistant is offered) and the tool dispatcher (which TechTO transit
 * function each name executes). Keeping this as a const object (not a plain
 * string union) lets both sides import the same runtime values. See
 * docs/techto-implementation.md section 13.6 for the canonical catalogue.
 */
export const TOOL_NAMES = {
  GET_CURRENT_MAP_CONTEXT: "get_current_map_context",
  QUERY_CITY_LAYER: "query_city_layer",
  SEARCH_NEIGHBOURHOODS: "search_neighbourhoods",
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
  GET_TRANSIT_ACCESSIBILITY: "get_transit_accessibility",
  GET_POPULATION_EMPLOYMENT_GROWTH: "get_population_and_employment_growth",
  GET_LAND_USE_CONTEXT: "get_land_use_context",
  GET_ACCESSIBILITY: "get_accessibility_constraints",
  GET_EVENT_CONTEXT: "get_event_context",
  GET_WEATHER_CONTEXT: "get_weather_context",
  GET_INCIDENTS: "get_service_incidents",
  FIND_SIMILAR: "find_similar_interventions",
  GENERATE_STATION_CANDIDATES: "generate_station_candidates",
  PROPOSE_VARIANTS: "propose_schedule_variants",
  CALL_CITIZEN_MODEL: "call_citizen_reaction_model",
  AGGREGATE_REACTIONS: "aggregate_citizen_reactions",
  RUN_SIMULATION: "run_transit_simulation",
  SIMULATE_STATION_CANDIDATE: "simulate_station_candidate",
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
  COMPOSE_MAP_ACTIONS: "compose_map_actions",
  WRITE_MEMORY: "write_approved_memory",
  CREATE_TRAINING: "create_training_examples",
  // general city twin verbs (Claude-Code-for-cities)
  QUERY_TWIN: "query_twin",
  PATCH_TWIN: "patch_twin",
  RUN_TWIN_ANALYSIS: "run_twin_analysis",
  SNAPSHOT_TWIN: "snapshot_twin",
  DIFF_TWIN: "diff_twin",
  PROPOSE_SCENARIOS: "propose_scenarios",
  SCORE_POPULATION: "score_population",
  INVOKE_ASSISTANT: "invoke_assistant",
  RUN_PYTHON: "run_python",
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
  [TOOL_NAMES.GET_CURRENT_MAP_CONTEXT]: {
    name: TOOL_NAMES.GET_CURRENT_MAP_CONTEXT,
    description:
      "Read the current TechTO map context: center, zoom, selected station/neighbourhood, visible layers, and any highlighted candidates. Fixture-backed when no live map state is supplied.",
    parameters: {
      type: "object",
      properties: {
        scenarioId: scenarioIdParameter,
      },
      required: [],
    },
  },
  [TOOL_NAMES.QUERY_CITY_LAYER]: {
    name: TOOL_NAMES.QUERY_CITY_LAYER,
    description:
      "Small, targeted lookup of official Toronto neighbourhood screening features (population, income, TTC proximity). Prefer run_python (pandas over data/processed/census_profile.csv or Mongo) for ranking, filters, joins, or anything returning more than a handful of rows. Use this tool only for a named neighbourhood or a short top-N (limit ≤ 5) with a tight selector. Returns slim rows by default.",
    parameters: {
      type: "object",
      properties: {
        layer: { type: "string", enum: ["neighbourhoods"] },
        selector: {
          type: "object",
          properties: {
            name: { type: "string", description: "Exact or substring neighbourhood name / code." },
            minPopulation: { type: "number" },
            maxMedianIncome: { type: "number" },
            minRapidTransitGapKm: { type: "number" },
          },
        },
        sortBy: {
          type: "string",
          enum: [
            "name",
            "population",
            "medianIncome",
            "populationDensity",
            "rapidTransitGapKm",
            "surfaceTransitDistanceKm",
            "fallbackScore",
          ],
        },
        direction: { type: "string", enum: ["asc", "desc"] },
        limit: {
          type: "number",
          description: "Max rows (default 3, hard max 5). Keep this small; use run_python for bigger screens.",
        },
        detail: {
          type: "string",
          enum: ["summary", "full"],
          description: "summary (default): code/name/center + key metrics only. full: all fields including bounds/provenance.",
        },
      },
      required: ["layer"],
    },
  },
  [TOOL_NAMES.SEARCH_NEIGHBOURHOODS]: {
    name: TOOL_NAMES.SEARCH_NEIGHBOURHOODS,
    description:
      "Search synthetic Toronto neighbourhood fixtures by name, tags, or underserved-after-hours flags. Returns bounded candidate areas with centroids.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Neighbourhood name or free-text query." },
        tags: { type: "array", items: { type: "string" }, description: "Optional tags such as downtown, waterfront, underserved-night." },
        limit: { type: "number", description: "Maximum neighbourhoods to return (default 5)." },
      },
      required: [],
    },
  },
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
  [TOOL_NAMES.GET_TRANSIT_ACCESSIBILITY]: {
    name: TOOL_NAMES.GET_TRANSIT_ACCESSIBILITY,
    description:
      "Summarize transit accessibility for a neighbourhood or station catchment using fixture geometry (walk sheds, elevator coverage). Synthetic-fixture only.",
    parameters: {
      type: "object",
      properties: {
        neighbourhoodId: { type: "string" },
        stationId: { type: "string" },
      },
      required: [],
    },
  },
  [TOOL_NAMES.GET_POPULATION_EMPLOYMENT_GROWTH]: {
    name: TOOL_NAMES.GET_POPULATION_EMPLOYMENT_GROWTH,
    description:
      "Return synthetic population and employment growth proxies for a neighbourhood. Illustrative planning inputs, not official forecasts.",
    parameters: {
      type: "object",
      properties: {
        neighbourhoodId: { type: "string" },
      },
      required: ["neighbourhoodId"],
    },
  },
  [TOOL_NAMES.GET_LAND_USE_CONTEXT]: {
    name: TOOL_NAMES.GET_LAND_USE_CONTEXT,
    description:
      "Return synthetic land-use and corridor context for a neighbourhood (residential mix, employment intensity, event venues).",
    parameters: {
      type: "object",
      properties: {
        neighbourhoodId: { type: "string" },
      },
      required: ["neighbourhoodId"],
    },
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
  [TOOL_NAMES.GENERATE_STATION_CANDIDATES]: {
    name: TOOL_NAMES.GENERATE_STATION_CANDIDATES,
    description:
      "Generate bounded synthetic station or neighbourhood candidates for a planning question. Returns candidate ids, labels, coordinates, and catchment notes. Never invents geometry outside the fixture catalogue.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Planning question or corridor description." },
        limit: { type: "number", description: "Maximum candidates (default 5)." },
      },
      required: ["query"],
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
  [TOOL_NAMES.SIMULATE_STATION_CANDIDATE]: {
    name: TOOL_NAMES.SIMULATE_STATION_CANDIDATE,
    description:
      "Run a lightweight fixture simulation for a generated station/neighbourhood candidate and return proxy wait, access, and demand metrics. Deterministic given seed.",
    parameters: {
      type: "object",
      properties: {
        candidateId: { type: "string" },
        scenarioId: scenarioIdParameter,
        seed: { type: "number" },
      },
      required: ["candidateId"],
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
  [TOOL_NAMES.COMPOSE_MAP_ACTIONS]: {
    name: TOOL_NAMES.COMPOSE_MAP_ACTIONS,
    description:
      "Control the Toronto MapLibre UI: fly_to_center, fit_bounds, highlight_neighbourhoods (use neighbourhood codes), show_candidate_markers, draw_point, draw_line, draw_polygon, annotate, remove_overlays, clear_map_overlays, set_layer_visibility. For a single recommendation, emit exactly one show_candidate_markers entry (the chosen site), fly_to_center on it, and highlight that one neighbourhood. Multiple candidate markers only when the user asked to compare alternatives. Drawing near an existing overlay / twin POI returns a collision error (~40m); remove or move first. Frontend validates and executes; never emit arbitrary JavaScript or URLs.",
    parameters: {
      type: "object",
      properties: {
        actions: {
          type: "array",
          description:
            "Allowlisted MapAction objects. Examples: {type:'fly_to_center',center:[-79.4,43.66],zoom:13,durationMs:800}, {type:'draw_point',id:'opt-a',coordinates:[-79.42,43.68],label:'Wychwood option'}, {type:'annotate',id:'note-1',coordinates:[-79.42,43.68],text:'Higher density'}, {type:'clear_map_overlays',what:'drawings'}.",
          items: { type: "object" },
        },
      },
      required: ["actions"],
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
  [TOOL_NAMES.QUERY_TWIN]: {
    name: TOOL_NAMES.QUERY_TWIN,
    description:
      "Query the in-memory city twin snapshot (pois, corridors, closed routes, policies, land use). General verb; not domain-specific.",
    parameters: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          description: "Optional slice: pois | corridors | closed_routes | policies | land_use | summary",
        },
        neighbourhoodCode: { type: "string", description: "Optional neighbourhood code for land_use queries." },
      },
    },
  },
  [TOOL_NAMES.PATCH_TWIN]: {
    name: TOOL_NAMES.PATCH_TWIN,
    description:
      "Apply a ScenarioPatch (edits: add_poi, close_route, add_corridor, set_policy, set_land_use) to the in-memory twin. Returns the new snapshot version and a diff.",
    parameters: {
      type: "object",
      properties: {
        patch: {
          type: "object",
          description: "ScenarioPatch with id, title, rationale, edits[].",
        },
      },
      required: ["patch"],
    },
  },
  [TOOL_NAMES.RUN_TWIN_ANALYSIS]: {
    name: TOOL_NAMES.RUN_TWIN_ANALYSIS,
    description:
      "Run a named twin analysis (currently: population_score) against the current twin snapshot.",
    parameters: {
      type: "object",
      properties: {
        analysis: {
          type: "string",
          enum: ["population_score"],
          description: "Which analysis to run.",
        },
        question: { type: "string", description: "Planner question conditioning the score." },
        scenarioId: { type: "string", description: "Label for this analysis run." },
        neighbourhoodCodes: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional: restrict real-resident sampling to these neighbourhood codes instead of citywide, to save compute when you only care about specific areas (e.g. the candidates you're comparing).",
        },
      },
      required: ["analysis", "question"],
    },
  },
  [TOOL_NAMES.RUN_PYTHON]: {
    name: TOOL_NAMES.RUN_PYTHON,
    description:
      "Run short Python for screening and analysis (pandas, numpy, scipy, statsmodels, sklearn). Prefer this over query_city_layer for rankings, filters, joins, or multi-row screens. Read-only Mongo as `db`. Injected: TWIN, OVERLAYS, DATA_DIR (data/processed; e.g. census_profile.csv for 158 neighbourhoods). Assign RESULT to a DataFrame/Series/dict for a preview. Toronto data only. No Mongo writes. Print for stdout.",
    parameters: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description:
            "Python source. Example: cols = db.list_collection_names(); print(cols); RESULT = pd.DataFrame({'n':[len(cols)]})",
        },
        timeout_s: {
          type: "number",
          description: "Hard timeout seconds (default 12, max 30).",
        },
      },
      required: ["code"],
    },
  },
  [TOOL_NAMES.SNAPSHOT_TWIN]: {
    name: TOOL_NAMES.SNAPSHOT_TWIN,
    description: "Return the current twin snapshot (versioned document).",
    parameters: { type: "object", properties: {} },
  },
  [TOOL_NAMES.DIFF_TWIN]: {
    name: TOOL_NAMES.DIFF_TWIN,
    description:
      "Diff the current twin against the baseline empty snapshot, or against a previously stored snapshot id in this run.",
    parameters: {
      type: "object",
      properties: {
        against: {
          type: "string",
          description: "baseline (default) or a snapshot key stored earlier in this run.",
        },
      },
    },
  },
  [TOOL_NAMES.PROPOSE_SCENARIOS]: {
    name: TOOL_NAMES.PROPOSE_SCENARIOS,
    description:
      "Register N ScenarioPatches as candidates for this planning run (stations, stadiums, energy sites, policy trades, etc.). General propose verb.",
    parameters: {
      type: "object",
      properties: {
        patches: {
          type: "array",
          description: "Array of ScenarioPatch objects.",
          items: { type: "object" },
        },
        question: { type: "string", description: "User question these patches answer." },
      },
      required: ["patches"],
    },
  },
  [TOOL_NAMES.SCORE_POPULATION]: {
    name: TOOL_NAMES.SCORE_POPULATION,
    description:
      "Score real citizen acceptance for a ScenarioPatch (or a free-form question) by adaptively Monte-Carlo-sampling real Toronto residents and running the real trained opinion model: it draws residents in small batches and keeps sampling until the 95% confidence interval on the mean is tight (or a hard cap / the real resident pool is hit), so the returned citywide.sampleSize and citywide.ciHalfWidth vary run to run -- check citywide.stopReason and ciHalfWidth before treating the mean as settled. Returns citywide mean/support and byNeighbourhood breakdowns. Use those numbers as a decision signal: if acceptance is weak at the proposed site, try other neighbourhoods before recommending. A model-predicted reaction based on real resident profiles, not an actual public survey or ridership figure.",
    parameters: {
      type: "object",
      properties: {
        patch: { type: "object", description: "Optional ScenarioPatch; if omitted, scores current twin." },
        question: { type: "string", description: "Planner question." },
        scenarioId: { type: "string", description: "Candidate id label." },
        neighbourhoodCodes: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional: restrict real-resident sampling to these neighbourhood codes instead of citywide, to save compute when you only care about specific areas (e.g. the candidates you're comparing). Omit for a citywide read.",
        },
      },
      required: ["question"],
    },
  },
  [TOOL_NAMES.INVOKE_ASSISTANT]: {
    name: TOOL_NAMES.INVOKE_ASSISTANT,
    description:
      "Ask another TechTO Backboard assistant to do one focused task with its tools. Use when you need a specialist lens; do not invent niche one-off agents. Pass a clear task string.",
    parameters: {
      type: "object",
      properties: {
        role: {
          type: "string",
          description:
            "Assistant key, e.g. geospatial-twin | scenario-designer | citizen-response | equity-impact | feasibility | adversarial-reviewer | evidence-auditor | final-policy-judge | explanation-map",
        },
        task: { type: "string", description: "What you want that assistant to do or answer." },
      },
      required: ["role", "task"],
    },
  },
};

export function getToolDefinitions(names: ToolName[]): ChatToolDefinition[] {
  return names.map((name) => TOOL_DEFINITIONS[name]);
}
