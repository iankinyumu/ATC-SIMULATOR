import type { LocalProjection } from '../geo/geo';
import { normaliseTaxiwayName, type SurfaceGraph } from '../surface/graph';
import type { Stand } from '../surface/surface';
import { Path, type PathPoint } from './path';
import type { GroundPerformance } from './performance';

/**
 * Ground phases of the aircraft state machine (spec §45 G):
 * parked → pushback → holding → taxi ⇄ holding → (taxi to stand) parked.
 */
export type SurfacePhase = 'parked' | 'pushback' | 'taxi' | 'holding';

export interface SurfaceMotion {
  readonly kind: 'pushback' | 'taxi';
  readonly path: Path;
  /** Distance travelled along the path. */
  s: number;
  /** The clearance that started this movement. */
  readonly clearanceId: string;
  /** Hold-position clearance currently stopping the aircraft, if any. */
  holdClearanceId: string | null;
  /** Clearance limit, for display: "A10E", "stand 501", "end of pushback". */
  readonly limit: string;
  /** Stand name if the movement ends on a stand. */
  readonly toStand: string | null;
}

/** Where the aircraft is on the surface and how it is moving. Local metres, x east / y north. */
export interface SurfaceState {
  phase: SurfacePhase;
  x: number;
  y: number;
  headingTrueDeg: number;
  speedMps: number;
  /** Stand the aircraft is parked on. */
  standName: string | null;
  /** Network node the aircraft is stopped at, when stopped at one. */
  nodeId: string | null;
  motion: SurfaceMotion | null;
}

export type Planned = { readonly ok: true; readonly path: Path; readonly limit: string; readonly toStand: string | null } | { readonly ok: false; readonly reason: string };

const CARDINALS: Record<string, number> = { N: 0, E: 90, S: 180, W: 270 };

/** How far (degrees) the push along the taxiway may curve from its initial direction. Geometry tolerance. */
const MAX_PUSH_CURVE_DEG = 20;

function angleBetween(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180);
}

function pointsFor(graph: SurfaceGraph, projection: LocalProjection, nodeIds: readonly string[]): PathPoint[] {
  return nodeIds.map((id) => {
    const n = graph.node(id)!;
    const p = projection.toLocal(n);
    return { x: p.x, y: p.y, nodeId: id };
  });
}

/**
 * Pushback path: tail-first along the stand lead-in line to the taxiway, then along the taxiway
 * so that the aircraft ends nose towards `face`.
 */
export function planPushback(
  graph: SurfaceGraph,
  projection: LocalProjection,
  stand: Stand,
  face: string | undefined,
  perf: GroundPerformance,
): Planned {
  if (stand.stopNodeId === null || stand.entryNodeId === null) return { ok: false, reason: `Stand ${stand.name} is not connected to the taxi network` };
  const lead = graph.findRoute({ fromNodeId: stand.stopNodeId, toNodeId: stand.entryNodeId });
  if (lead === null) return { ok: false, reason: `No path from stand ${stand.name} to the taxiway` };

  // Tail goes along the taxiway in direction d, so the nose ends facing d + 180.
  const options = graph
    .linksFrom(stand.entryNodeId)
    .filter((l) => l.edge.kind === 'taxiway' || l.edge.kind === 'taxilane')
    .map((l) => ({ link: l, facing: (l.bearingDeg + 180) % 360 }));
  if (options.length === 0) return { ok: false, reason: `Stand ${stand.name} has no taxiway to push onto` };

  let chosen = options[0]!;
  if (face !== undefined) {
    const target = CARDINALS[face.toUpperCase()];
    if (target === undefined) return { ok: false, reason: `Unknown face direction "${face}" (use N, E, S or W)` };
    const best = [...options].sort((a, b) => angleBetween(a.facing, target) - angleBetween(b.facing, target))[0]!;
    if (angleBetween(best.facing, target) > 60) return { ok: false, reason: `Cannot push back from stand ${stand.name} to face ${face}` };
    chosen = best;
  } else if (options.length > 1) {
    return { ok: false, reason: `Pushback from stand ${stand.name} needs a face direction` };
  }

  // Continue straight along the taxiway until the pushback distance is covered.
  const nodes = [...lead.nodeIds, chosen.link.to];
  let travelled = chosen.link.edge.lengthM;
  let heading = chosen.link.bearingDeg;
  let current = chosen.link.to;
  let previous = stand.entryNodeId;
  while (travelled < perf.pushbackTaxiwayDistanceM - 0.5) {
    const next = graph
      .linksFrom(current)
      .filter((l) => l.to !== previous && (l.edge.kind === 'taxiway' || l.edge.kind === 'taxilane'))
      .sort((a, b) => angleBetween(a.bearingDeg, heading) - angleBetween(b.bearingDeg, heading))[0];
    // A pushback ends on a straight section; stop rather than follow the taxiway round a bend.
    if (next === undefined || angleBetween(next.bearingDeg, chosen.link.bearingDeg) > MAX_PUSH_CURVE_DEG || graph.runwaysAt(next.to).length > 0) break;
    nodes.push(next.to);
    travelled += next.edge.lengthM;
    heading = next.bearingDeg;
    previous = current;
    current = next.to;
  }
  return { ok: true, path: new Path(pointsFor(graph, projection, nodes)), limit: 'end of pushback', toStand: null };
}

