import { ASSISTANT_ROSTER } from "@/lib/backboard/assistants";
import {
  mockAssistantId,
  type MockBackboardAdapter,
} from "@/lib/backboard/mock-adapter";
import type { CitizenCohort } from "@/lib/citizen-reaction/schemas";
import { requireScenario } from "@/data/transit/scenarios";
import type { TransitAnalystFinding, TransitIntervention } from "@/lib/transit/schemas";

/**
 * Deterministic mock-mode script used by POST /api/backboard/run when the
 * adapter is the offline mock. Rather than scripting all ~25 specialist
 * roles a flagship run invokes (unscripted roles fall back gracefully to a
 * local, deterministic finding via orchestrator.ts's runFindingAgent), this
 * only scripts the roles whose output actually shapes the demo narrative:
 * - baseline finding (Baseline Analyst)
 * - 3 policy candidates (Intervention Generator): one that deliberately
 *   exceeds the vehicle crush capacity (unsafe, rejected by the
 *   deterministic simulator regardless of mock mode), one modest capacity
 *   boost, and one balanced retiming of both flagship departures (the
 *   candidate this script expects to be preferred)
 * - citizen reactions via a real tool call per candidate (call_citizen_
 *   reaction_model is the same deterministic/local code path live mode
 *   uses; nothing about citizen reactions themselves is faked here)
 * - the Final Policy Judge's recommendation
 *
 * The real local ranker, simulator, and stress tester still evaluate every
 * candidate exactly as they would against a live Backboard response.
 */

export const MOCK_DEMO_CANDIDATE_IDS = {
  BALANCED_RETIME: "balanced-retime",
  CAPACITY_BOOST_MODEST: "capacity-boost-modest",
  UNSAFE_OVERCAPACITY: "unsafe-overcapacity",
} as const;

function roleAssistantId(role: keyof typeof ASSISTANT_ROSTER): string {
  return mockAssistantId(ASSISTANT_ROSTER[role].name);
}

function finding(role: string, headline: string, summary: string, confidence = 0.75): TransitAnalystFinding {
  return { role, headline, summary, keySignals: ["fixture-signal"], confidence };
}

function buildCandidates(baselineDepartures: string[]): TransitIntervention[] {
  const [first, second] = baselineDepartures;
  const retimeActions: TransitIntervention["actions"] = [
    { type: "shift_departure_minutes", departureId: first, deltaMinutes: 2 },
  ];
  if (second) {
    retimeActions.push({ type: "shift_departure_minutes", departureId: second, deltaMinutes: 1 });
  }
  return [
    {
      id: MOCK_DEMO_CANDIDATE_IDS.BALANCED_RETIME,
      label: "Retime both departures to absorb the pre-departure surge",
      description: `Shift ${first} later by 2 minutes and ${second ?? first} later by 1 minute so the surge that currently overloads ${first} spreads across both departures.`,
      actions: retimeActions,
    },
    {
      id: MOCK_DEMO_CANDIDATE_IDS.CAPACITY_BOOST_MODEST,
      label: `Add modest capacity to ${second ?? first}`,
      description: `Add 100 seats of capacity to ${second ?? first} to absorb overflow without changing the timetable.`,
      actions: [{ type: "capacity_boost", departureId: second ?? first, extraCapacity: 100 }],
    },
    {
      id: MOCK_DEMO_CANDIDATE_IDS.UNSAFE_OVERCAPACITY,
      label: `Overcapacity boost on ${first} (intentionally unsafe demo candidate)`,
      description: `Add 300 seats of capacity to ${first}, well past the vehicle's crush capacity, to exercise the deterministic simulator's hard rejection path.`,
      actions: [{ type: "capacity_boost", departureId: first, extraCapacity: 300 }],
    },
  ];
}

const CITIZEN_COHORT_SUBSET: CitizenCohort[] = [
  {
    cohortId: "downtown-commuters",
    label: "Downtown 9-to-5 commuters",
    populationWeight: 28,
    homeNeighborhood: "zone-liberty-village",
    demographics: { ageBand: "adult", incomeBand: "middle", primaryMode: "transit", hasDisability: false },
  },
  {
    cohortId: "accessibility-users",
    label: "Wheelchair and mobility-device users",
    populationWeight: 4,
    homeNeighborhood: "zone-regent-park",
    demographics: { ageBand: "adult", incomeBand: "low", primaryMode: "transit", hasDisability: true },
  },
  {
    cohortId: "seniors",
    label: "Seniors traveling off-peak and peak",
    populationWeight: 8,
    homeNeighborhood: "zone-st-lawrence",
    demographics: { ageBand: "senior", incomeBand: "middle", primaryMode: "transit", hasDisability: false },
  },
];

