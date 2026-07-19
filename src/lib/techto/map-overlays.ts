/** Agent-drawn overlays on the 2D map + simple collision helpers. */

export type AgentMapOverlay =
  | {
      kind: "point";
      id: string;
      coordinates: [number, number];
      label: string;
    }
  | {
      kind: "line";
      id: string;
      coordinates: [number, number][];
      label: string;
    }
  | {
      kind: "polygon";
      id: string;
      coordinates: [number, number][];
      label: string;
    }
  | {
      kind: "annotation";
      id: string;
      coordinates: [number, number];
      text: string;
    };

export const MAP_COLLISION_METERS = 40;

function toRad(d: number) {
  return (d * Math.PI) / 180;
}

export function haversineMeters(
  a: [number, number],
  b: [number, number],
): number {
  const R = 6371000;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function overlayPoints(o: AgentMapOverlay): [number, number][] {
  if (o.kind === "point" || o.kind === "annotation") return [o.coordinates];
  return o.coordinates;
}

/** True if two overlays are within MAP_COLLISION_METERS of each other. */
export function overlaysCollide(a: AgentMapOverlay, b: AgentMapOverlay): boolean {
  if (a.id === b.id) return false;
  const pa = overlayPoints(a);
  const pb = overlayPoints(b);
  for (const p of pa) {
    for (const q of pb) {
      if (haversineMeters(p, q) < MAP_COLLISION_METERS) return true;
    }
  }
  return false;
}

export function findCollision(
  candidate: AgentMapOverlay,
  existing: AgentMapOverlay[],
): AgentMapOverlay | null {
  for (const other of existing) {
    if (overlaysCollide(candidate, other)) return other;
  }
  return null;
}

export function actionToOverlay(action: {
  type: string;
  id?: string;
  coordinates?: unknown;
  label?: string;
  text?: string;
}): AgentMapOverlay | null {
  if (action.type === "draw_point" && action.id && Array.isArray(action.coordinates)) {
    const c = action.coordinates as [number, number];
    return { kind: "point", id: action.id, coordinates: c, label: action.label ?? action.id };
  }
  if (action.type === "draw_line" && action.id && Array.isArray(action.coordinates)) {
    return {
      kind: "line",
      id: action.id,
      coordinates: action.coordinates as [number, number][],
      label: action.label ?? action.id,
    };
  }
  if (action.type === "draw_polygon" && action.id && Array.isArray(action.coordinates)) {
    return {
      kind: "polygon",
      id: action.id,
      coordinates: action.coordinates as [number, number][],
      label: action.label ?? action.id,
    };
  }
  if (action.type === "annotate" && action.id && Array.isArray(action.coordinates)) {
    return {
      kind: "annotation",
      id: action.id,
      coordinates: action.coordinates as [number, number],
      text: action.text ?? action.label ?? action.id,
    };
  }
  return null;
}
