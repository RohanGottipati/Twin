import type { PlanningIntent } from "@/lib/backboard/assistants";

/**
 * Lightweight deterministic intent classifier for City Copilot routing.
 * Prefer this over LLM classification in mock mode and as a safe fallback.
 */
export function classifyPlanningIntent(message: string): PlanningIntent {
  const text = message.trim().toLowerCase();

  if (
    /\b(show|zoom|fly|highlight|pan|center|map)\b/.test(text) &&
    /\b(neighbourhood|neighborhood|station|option|candidate|liberty|parkdale)\b/.test(text) &&
    !/\b(best|compare|should|what happens|add a)\b/.test(text)
  ) {
    return "SIMPLE_MAP_NAVIGATION";
  }

  if (
    /\b(why|what does|explain|mean|ranked|metric)\b/.test(text) &&
    !/\b(best neighbourhood|add a subway|concert|4:0[68]|schedule)\b/.test(text)
  ) {
    return "SIMPLE_EXPLANATION";
  }

  if (/\b(compare|first and second|second option|both options)\b/.test(text)) {
    return "COMPARE_EXISTING_CANDIDATES";
  }

  if (/\b(concert|scotiabank|weather|closure|incident|construction|emergency)\b/.test(text)) {
    return "EVENT_RESPONSE";
  }

  if (/\b(4:0[68]|16:0[68]|departure|retim|schedule|headway|train is moved)\b/.test(text)) {
    return "SCHEDULE_CHANGE";
  }

  if (/\b(station|neighbourhood|neighborhood|subway|where to add|best place)\b/.test(text)) {
    return "NEW_STATION_LOCATION";
  }

  return "SCHEDULE_CHANGE";
}
