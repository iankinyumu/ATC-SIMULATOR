import { distanceM, LocalProjection, type SurfaceEdge, type SurfaceNode } from '@atc/sim-core';

/** Points closer than this are treated as the same point. Engineering tolerance, not an aviation value. */
const SNAP_M = 0.5;

export interface CrossingResult {
  readonly nodes: SurfaceNode[];
  readonly edges: SurfaceEdge[];
  /** Crossings where a new node had to be inserted because the source did not connect them. */
  readonly inserted: number;
}

/**
 * Finds every place a non-runway edge crosses a runway edge without sharing a node, and splits
 * both edges at a new shared node. Without this, routing cannot tell that a taxiway crosses a
 * runway (OSM often draws taxiways straight over runways without connecting them).
 */
export function connectRunwayCrossings(nodes: readonly SurfaceNode[], edges: readonly SurfaceEdge[]): CrossingResult {
  if (nodes.length === 0) return { nodes: [...nodes], edges: [...edges], inserted: 0 };
  const proj = new LocalProjection(nodes[0]!);
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const xy = (id: string) => proj.toLocal(nodeById.get(id)!);
  const outNodes = [...nodes];
  const others = new Map(edges.filter((e) => e.kind !== 'runway').map((e) => [e.id, e]));
  const done: SurfaceEdge[] = [];
  const work = edges.filter((e) => e.kind === 'runway');
  let inserted = 0;

  const split = (edge: SurfaceEdge, at: string): [SurfaceEdge, SurfaceEdge] => {
    const a = nodeById.get(edge.from)!;
    const m = nodeById.get(at)!;
    const b = nodeById.get(edge.to)!;
    return [
      { ...edge, id: `${edge.id}a`, to: at, lengthM: distanceM(a, m) },
      { ...edge, id: `${edge.id}b`, from: at, lengthM: distanceM(m, b) },
    ];
  };

  while (work.length > 0) {
    const runway = work.pop()!;
    const p = xy(runway.from);
    const p2 = xy(runway.to);
    const r = { x: p2.x - p.x, y: p2.y - p.y };
    const runwayLen = Math.hypot(r.x, r.y);
    let hit = false;

    for (const taxi of others.values()) {
      if ([taxi.from, taxi.to].some((n) => n === runway.from || n === runway.to)) continue;
      const q = xy(taxi.from);
      const q2 = xy(taxi.to);
      const s = { x: q2.x - q.x, y: q2.y - q.y };
      const denom = r.x * s.y - r.y * s.x;
      if (Math.abs(denom) < 1e-9) continue; // parallel
      const qp = { x: q.x - p.x, y: q.y - p.y };
      const t = (qp.x * s.y - qp.y * s.x) / denom;
      const u = (qp.x * r.y - qp.y * r.x) / denom;
      const taxiLen = Math.hypot(s.x, s.y);
      const tol = (len: number) => (len === 0 ? 0 : SNAP_M / len);
      if (t < -tol(runwayLen) || t > 1 + tol(runwayLen) || u < -tol(taxiLen) || u > 1 + tol(taxiLen)) continue;

      // Reuse an existing endpoint if the crossing is (almost) on it; otherwise create a node.
      let at: string;
      if (u * taxiLen <= SNAP_M) at = taxi.from;
      else if ((1 - u) * taxiLen <= SNAP_M) at = taxi.to;
      else if (t * runwayLen <= SNAP_M) at = runway.from;
      else if ((1 - t) * runwayLen <= SNAP_M) at = runway.to;
      else {
        const point = proj.toLatLon({ x: p.x + t * r.x, y: p.y + t * r.y });
        at = `x:${runway.id}:${taxi.id}`;
        const node: SurfaceNode = { id: at, lat: point.lat, lon: point.lon };
        nodeById.set(at, node);
        outNodes.push(node);
        inserted++;
      }

      if (at !== taxi.from && at !== taxi.to) {
        others.delete(taxi.id);
        for (const part of split(taxi, at)) others.set(part.id, part);
      }
      // Re-check the runway (or its two halves) against the remaining edges for further crossings.
      if (at !== runway.from && at !== runway.to) work.push(...split(runway, at));
      else work.push(runway);
      hit = true;
      break;
    }
    if (!hit) done.push(runway);
  }

  return { nodes: outNodes, edges: [...others.values(), ...done], inserted };
}
