// Snaps each persona dot onto the real street network (Toronto Centreline)
// and walks it along a multi-block route, turning at intersections like an
// actual pedestrian — instead of ambling freely around its raw sample point
// (which could drift through a block's interior and cross building
// footprints) or oscillating back and forth on a single link (which reads
// as jittering in place rather than going somewhere).

import { mulberry32, hashString } from "@/lib/random";
import type { LngLat } from "@/lib/geo";
import type { Persona, StreetCollection } from "./types";

const KM_PER_DEG_LAT = 110.574;
const KM_PER_DEG_LON = 111.32 * Math.cos((43.7 * Math.PI) / 180);
const CELL_DEG = 0.004; // ~350-450m at Toronto's latitude
const NODE_DEG = 0.00002; // ~1.5-2m: quantizes edge endpoints into shared intersection nodes

interface AdjacentEdge {
  edge: number;
  /** True if this node is the edge's coordinate[0] (so traversal walks it forward). */
  atStart: boolean;
}

interface StreetNetwork {
  /** Per-edge polyline, as authored (index-aligned with `streets.features`). */
  edgeCoords: LngLat[][];
  /** Per-edge cumulative arc length (m), index-aligned with edgeCoords[i]. */
  edgeCum: number[][];
  /** Per-edge total length (m). */
  edgeLen: number[];
  /** Spatial grid for nearest-edge lookups: cellKey -> edge indices. */
  grid: Map<string, number[]>;
  /** Intersection graph: nodeKey -> edges touching it. */
  adjacency: Map<string, AdjacentEdge[]>;
}

function cellKey(lng: number, lat: number): string {
  return `${Math.floor(lng / CELL_DEG)},${Math.floor(lat / CELL_DEG)}`;
}

function nodeKey(p: LngLat): string {
  return `${Math.round(p[0] / NODE_DEG)},${Math.round(p[1] / NODE_DEG)}`;
}

function segmentLengthM(a: LngLat, b: LngLat): number {
  const dx = (b[0] - a[0]) * KM_PER_DEG_LON;
  const dy = (b[1] - a[1]) * KM_PER_DEG_LAT;
  return Math.hypot(dx, dy) * 1000;
}

function buildStreetNetwork(streets: StreetCollection): StreetNetwork {
  const edgeCoords: LngLat[][] = [];
  const edgeCum: number[][] = [];
  const edgeLen: number[] = [];
  const grid = new Map<string, number[]>();
  const adjacency = new Map<string, AdjacentEdge[]>();

  const addAdjacency = (key: string, entry: AdjacentEdge) => {
    const bucket = adjacency.get(key);
    if (bucket) bucket.push(entry);
    else adjacency.set(key, [entry]);
  };

  streets.features.forEach((f, i) => {
    const line = f.geometry.coordinates;
    edgeCoords.push(line);

    const cum = [0];
    for (let s = 1; s < line.length; s++) {
      cum.push(cum[s - 1] + segmentLengthM(line[s - 1], line[s]));
    }
    edgeCum.push(cum);
    edgeLen.push(cum[cum.length - 1]);

    const seen = new Set<string>();
    for (const [lng, lat] of line) {
      const key = cellKey(lng, lat);
      if (seen.has(key)) continue;
      seen.add(key);
      const bucket = grid.get(key);
      if (bucket) bucket.push(i);
      else grid.set(key, [i]);
    }

    addAdjacency(nodeKey(line[0]), { edge: i, atStart: true });
    addAdjacency(nodeKey(line[line.length - 1]), { edge: i, atStart: false });
  });

  return { edgeCoords, edgeCum, edgeLen, grid, adjacency };
}