function citizenModelToolCall(scenarioId: string, candidate: TransitIntervention, waitDeltaMinutes: number) {
  return {
    name: "call_citizen_reaction_model",
    arguments: {
      scenarioId,
      intervention: { id: candidate.id, title: candidate.label, description: candidate.description ?? candidate.label, category: "transit" },
      cohorts: CITIZEN_COHORT_SUBSET,
      context: {
        wait: { beforeMinutes: 6, afterMinutes: Math.max(0, 6 + waitDeltaMinutes) },
        crowding: { beforeIndex: 0.6, afterIndex: candidate.id === MOCK_DEMO_CANDIDATE_IDS.UNSAFE_OVERCAPACITY ? 0.75 : 0.3 },
      },
    },
  };
}

/**
 * Scripts the process-wide mock adapter so a UI-triggered run (which has no
 * per-request metadata hook) still exercises the full multi-agent path.
 */
export function prepareMockDemoRun(adapter: MockBackboardAdapter, scenarioId: string): void {
  const scenario = requireScenario(scenarioId);

  adapter.scriptAssistantResponses(roleAssistantId("planning-orchestrator"), [
    {
      mockJsonResponse: finding(
        "planning-orchestrator",
        `${scenario.baselineDepartures[0] ?? "the first departure"} leaves underused while the following departure is overcrowded`,
        `Passenger arrivals concentrate in the minutes before ${scenario.baselineDepartures[0] ?? "the first departure"}, denying boardings, while the following departure absorbs the overflow and runs comparatively underused at ${scenario.stationId}.`,
      ),
    },
  ]);

  adapter.scriptAssistantResponses(roleAssistantId("evidence-auditor"), [
    {
      mockJsonResponse: finding(
        "evidence-auditor",
        "Baseline shows a clear load imbalance between the two flagship departures",
        `No-intervention baseline for ${scenario.id}: passenger arrivals peak just before the first scheduled departure, producing denied boardings there and an underloaded following departure.`,
      ),
    },
  ]);

  const candidates = buildCandidates(scenario.baselineDepartures);
  adapter.scriptAssistantResponses(roleAssistantId("transit-network-planner"), [
    { mockJsonResponse: { candidates } },
  ]);

  const [balanced, boost, unsafe] = candidates;
  adapter.scriptAssistantResponses(roleAssistantId("citizen-response-agent"), [
    {
      mockToolPlan: [
        [
          citizenModelToolCall(scenarioId, balanced, -2),
          citizenModelToolCall(scenarioId, boost, -1),
          citizenModelToolCall(scenarioId, unsafe, 1),
        ],
      ],
      mockJsonResponse: {
        summary: "Simulated citizen reactions favor the balanced retiming over the capacity boost, and reject the overcapacity candidate as infeasible.",
        processedCandidateIds: candidates.map((candidate) => candidate.id),
      },
    },
  ]);

  adapter.scriptAssistantResponses(roleAssistantId("final-policy-judge"), [
    {
      mockJsonResponse: {
        chosenCandidateId: MOCK_DEMO_CANDIDATE_IDS.BALANCED_RETIME,
        headline: `Recommend retiming both flagship departures at ${scenario.stationId}`,
        reasoning:
          "The balanced retiming candidate is valid under both visible and stress-tested conditions, spreads load across both departures, and does not require any capacity that exceeds the vehicle's crush limit. The overcapacity candidate fails deterministic validation outright and the modest capacity boost, while valid, leaves a larger residual wait than the retiming.",
        tradeoffs: [
          "The retiming shifts both departures later, which shift-worker and fixed-schedule cohorts are less able to absorb.",
          "The modest capacity boost was safer to operate but left more residual wait than the retiming.",
        ],
        confidence: 0.82,
        recommendedAction: "approve_with_monitoring",
      },
    },
  ]);
}

/**
 * Scripts a deterministic operator follow-up answer for mock mode. Call this
 * immediately before askOperatorQuestion so the repeating recommendation
 * script left over from prepareMockDemoRun does not poison the Q&A turn.
 */
export function prepareMockOperatorAnswer(adapter: MockBackboardAdapter, question: string): void {
  adapter.scriptAssistantResponses(roleAssistantId("explanation-map-action-agent"), [
    {
      mockJsonResponse: {
        answer:
          `Mock Backboard Mode answer for: "${question.slice(0, 120)}". ` +
          "The balanced retiming candidate was preferred because it is valid on fixture data, spreads load across " +
          "both flagship departures, and does not require capacity past the vehicle's crush limit. This is " +
          "decision support only; nothing here controls a real TTC service change, and every citizen reaction " +
          "cited is a simulated reading, never real public opinion.",
        citedEvidence: [
          `candidate:${MOCK_DEMO_CANDIDATE_IDS.BALANCED_RETIME}`,
          "tool:run_transit_simulation",
          "tool:stress_test_intervention",
        ],
      },
    },
  ]);
}
