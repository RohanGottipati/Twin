import { beforeEach, describe, expect, it } from "vitest";
import { useWorldStore } from "@/store/useWorldStore";

describe("world store", () => {
  beforeEach(() => {
    useWorldStore.getState().resetUi();
  });

  it("defaults to world mode", () => {
    expect(useWorldStore.getState().mode).toBe("world");
    expect(useWorldStore.getState().activeCityId).toBeNull();
  });

  it("updates previewCityId when a city is selected for preview", () => {
    useWorldStore.getState().setPreviewCity("toronto");
    expect(useWorldStore.getState().previewCityId).toBe("toronto");
  });

  it("updates activeCityId when a city is activated", () => {
    useWorldStore.getState().setActiveCity("toronto");
    useWorldStore.getState().setMode("city-overview");
    expect(useWorldStore.getState().activeCityId).toBe("toronto");
    expect(useWorldStore.getState().mode).toBe("city-overview");
  });

  it("clears the selected building", () => {
    useWorldStore.getState().setSelectedBuilding({
      id: "b1",
      name: "Test",
      type: null,
      estimatedHeight: null,
      longitude: 0,
      latitude: 0,
      properties: {},
    });
    expect(useWorldStore.getState().selectedBuilding).not.toBeNull();
    useWorldStore.getState().clearSelectedBuilding();
    expect(useWorldStore.getState().selectedBuilding).toBeNull();
  });

  it("resets UI back to defaults", () => {
    const state = useWorldStore.getState();
    state.setMode("city");
    state.setActiveCity("toronto");
    state.setPreviewCity("toronto");
    state.toggleLayerPanel(true);
    state.resetUi();

    const reset = useWorldStore.getState();
    expect(reset.mode).toBe("world");
    expect(reset.activeCityId).toBeNull();
    expect(reset.previewCityId).toBeNull();
    expect(reset.isLayerPanelOpen).toBe(false);
  });
});
