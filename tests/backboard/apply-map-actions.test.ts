import { beforeEach, describe, expect, it } from "vitest";

import { applyMapActions } from "@/lib/techto/apply-map-actions";
import { useMapStore } from "@/store/useMapStore";

describe("applyMapActions", () => {
  beforeEach(() => useMapStore.getState().reset());

  it("stores a bounds animation and official neighbourhood highlight", () => {
    applyMapActions([
      {
        type: "fit_bounds",
        bounds: [-79.5, 43.6, -79.4, 43.7],
        padding: 80,
        durationMs: 1200,
      },
      { type: "highlight_neighbourhoods", neighbourhoodIds: ["024"] },
    ]);

    expect(useMapStore.getState().boundsTarget).toEqual({
      bounds: [-79.5, 43.6, -79.4, 43.7],
      padding: 80,
      durationMs: 1200,
    });
    expect(useMapStore.getState().highlightedNeighbourhoodIds).toEqual(["024"]);
    expect(useMapStore.getState().agent3DFocus).toEqual({
      source: "highlights",
      neighbourhoodIds: ["024"],
    });
  });

  it("replaces a broad focus with a drawn area and clears it with drawings", () => {
    applyMapActions([
      { type: "highlight_neighbourhoods", neighbourhoodIds: ["024"] },
    ]);
    applyMapActions([
      {
        type: "draw_polygon",
        id: "site",
        coordinates: [
          [-79.43, 43.68],
          [-79.42, 43.68],
          [-79.42, 43.69],
        ],
        label: "Preferred site",
      },
    ]);

    expect(useMapStore.getState().agent3DFocus).toMatchObject({
      source: "drawings",
      targets: [{ id: "site", radiusMeters: 0 }],
    });

    applyMapActions([{ type: "clear_map_overlays", what: "drawings" }]);
    expect(useMapStore.getState().agent3DFocus).toBeNull();
  });

  it("keeps only the newest camera command", () => {
    applyMapActions([
      {
        type: "fit_bounds",
        bounds: [-79.5, 43.6, -79.4, 43.7],
        padding: 40,
        durationMs: 900,
      },
      {
        type: "fly_to_center",
        center: [-79.42, 43.68],
        zoom: 15,
        durationMs: 700,
      },
    ]);

    expect(useMapStore.getState().boundsTarget).toBeNull();
    expect(useMapStore.getState().cameraTarget).toEqual({
      center: [-79.42, 43.68],
      zoom: 15,
      durationMs: 700,
    });
  });

  it("keeps only the leading blue candidate marker and flies to it", () => {
    applyMapActions([
      {
        type: "fit_bounds",
        bounds: [-79.5, 43.6, -79.3, 43.75],
        padding: 80,
        durationMs: 1200,
      },
      {
        type: "highlight_neighbourhoods",
        neighbourhoodIds: ["024", "048", "072"],
      },
      {
        type: "show_candidate_markers",
        candidates: [
          {
            candidateId: "station-024",
            coordinates: [-79.42, 43.68],
            rank: 1,
            label: "Wychwood",
          },
          {
            candidateId: "station-048",
            coordinates: [-79.35, 43.7],
            rank: 2,
            label: "Ionview",
          },
          {
            candidateId: "station-072",
            coordinates: [-79.3, 43.72],
            rank: 3,
            label: "Other",
          },
        ],
      },
    ]);

    const state = useMapStore.getState();
    expect(state.candidateMarkers).toEqual([
      {
        candidateId: "station-024",
        coordinates: [-79.42, 43.68],
        rank: 1,
        label: "Wychwood",
      },
    ]);
    expect(state.highlightedNeighbourhoodIds).toEqual(["024"]);
    expect(state.boundsTarget).toBeNull();
    expect(state.cameraTarget).toEqual({
      center: [-79.42, 43.68],
      zoom: 14,
      durationMs: 1200,
    });
    expect(state.agent3DFocus).toEqual({
      source: "highlights",
      neighbourhoodIds: ["024"],
    });
  });
});
