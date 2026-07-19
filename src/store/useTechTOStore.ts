import { create } from "zustand";

/** Which panel the TechTO chat/results UI should bring to the foreground. */
export type TechTOPanelFocus = "chat" | "citizens" | "map" | "recommendation" | "history";

interface TechTOState {
  activeRunId: string | null;
  selectedCandidateId: string | null;
  panelFocus: TechTOPanelFocus;
}

interface TechTOActions {
  setActiveRun: (runId: string | null) => void;
  setSelectedCandidate: (candidateId: string | null) => void;
  setPanelFocus: (focus: TechTOPanelFocus) => void;
  reset: () => void;
}

export type TechTOStore = TechTOState & TechTOActions;

const initialState: TechTOState = {
  activeRunId: null,
  selectedCandidateId: null,
  panelFocus: "chat",
};

export const useTechTOStore = create<TechTOStore>((set) => ({
  ...initialState,

  // Switching runs invalidates any candidate selection from the previous run.
  setActiveRun: (activeRunId) => set({ activeRunId, selectedCandidateId: null }),
  setSelectedCandidate: (selectedCandidateId) => set({ selectedCandidateId }),
  setPanelFocus: (panelFocus) => set({ panelFocus }),

  reset: () => set({ ...initialState }),
}));
