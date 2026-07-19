/** Full JSON / text for toggleable tool traces (no truncation). */

export function clipToolDetail(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  // prefer plain strings (e.g. specialist reply) over JSON quotes
  const s = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  if (!s || s === "{}" || s === "[]" || s === '""') return undefined;
  return s;
}

/** Format a tool result for the detail pane (full payload). */
export function toolOutputPreview(toolName: string, output: unknown): string | undefined {
  if (!output || typeof output !== "object") return clipToolDetail(output);
  const o = output as Record<string, unknown>;
  // invoke_assistant: show who + what they said + tools they used
  if (toolName === "invoke_assistant") {
    return clipToolDetail({
      role: o.role,
      name: o.name,
      toolsUsed: o.toolsUsed,
      toolRounds: o.toolRounds,
      content: o.content,
    });
  }
  if (toolName === "compose_map_actions") {
    return clipToolDetail({
      accepted: o.accepted,
      rejected: o.rejected,
      errors: o.errors,
    });
  }
  return clipToolDetail(output);
}
