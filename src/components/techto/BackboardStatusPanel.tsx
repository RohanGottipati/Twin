"use client";

import { useEffect, useState } from "react";
import { AlertCircle, Cpu, Loader2, ServerCog, Users } from "lucide-react";
import { GlassPanel } from "@/components/primitives/GlassPanel";
import { StatusPill } from "@/components/primitives/StatusPill";

interface CapabilitiesAssistant {
  role: string;
  name: string;
  description: string;
  assistantId: string;
  toolNames: string[];
  memory: string;
  model: { provider: string; name: string; contextLimit: number; reason: string };
}

export interface CapabilitiesResponse {
  mode: "live";
  product?: string;
  rosterVersion?: string;
  expectedAssistants?: number;
  configuredAssistants?: number;
  missingAssistants?: string[];
  modelCatalogSize: number;
  assistants: CapabilitiesAssistant[];
}

export interface BackboardStatusPanelProps {
  onCapabilitiesLoaded?: (capabilities: CapabilitiesResponse) => void;
}

/** Introspects `/api/backboard/capabilities` for the consolidated 16-assistant roster. */
export function BackboardStatusPanel({ onCapabilitiesLoaded }: BackboardStatusPanelProps) {
  const [capabilities, setCapabilities] = useState<CapabilitiesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const response = await fetch("/api/backboard/capabilities");
        if (!response.ok) throw new Error(`Capabilities request failed with ${response.status}.`);
        const data = (await response.json()) as CapabilitiesResponse;
        if (!cancelled) {
          setCapabilities(data);
          onCapabilitiesLoaded?.(data);
        }
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [onCapabilitiesLoaded]);

  return (
    <GlassPanel className="flex h-full flex-col p-4" data-testid="backboard-status-panel">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ServerCog className="h-4 w-4 text-techto-accent" />
          <h3 className="text-sm font-semibold text-techto-text">Backboard Status</h3>
        </div>
        {capabilities && (
          <StatusPill tone="ready">
            Live
          </StatusPill>
        )}
      </div>

      {isLoading && (
        <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-techto-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Resolving assistant roster...
        </p>
      )}

      {error && (
        <p className="mt-3 inline-flex items-start gap-1.5 text-xs text-techto-error">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      )}

      {capabilities && (
        <div className="mt-3 space-y-2 text-xs text-techto-muted">
          <p className="inline-flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5" />
            Roster {capabilities.rosterVersion ?? "unknown"} ·{" "}
            {capabilities.configuredAssistants ?? capabilities.assistants.length}/
            {capabilities.expectedAssistants ?? 16} configured
          </p>
          <p className="inline-flex items-center gap-1.5">
            <Cpu className="h-3.5 w-3.5" />
            {capabilities.modelCatalogSize} models in catalog
          </p>
          {(capabilities.missingAssistants?.length ?? 0) > 0 && (
            <p className="text-techto-amber">
              Missing: {capabilities.missingAssistants?.join(", ")}
            </p>
          )}
          <ul className="max-h-40 space-y-1 overflow-y-auto techto-scroll pr-1">
            {capabilities.assistants.map((assistant) => (
              <li key={assistant.role} className="rounded border border-white/5 bg-white/[0.02] px-2 py-1.5">
                <span className="font-medium text-techto-text">{assistant.name.replace(/^TechTO — /, "")}</span>
                <span className="block text-[10px] text-techto-muted">
                  {assistant.model.provider}/{assistant.model.name} · {assistant.memory} · {assistant.toolNames.length} tools
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </GlassPanel>
  );
}