/** Perpendicular distance (km) from p to segment a-b, plus the projection param t. */
function projectToSegment(
  p: LngLat,
  a: LngLat,
  b: LngLat
): { distKm: number; t: number } {
  const px = p[0] * KM_PER_DEG_LON;
  const py = p[1] * KM_PER_DEG_LAT;
  const ax = a[0] * KM_PER_DEG_LON;
  const ay = a[1] * KM_PER_DEG_LAT;
  const bx = b[0] * KM_PER_DEG_LON;
  const by = b[1] * KM_PER_DEG_LAT;
  const dx = bx - ax;
  const dy = by - ay;
  const seg2 = dx * dx + dy * dy;
  const t =
    seg2 === 0
      ? 0
      : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / seg2));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return { distKm: Math.hypot(px - cx, py - cy), t };
}

const MAX_SNAP_M = 350;
/** Target one-way route length: dots wander several blocks, not one. */
const MIN_ROUTE_M = 1600;
const MAX_ROUTE_M = 3600;
const MAX_ROUTE_STEPS = 140;
/** Stylized "sped-up preview" pace, not real walking speed. */
const MIN_SPEED_MPS = 50;
const MAX_SPEED_MPS = 110;

export interface StreetWalkAnchor {
  /** Concatenated route polyline the dot bounces back and forth along. */
  coords: LngLat[];
  cum: number[];
  total: number;
  /** Metres per millisecond. */
  speed: number;
  /** Random start offset (ms-equivalent arc units) so dots aren't in lockstep. */
  phase: number;
}

function nearestEdge(
  net: StreetNetwork,
  lng: number,
  lat: number
): { edgeIdx: number; segIdx: number; t: number; distKm: number } | null {
  let best: { edgeIdx: number; segIdx: number; t: number; distKm: number } | null =
    null;
  let foundAtRing = -1;
  const cx = Math.floor(lng / CELL_DEG);
  const cy = Math.floor(lat / CELL_DEG);

  // Expand ring-by-ring until a candidate turns up, then search one extra
  // ring so a closer segment just across a cell boundary isn't missed.
  for (let ring = 0; ring <= 6; ring++) {
    if (foundAtRing >= 0 && ring > foundAtRing + 1) break;
    const candidates = new Set<number>();
    for (let dx = -ring; dx <= ring; dx++) {
      for (let dy = -ring; dy <= ring; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const bucket = net.grid.get(`${cx + dx},${cy + dy}`);
        if (bucket) for (const idx of bucket) candidates.add(idx);
      }
    }
    for (const edgeIdx of candidates) {
      const line = net.edgeCoords[edgeIdx];
      for (let s = 0; s < line.length - 1; s++) {
        const { distKm, t } = projectToSegment([lng, lat], line[s], line[s + 1]);
        if (!best || distKm < best.distKm) best = { edgeIdx, segIdx: s, t, distKm };
      }
    }
    if (best && foundAtRing < 0) foundAtRing = ring;
  }

  return best;
}

/** Coordinates + cumulative length (starting at 0) of an edge, walked start-to-end or reversed. */
function edgeInDirection(
  net: StreetNetwork,
  edgeIdx: number,
  forward: boolean
): { coords: LngLat[]; lens: number[] } {
  const coords = net.edgeCoords[edgeIdx];
  const cum = net.edgeCum[edgeIdx];
  const total = net.edgeLen[edgeIdx];
  if (forward) {
    return { coords, lens: cum };
  }
  const revCoords = [...coords].reverse();
  const revLens = cum.map((c) => total - c).reverse();
  return { coords: revCoords, lens: revLens };
}

/**
 * Builds a multi-block walking route starting from a point on `startEdge`,
 * random-walking the intersection graph (turning corners, rarely doubling
 * straight back) until it covers a target distance.
 */
