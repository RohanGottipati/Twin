import { create } from "zustand";

/**
 * Visibility toggles for the TwinTO city-view overlays. Kept as a flat
 * boolean record (rather than a generic string set) so layer keys are
 * type-checked at every call site.
 */
export interface MapLayerVisibility {
  transit: boolean;
  parcels: boolean;
  zoning: boolean;
  sentimentHeatmap: boolean;
  policyOverlay: boolean;
}

interface MapState {
  selectedStationId: string | null;
  selectedScenarioId: string | null;
  /** Minutes since the start of the playback window, for scrubbing a time-based overlay (e.g. transit headways). */
  playbackMinute: number;
  layers: MapLayerVisibility;
}

interface MapActions {
  setSelectedStation: (stationId: string | null) => void;
  setSelectedScenario: (scenarioId: string | null) => void;
  setPlaybackMinute: (minute: number) => void;
  toggleLayer: (layer: keyof MapLayerVisibility, visible?: boolean) => void;
  setLayerVisibility: (layers: Partial<MapLayerVisibility>) => void;
  reset: () => void;
}

export type MapStore = MapState & MapActions;

const DEFAULT_LAYERS: MapLayerVisibility = {
  transit: true,
  parcels: false,
  zoning: false,
  sentimentHeatmap: true,
  policyOverlay: true,
};

const initialState: MapState = {
  selectedStationId: null,
  selectedScenarioId: null,
  playbackMinute: 0,
  layers: DEFAULT_LAYERS,
};

export const useMapStore = create<MapStore>((set) => ({
  ...initialState,

  setSelectedStation: (selectedStationId) => set({ selectedStationId }),
  setSelectedScenario: (selectedScenarioId) => set({ selectedScenarioId }),
  setPlaybackMinute: (minute) => set({ playbackMinute: Math.max(0, minute) }),

  toggleLayer: (layer, visible) =>
    set((state) => ({
      layers: { ...state.layers, [layer]: visible ?? !state.layers[layer] },
    })),
  setLayerVisibility: (layers) =>
    set((state) => ({
      layers: { ...state.layers, ...layers },
    })),

  reset: () => set({ ...initialState, layers: DEFAULT_LAYERS }),
}));
