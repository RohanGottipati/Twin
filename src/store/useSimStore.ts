"use client";

import { create } from "zustand";
import type { ScenarioResult } from "@/lib/sim/types";

export type LayerKey = "rail" | "streetcar" | "bus" | "personas" | "districts";

interface SimState {
  status: "loading" | "ready" | "error";
  scenarioId: string;
  layers: Record<LayerKey, boolean>;
  selectedCode: string | null;
  result: ScenarioResult | null;
  personaCount: number;
  /** True while real per-neighbourhood acceptance is being Monte-Carlo-sampled for the current scenario. */
  acceptanceLoading: boolean;
  setStatus: (status: SimState["status"]) => void;
  setScenario: (id: string) => void;
  toggleLayer: (key: LayerKey) => void;
  select: (code: string | null) => void;
  setResult: (result: ScenarioResult) => void;
  setPersonaCount: (n: number) => void;
  setAcceptanceLoading: (loading: boolean) => void;
}

export const useSimStore = create<SimState>((set) => ({
  status: "loading",
  scenarioId: "baseline",
  layers: { rail: true, streetcar: true, bus: true, personas: true, districts: true },
  selectedCode: null,
  result: null,
  personaCount: 0,
  acceptanceLoading: false,
  setStatus: (status) => set({ status }),
  setScenario: (scenarioId) => set({ scenarioId }),
  toggleLayer: (key) =>
    set((s) => ({ layers: { ...s.layers, [key]: !s.layers[key] } })),
  select: (selectedCode) => set({ selectedCode }),
  setResult: (result) => set({ result }),
  setPersonaCount: (personaCount) => set({ personaCount }),
  setAcceptanceLoading: (acceptanceLoading) => set({ acceptanceLoading }),
}));