function buildRoute(
  net: StreetNetwork,
  startEdge: number,
  segIdx: number,
  segT: number,
  rng: () => number
): { coords: LngLat[]; cum: number[]; total: number } {
  const line = net.edgeCoords[startEdge];
  const cum = net.edgeCum[startEdge];
  const segLen = cum[segIdx + 1] - cum[segIdx];
  const startArc = cum[segIdx] + segT * segLen;
  const startPoint: LngLat = [
    line[segIdx][0] + (line[segIdx + 1][0] - line[segIdx][0]) * segT,
    line[segIdx][1] + (line[segIdx + 1][1] - line[segIdx][1]) * segT,
  ];

  const goForward = rng() < 0.5;
  const tailCoords = goForward ? line.slice(segIdx + 1) : line.slice(0, segIdx + 1).reverse();
  const tailArc = goForward ? cum.slice(segIdx + 1).map((c) => c - startArc) : [
    ...cum.slice(0, segIdx + 1).map((c) => startArc - c),
  ].reverse();

  const coords: LngLat[] = [startPoint, ...tailCoords];
  const arc: number[] = [0, ...tailArc];
  let currentNodeKey = nodeKey(coords[coords.length - 1]);
  let cameFromEdge = startEdge;
  const targetLen = MIN_ROUTE_M + rng() * (MAX_ROUTE_M - MIN_ROUTE_M);

  for (let step = 0; step < MAX_ROUTE_STEPS && arc[arc.length - 1] < targetLen; step++) {
    const options = net.adjacency.get(currentNodeKey);
    if (!options || options.length === 0) break;

    const forward = options.filter((o) => o.edge !== cameFromEdge);
    const pool = forward.length > 0 ? forward : options;
    const choice = pool[Math.floor(rng() * pool.length)];

    const { coords: nextCoords, lens: nextLens } = edgeInDirection(
      net,
      choice.edge,
      choice.atStart
    );
    const base = arc[arc.length - 1];
    // nextCoords[0] is the node we're already standing on; skip the duplicate.
    for (let i = 1; i < nextCoords.length; i++) {
      coords.push(nextCoords[i]);
      arc.push(base + nextLens[i]);
    }
    cameFromEdge = choice.edge;
    currentNodeKey = nodeKey(nextCoords[nextCoords.length - 1]);
  }

  return { coords, cum: arc, total: arc[arc.length - 1] };
}

/** Builds one street-walking anchor per persona (parallel array, index = persona.id). */
export function buildStreetWalkAnchors(
  personas: Persona[],
  streets: StreetCollection
): (StreetWalkAnchor | null)[] {
  const net = buildStreetNetwork(streets);

  return personas.map((p) => {
    const hit = nearestEdge(net, p.lng, p.lat);
    if (!hit || hit.distKm * 1000 > MAX_SNAP_M) return null;
    if (net.edgeLen[hit.edgeIdx] <= 0) return null;

    const rng = mulberry32(hashString(`streetwalk:${p.id}`));
    const route = buildRoute(net, hit.edgeIdx, hit.segIdx, hit.t, rng);
    if (route.total <= 0) return null;

    const speed =
      (MIN_SPEED_MPS + rng() * (MAX_SPEED_MPS - MIN_SPEED_MPS)) / 1000;
    const phase = rng() * route.total * 2;

    return { coords: route.coords, cum: route.cum, total: route.total, speed, phase };
  });
}

/** Position (lng/lat) of arc length `arc` along an anchor's route. */
function pointAtArc(anchor: StreetWalkAnchor, arc: number): LngLat {
  const { coords, cum } = anchor;
  const clamped = Math.max(0, Math.min(anchor.total, arc));
  let i = 1;
  while (i < cum.length - 1 && cum[i] < clamped) i++;
  const segStart = cum[i - 1];
  const segLen = cum[i] - segStart;
  const t = segLen === 0 ? 0 : (clamped - segStart) / segLen;
  const a = coords[i - 1];
  const b = coords[i];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Walking position for a street-snapped persona at time `t` (ms). */
export function streetWalkPosition(anchor: StreetWalkAnchor, t: number): LngLat {
  const total = anchor.total;
  if (total <= 0) return anchor.coords[0];
  const period = total * 2;
  let x = (anchor.phase + t * anchor.speed) % period;
  if (x < 0) x += period;
  // Ping-pong: walk the route forward, then retrace it — turns look natural
  // in both directions since it's the same real street geometry either way.
  const arc = x <= total ? x : period - x;
  return pointAtArc(anchor, arc);
}