export interface TaxiRequest {
  readonly holdingPoint?: string;
  readonly stand?: string;
  readonly via?: readonly string[];
  readonly crossRunways?: readonly string[];
}

/** Parses taxi command parameters: `via` and `crossRunways` are comma-separated lists. */
export function taxiRequestFromParams(params: Readonly<Record<string, string | number | boolean>>): TaxiRequest {
  const list = (v: unknown) =>
    typeof v === 'string' && v.trim() !== '' ? v.split(',').map((s) => s.trim()).filter((s) => s !== '') : undefined;
  const via = list(params.via);
  const crossRunways = list(params.crossRunways);
  return {
    ...(typeof params.holdingPoint === 'string' ? { holdingPoint: params.holdingPoint } : {}),
    ...(typeof params.stand === 'string' ? { stand: params.stand } : {}),
    ...(via !== undefined ? { via } : {}),
    ...(crossRunways !== undefined ? { crossRunways } : {}),
  };
}

/**
 * Taxi path from a network node, starting in the aircraft's current direction, to a holding
 * point or stand. Where a holding point name appears more than once, the shortest is used.
 */
export function planTaxi(
  graph: SurfaceGraph,
  projection: LocalProjection,
  from: { nodeId: string; headingTrueDeg: number; prefix: readonly PathPoint[] },
  req: TaxiRequest,
  perf: GroundPerformance,
): Planned {
  let targets: Array<{ nodeId: string; limit: string; toStand: string | null; endConnectors: string[] }>;
  if (req.holdingPoint !== undefined) {
    const holds = graph.holdingPoints(req.holdingPoint);
    if (holds.length === 0) return { ok: false, reason: `Unknown holding point ${req.holdingPoint}` };
    const name = normaliseTaxiwayName(req.holdingPoint);
    targets = holds.map((h) => ({ nodeId: h.nodeId, limit: name, toStand: null, endConnectors: [name] }));
  } else if (req.stand !== undefined) {
    const stand = graph.stand(req.stand);
    if (stand === undefined || stand.stopNodeId === null) return { ok: false, reason: `Unknown or unconnected stand ${req.stand}` };
    targets = [{ nodeId: stand.stopNodeId, limit: `stand ${stand.name}`, toStand: stand.name, endConnectors: [] }];
  } else {
    return { ok: false, reason: 'A taxi instruction needs a holding point or stand' };
  }

  // The aircraft may continue along the taxiways it is already on before joining the cleared route.
  const startConnectors = graph
    .linksFrom(from.nodeId)
    .map((l) => l.edge.name)
    .filter((n): n is string => n !== null);

  let best: { route: NonNullable<ReturnType<SurfaceGraph['findRoute']>>; target: (typeof targets)[number] } | null = null;
  for (const target of targets) {
    const route = graph.findRoute({
      fromNodeId: from.nodeId,
      toNodeId: target.nodeId,
      ...(req.via !== undefined ? { via: req.via, startConnectors, endConnectors: target.endConnectors } : {}),
      allowedRunways: req.crossRunways ?? [],
      initialHeadingDeg: from.headingTrueDeg,
      maxTurnDeg: perf.maxTurnDeg,
    });
    if (route !== null && (best === null || route.lengthM < best.route.lengthM)) best = { route, target };
  }
  if (best === null) {
    const via = req.via !== undefined ? ` via ${req.via.join(', ')}` : '';
    const cross = req.crossRunways !== undefined ? '' : ' without crossing a runway';
    return { ok: false, reason: `No taxi route to ${req.holdingPoint ?? `stand ${req.stand}`}${via}${cross}` };
  }
  const points = [...from.prefix, ...pointsFor(graph, projection, best.route.nodeIds)];
  return { ok: true, path: new Path(points), limit: best.target.limit, toStand: best.target.toStand };
}

