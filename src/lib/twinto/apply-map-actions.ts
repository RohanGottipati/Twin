"use client";

import type { MapAction } from "@/lib/twinto/map-actions";
import type { AgentMapOverlay } from "@/lib/twinto/map-overlays";
import { deriveAgent3DFocus } from "@/lib/map/localized-3d";
import { useMapStore } from "@/store/useMapStore";
import { useTwinTOStore } from "@/store/useTwinTOStore";

/**
 * Frontend executor for allowlisted MapActions. Shared by map chat surfaces.
 */
export function applyMapActions(actions: MapAction[]): void {
  const map = useMapStore.getState();

  for (const action of actions) {
    if (action.type === "fly_to_center") {
      map.setCameraTarget({
        center: action.center,
        zoom: action.zoom,
        durationMs: action.durationMs,
      });
    } else if (action.type === "fit_bounds") {
      map.setBoundsTarget({
        bounds: action.bounds,
        padding: action.padding,
        durationMs: action.durationMs,
      });
    } else if (action.type === "highlight_neighbourhoods") {
      map.setHighlightedNeighbourhoods(action.neighbourhoodIds);
    } else if (action.type === "show_candidate_markers") {
      map.setCandidateMarkers(action.candidates);
    } else if (action.type === "draw_point") {
      map.upsertAgentOverlay({
        kind: "point",
        id: action.id,
        coordinates: action.coordinates,
        label: action.label,
      });
    } else if (action.type === "draw_line") {
      map.upsertAgentOverlay({
        kind: "line",
        id: action.id,
        coordinates: action.coordinates,
        label: action.label,
      });
    } else if (action.type === "draw_polygon") {
      map.upsertAgentOverlay({
        kind: "polygon",
        id: action.id,
        coordinates: action.coordinates,
        label: action.label,
      });
    } else if (action.type === "annotate") {
      map.upsertAgentOverlay({
        kind: "annotation",
        id: action.id,
        coordinates: action.coordinates,
        text: action.text,
      });
    } else if (action.type === "remove_overlays") {
      map.removeAgentOverlays(action.ids);
    } else if (action.type === "clear_map_overlays") {
      map.clearMapOverlays(action.what);
    } else if (action.type === "set_layer_visibility") {
      const key = action.layerId as keyof typeof map.layers;
      if (key in map.layers) {
        map.setLayerVisibility({ [key]: action.visible });
      }
    } else if (action.type === "select_candidate") {
      useTwinTOStore.getState().setSelectedCandidate(action.candidateId);
    } else if (action.type === "open_panel") {
      const focus =
        action.panel === "citizen_reactions"
          ? "citizens"
          : action.panel === "candidate_details" || action.panel === "policy_comparison"
            ? "recommendation"
            : "chat";
      useTwinTOStore.getState().setPanelFocus(focus);
    }
  }

  const focus = deriveAgent3DFocus(actions, {
    candidateMarkers: useMapStore.getState().candidateMarkers,
  });
  if (focus !== undefined) {
    useMapStore.getState().setAgent3DFocus(focus);
  }
}

export function snapshotAgentOverlays(): AgentMapOverlay[] {
  return [...useMapStore.getState().agentOverlays];
}
