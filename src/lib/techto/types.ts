/**
 * Shared TechTO run contract. The canonical event/result/role types are
 * defined in `@/lib/backboard/orchestrator` (the module that actually
 * produces them) and re-exported here as types only, so this module stays
 * safe to import from client components without pulling any server-only
 * Backboard code into the client bundle, and so there is exactly one
 * definition of each type rather than two that could drift apart.
 */
export type {
  AssistantRoleKey as TechTOAgentRole,
} from "@/lib/backboard/assistants";
export type {
  CandidateEvaluation,
  EvidenceSource,
  RunOrchestrationInput,
  TechTOIntervention,
  TechTORunEvent,
  TechTORunResult,
} from "@/lib/backboard/orchestrator";