/**
 * Where a new taxi route can start: the aircraft's node if stopped at one, otherwise the next
 * node ahead on its current path (the aircraft keeps rolling to it).
 */
export function taxiStart(state: SurfaceState): { nodeId: string; headingTrueDeg: number; prefix: PathPoint[] } | null {
  if (state.motion === null) {
    return state.nodeId === null ? null : { nodeId: state.nodeId, headingTrueDeg: state.headingTrueDeg, prefix: [] };
  }
  const { path, s } = state.motion;
  const next = path.nextNodeFrom(s);
  if (next === null) return null;
  const prefix: PathPoint[] = [{ x: state.x, y: state.y, nodeId: null }, ...path.points.slice(path.segmentAt(s) + 1, next.index + 1)];
  const reverse = state.motion.kind === 'pushback';
  // After pushback the aircraft faces opposite to its travel direction.
  const heading = reverse ? state.headingTrueDeg : path.segmentBearingAt(Math.max(0, path.cumulative[next.index]! - 0.01));
  return { nodeId: next.nodeId, headingTrueDeg: heading, prefix };
}

/**
 * Advances a moving aircraft by dt seconds. Speed builds up to the limit, slows for turns and
 * brakes to stop at the end of the path (or straight away when told to hold position).
 * Returns true when the aircraft has reached the end of its path.
 */
export function advanceSurface(state: SurfaceState, perf: GroundPerformance, dt: number): boolean {
  const m = state.motion;
  if (m === null) return false;
  const pushback = m.kind === 'pushback';
  const maxSpeed = pushback ? perf.maxPushbackSpeedMps : perf.maxTaxiSpeedMps;
  const accel = pushback ? perf.pushbackAccelMps2 : perf.taxiAccelMps2;
  const decel = pushback ? perf.pushbackAccelMps2 : perf.taxiDecelMps2;
  const path = m.path;
  const remaining = path.length - m.s;
  // Limits are measured from where the aircraft will be after this step, so braking is not a step late.
  const sNext = Math.min(path.length, m.s + state.speedMps * dt);

  let allowed = maxSpeed;
  if (m.holdClearanceId !== null) {
    allowed = 0;
  } else {
    // Braking to stop at the end of the path
    allowed = Math.min(allowed, Math.sqrt(2 * decel * (path.length - sNext)));
    // Slowing for turns ahead (only within stopping distance of the current speed matters)
    if (!pushback) {
      const horizon = m.s + (state.speedMps * state.speedMps) / (2 * decel) + 30;
      for (let i = path.segmentAt(m.s) + 1; i < path.points.length - 1 && path.cumulative[i]! <= horizon; i++) {
        const limit = Math.max(perf.minCornerSpeedMps, Math.sqrt(perf.lateralAccelMps2 * path.turnRadiusAt(i)));
        const distance = Math.max(0, path.cumulative[i]! - sNext);
        if (limit < maxSpeed) allowed = Math.min(allowed, Math.sqrt(limit * limit + 2 * decel * distance));
      }
    }
    // Never stall short of the end
    if (remaining > 0.3) allowed = Math.max(allowed, Math.min(0.5, maxSpeed));
  }

  state.speedMps = state.speedMps < allowed ? Math.min(allowed, state.speedMps + accel * dt) : Math.max(allowed, state.speedMps - decel * dt);
  m.s = Math.min(path.length, m.s + state.speedMps * dt);

  const pos = path.positionAt(m.s);
  state.x = pos.x;
  state.y = pos.y;
  if (path.length > 0.5) {
    const travel = path.travelBearingAt(Math.min(m.s, path.length - 0.5), perf.headingLookaheadM);
    state.headingTrueDeg = pushback ? (travel + 180) % 360 : travel;
  }

  const arrived = path.length - m.s < 0.05;
  if (arrived) state.speedMps = 0;
  return arrived;
}
