import { create } from "zustand";

export type WorldMode =
  | "world"
  | "city-overview"
  | "city"
  | "city-close";

export type LoadingStage =
  | "engine"
  | "terrain"
  | "buildings"
  | "markers"
  | "ready";

export type SelectedBuilding = {
  id: string;
  name: string;
  type: string | null;
  estimatedHeight: number | null;
  longitude: number;
  latitude: number;
  properties: Record<string, string | number | boolean | null>;
};

export type SceneError = {
  title: string;
  message: string;
  critical: boolean;
} | null;

type WorldState = {
  mode: WorldMode;
  activeCityId: string | null;
  previewCityId: string | null;
  selectedBuilding: SelectedBuilding | null;
  isSceneReady: boolean;
  isSceneLoading: boolean;
  loadingStage: LoadingStage;
  sceneError: SceneError;
  isFlying: boolean;
  isLayerPanelOpen: boolean;
  isHelpPanelOpen: boolean;
  globeRotationEnabled: boolean;
  terrainEnabled: boolean;
  buildingsEnabled: boolean;
  cityMarkersEnabled: boolean;
  labelsEnabled: boolean;
  atmosphereEnabled: boolean;
  lightingEnabled: boolean;
  cameraHeight: number;
  cameraLongitude: number;
  cameraLatitude: number;
};

type WorldActions = {
  setMode: (mode: WorldMode) => void;
  setActiveCity: (cityId: string | null) => void;
  setPreviewCity: (cityId: string | null) => void;
  setSelectedBuilding: (building: SelectedBuilding | null) => void;
  clearSelectedBuilding: () => void;
  setSceneReady: (ready: boolean) => void;
  setSceneLoading: (loading: boolean) => void;
  setLoadingStage: (stage: LoadingStage) => void;
  setSceneError: (error: SceneError) => void;
  setFlying: (flying: boolean) => void;
  toggleLayerPanel: (open?: boolean) => void;
  toggleHelpPanel: (open?: boolean) => void;
  setGlobeRotation: (enabled: boolean) => void;
  toggleTerrain: (enabled?: boolean) => void;
  toggleBuildings: (enabled?: boolean) => void;
  toggleCityMarkers: (enabled?: boolean) => void;
  toggleLabels: (enabled?: boolean) => void;
  toggleAtmosphere: (enabled?: boolean) => void;
  toggleLighting: (enabled?: boolean) => void;
  updateCameraPosition: (position: {
    height: number;
    longitude: number;
    latitude: number;
  }) => void;
  resetUi: () => void;
};

export type WorldStore = WorldState & WorldActions;

const initialState: WorldState = {
  mode: "world",
  activeCityId: null,
  previewCityId: null,
  selectedBuilding: null,
  isSceneReady: false,
  isSceneLoading: true,
  loadingStage: "engine",
  sceneError: null,
  isFlying: false,
  isLayerPanelOpen: false,
  isHelpPanelOpen: false,
  globeRotationEnabled: true,
  terrainEnabled: true,
  buildingsEnabled: true,
  cityMarkersEnabled: true,
  labelsEnabled: true,
  atmosphereEnabled: true,
  lightingEnabled: false,
  cameraHeight: 20000000,
  cameraLongitude: -35,
  cameraLatitude: 27,
};

export const useWorldStore = create<WorldStore>((set) => ({
  ...initialState,

  setMode: (mode) => set({ mode }),
  setActiveCity: (activeCityId) => set({ activeCityId }),
  setPreviewCity: (previewCityId) => set({ previewCityId }),
  setSelectedBuilding: (selectedBuilding) => set({ selectedBuilding }),
  clearSelectedBuilding: () => set({ selectedBuilding: null }),
  setSceneReady: (isSceneReady) => set({ isSceneReady }),
  setSceneLoading: (isSceneLoading) => set({ isSceneLoading }),
  setLoadingStage: (loadingStage) => set({ loadingStage }),
  setSceneError: (sceneError) => set({ sceneError }),
  setFlying: (isFlying) => set({ isFlying }),

  toggleLayerPanel: (open) =>
    set((state) => ({
      isLayerPanelOpen: open ?? !state.isLayerPanelOpen,
    })),
  toggleHelpPanel: (open) =>
    set((state) => ({
      isHelpPanelOpen: open ?? !state.isHelpPanelOpen,
    })),

  setGlobeRotation: (globeRotationEnabled) => set({ globeRotationEnabled }),
  toggleTerrain: (enabled) =>
    set((state) => ({ terrainEnabled: enabled ?? !state.terrainEnabled })),
  toggleBuildings: (enabled) =>
    set((state) => ({
      buildingsEnabled: enabled ?? !state.buildingsEnabled,
    })),
  toggleCityMarkers: (enabled) =>
    set((state) => ({
      cityMarkersEnabled: enabled ?? !state.cityMarkersEnabled,
    })),
  toggleLabels: (enabled) =>
    set((state) => ({ labelsEnabled: enabled ?? !state.labelsEnabled })),
  toggleAtmosphere: (enabled) =>
    set((state) => ({
      atmosphereEnabled: enabled ?? !state.atmosphereEnabled,
    })),
  toggleLighting: (enabled) =>
    set((state) => ({ lightingEnabled: enabled ?? !state.lightingEnabled })),

  updateCameraPosition: ({ height, longitude, latitude }) =>
    set({
      cameraHeight: height,
      cameraLongitude: longitude,
      cameraLatitude: latitude,
    }),

  resetUi: () => set({ ...initialState }),
}));
