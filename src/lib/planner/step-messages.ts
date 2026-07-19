/** Short chat-log lines for City Code tool steps (spinner while running, then Done). */

const TOOL_LABEL: Record<string, string> = {
  search_neighbourhoods: "Searching neighbourhoods",
  compose_map_actions: "Updating the map",
  propose_scenarios: "Drafting scenario options",
  score_population: "Scoring day-one acceptance",
  get_current_map_context: "Reading map context",
  get_network_snapshot: "Loading transit network",
  invoke_assistant: "Calling a specialist",
  run_python: "Running analysis code",
  patch_twin: "Patching the city twin",
  query_twin: "Querying the twin",
  query_city_layer: "Querying city open data",
  run_twin_analysis: "Running twin analysis",
  snapshot_twin: "Taking a twin snapshot",
  diff_twin: "Diffing twin versions",
  generate_station_candidates: "Screening station locations",
  call_citizen_reaction_model: "Sampling citizen reactions",
};

export function toolRunningLabel(toolName: string): string {
  return TOOL_LABEL[toolName] ?? toolName.replaceAll("_", " ");
}
