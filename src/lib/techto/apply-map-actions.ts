"use client";

import { focusPrimaryMapRecommendation, type MapAction } from "@/lib/techto/map-actions";
import type { AgentMapOverlay } from "@/lib/techto/map-overlays";
import { deriveAgent3DFocus } from "@/lib/map/localized-3d";
import { useMapStore, type CandidateMarker, type MapLayerVisibility } from "@/store/useMapStore";
import { useTechTOStore } from "@/store/useTechTOStore";

/**
 * Frontend executor for allowlisted MapActions. Shared by map chat surfaces.
 *
 * Applies camera, overlays, and localized 3D focus in one Zustand update so
 * MapCanvas never sees a 2D fly followed by a pitch-only ease (which dropped
 * the zoom boost / 3D framing).
 */
export function applyMapActions(actions: MapAction[]): void {
  if (actions.length === 0) return;

  // One recommendation = one blue marker + fly there (not a litter of options).
  actions = focusPrimaryMapRecommendation(actions);

  const prev = useMapStore.getState();
  let cameraTarget = prev.cameraTarget;
  let boundsTarget = prev.boundsTarget;
  let highlightedNeighbourhoodIds = prev.highlightedNeighbourhoodIds;
  let candidateMarkers: CandidateMarker[] = prev.candidateMarkers;
  let agentOverlays: AgentMapOverlay[] = [...prev.agentOverlays];
  let layers: MapLayerVisibility = { ...prev.layers };
  let agent3DFocus = prev.agent3DFocus;

  for (const action of actions) {
    if (action.type === "fly_to_center") {
      cameraTarget = {
        center: action.center,
        zoom: action.zoom,
        durationMs: action.durationMs,
      };
      boundsTarget = null;
    } else if (action.type === "fit_bounds") {
      boundsTarget = {
        bounds: action.bounds,
        padding: action.padding,
        durationMs: action.durationMs,
      };
      cameraTarget = null;
    } else if (action.type === "highlight_neighbourhoods") {
      highlightedNeighbourhoodIds = action.neighbourhoodIds;
    } else if (action.type === "show_candidate_markers") {
      candidateMarkers = action.candidates;
    } else if (action.type === "draw_point") {
      agentOverlays = [
        ...agentOverlays.filter((o) => o.id !== action.id),
        {
          kind: "point",
          id: action.id,
          coordinates: action.coordinates,
          label: action.label,
        },
      ];
    } else if (action.type === "draw_line") {
      agentOverlays = [
        ...agentOverlays.filter((o) => o.id !== action.id),
        {
          kind: "line",
          id: action.id,
          coordinates: action.coordinates,
          label: action.label,
        },
      ];
    } else if (action.type === "draw_polygon") {
      agentOverlays = [
        ...agentOverlays.filter((o) => o.id !== action.id),
        {
          kind: "polygon",
          id: action.id,
          coordinates: action.coordinates,
          label: action.label,
        },
      ];
    } else if (action.type === "annotate") {
      agentOverlays = [
        ...agentOverlays.filter((o) => o.id !== action.id),
        {
          kind: "annotation",
          id: action.id,
          coordinates: action.coordinates,
          text: action.text,
        },
      ];
    } else if (action.type === "remove_overlays") {
      const ids = action.ids;
      agentOverlays = agentOverlays.filter((overlay) => !ids.includes(overlay.id));
      if (agent3DFocus?.source === "drawings") {
        const targets = agent3DFocus.targets.filter((target) => !ids.includes(target.id));
        agent3DFocus = targets.length > 0 ? { ...agent3DFocus, targets } : null;
      }
    } else if (action.type === "clear_map_overlays") {
      if (action.what === "all") {
        candidateMarkers = [];
        highlightedNeighbourhoodIds = [];
        agentOverlays = [];
        agent3DFocus = null;
      } else if (action.what === "markers") {
        candidateMarkers = [];
        if (agent3DFocus?.source === "markers") agent3DFocus = null;
      } else if (action.what === "highlights") {
        highlightedNeighbourhoodIds = [];
        if (agent3DFocus?.source === "highlights") agent3DFocus = null;
      } else if (action.what === "annotations") {
        agentOverlays = agentOverlays.filter((o) => o.kind !== "annotation");
      } else {
        // drawings
        agentOverlays = agentOverlays.filter((o) => o.kind === "annotation");
        if (agent3DFocus?.source === "drawings") agent3DFocus = null;
      }
    } else if (action.type === "set_layer_visibility") {
      const key = action.layerId as keyof MapLayerVisibility;
      if (key in layers) {
        layers = { ...layers, [key]: action.visible };
      }
    } else if (action.type === "select_candidate") {
      useTechTOStore.getState().setSelectedCandidate(action.candidateId);
    } else if (action.type === "open_panel") {
      const focus =
        action.panel === "citizen_reactions"
          ? "citizens"
          : action.panel === "candidate_details" || action.panel === "policy_comparison"
            ? "recommendation"
            : "chat";
      useTechTOStore.getState().setPanelFocus(focus);
    }
  }

  const nextFocus = deriveAgent3DFocus(actions, { candidateMarkers });
  if (nextFocus !== undefined) {
    agent3DFocus = nextFocus;
  }

  useMapStore.setState({
    cameraTarget,
    boundsTarget,
    highlightedNeighbourhoodIds,
    candidateMarkers,
    agentOverlays,
    layers,
    agent3DFocus,
  });
}

export function snapshotAgentOverlays(): AgentMapOverlay[] {
  return [...useMapStore.getState().agentOverlays];
}
