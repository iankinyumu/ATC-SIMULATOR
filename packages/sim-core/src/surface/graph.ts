import { trueBearingDeg } from '../geo/geo';
import type { HoldingPoint, Stand, SurfaceDataset, SurfaceEdge, SurfaceNode } from './surface';

/**
 * Stand family for MARS stands: "457L" and "457R" belong to "457" when stand "457" exists. A centre
 * stand and its L/R stands overlap, so only the centre or the L/R pair can be used at once.
 * Other stands are their own family.
 */
export function standFamily(name: string, allNames: readonly string[]): string {
  const m = /^(.*\d)[LR]$/i.exec(name);
  return m !== null && allNames.includes(m[1]!) ? m[1]! : name;
}

/** Canonical form of a taxiway name: "Taxiway a" → "A", "Link 22" → "LINK 22". */
export function normaliseTaxiwayName(name: string): string {
  return name.trim().toUpperCase().replace(/^TAXIWAY\s+/, '').replace(/\s+/g, ' ');
}

export interface RouteRequest {
  readonly fromNodeId: string;
  readonly toNodeId: string;
  /**
   * Taxiways to follow, in order (e.g. ["A", "LINK 22"]). Omit for free routing over any
   * taxiway, taxilane or stand lead-in (never runways).
   */
  readonly via?: readonly string[];
  /** Taxiways the aircraft may use before joining the first `via` taxiway (e.g. the one it is on). */
  readonly startConnectors?: readonly string[];
  /** Taxiways the aircraft may use after the last `via` taxiway (e.g. the holding point's taxiway). */
  readonly endConnectors?: readonly string[];
  /**
   * Runways the aircraft has been cleared to cross or use (e.g. ["09L/27R"]). Without this, the
   * route cannot pass through any point on a runway, including where a taxiway crosses it.
   */
  readonly allowedRunways?: readonly string[];
  /** Current true heading of the aircraft; with `maxTurnDeg`, limits the first turn too. */
  readonly initialHeadingDeg?: number;
  /** Largest change of direction allowed at any node (aircraft cannot reverse or U-turn). */
  readonly maxTurnDeg?: number;
}

export interface Route {
  readonly nodeIds: readonly string[];
  readonly edgeIds: readonly string[];
  readonly lengthM: number;
}

interface Link {
  readonly edge: SurfaceEdge;
  readonly to: string;
  /** True bearing when travelling along the edge towards `to`. */
  readonly bearingDeg: number;
}

/** Minimal binary min-heap keyed by cost. */
class MinHeap<T> {
  private readonly items: Array<{ cost: number; seq: number; value: T }> = [];
  private seq = 0;

  get size(): number {
    return this.items.length;
  }

  push(cost: number, value: T): void {
    const items = this.items;
    items.push({ cost, seq: this.seq++, value });
    let i = items.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      [items[i], items[p]] = [items[p]!, items[i]!];
      i = p;
    }
  }

  pop(): { cost: number; value: T } | undefined {
    const items = this.items;
    const top = items[0];
    if (top === undefined) return undefined;
    const last = items.pop()!;
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < items.length && this.less(l, m)) m = l;
        if (r < items.length && this.less(r, m)) m = r;
        if (m === i) break;
        [items[i], items[m]] = [items[m]!, items[i]!];
        i = m;
      }
    }
    return top;
  }

  private less(a: number, b: number): boolean {
    const x = this.items[a]!;
    const y = this.items[b]!;
    return x.cost < y.cost || (x.cost === y.cost && x.seq < y.seq);
  }
}

/** Read-only movement-area graph built from a surface dataset. */
export class SurfaceGraph {
  private readonly nodes = new Map<string, SurfaceNode>();
  private readonly links = new Map<string, Link[]>();
  private readonly holdingByName = new Map<string, HoldingPoint[]>();
  private readonly standsByName = new Map<string, Stand>();
  /** Runways each node lies on. A taxi route may not enter these nodes without clearance for that runway. */
  private readonly runwaysAtNode = new Map<string, Set<string>>();

  constructor(readonly data: SurfaceDataset) {
    for (const n of data.nodes) {
      this.nodes.set(n.id, n);
      this.links.set(n.id, []);
    }
    for (const e of data.edges) {
      const a = this.nodes.get(e.from)!;
      const b = this.nodes.get(e.to)!;
      this.links.get(e.from)!.push({ edge: e, to: e.to, bearingDeg: trueBearingDeg(a, b) });
      this.links.get(e.to)!.push({ edge: e, to: e.from, bearingDeg: trueBearingDeg(b, a) });
      if (e.kind === 'runway') {
        const runway = (e.name ?? '?').toUpperCase();
        for (const n of [e.from, e.to]) this.runwaysAtNode.set(n, (this.runwaysAtNode.get(n) ?? new Set()).add(runway));
      }
    }
    for (const h of data.holdingPoints) {
      if (h.name === null) continue;
      const key = normaliseTaxiwayName(h.name);
      this.holdingByName.set(key, [...(this.holdingByName.get(key) ?? []), h]);
    }
    for (const s of data.stands) this.standsByName.set(s.name.toUpperCase(), s);
  }

  node(id: string): SurfaceNode | undefined {
    return this.nodes.get(id);
  }

  /** All holding points published with this designator (some designators appear more than once). */
  holdingPoints(name: string): readonly HoldingPoint[] {
    return this.holdingByName.get(normaliseTaxiwayName(name)) ?? [];
  }

  stand(name: string): Stand | undefined {
    return this.standsByName.get(name.toUpperCase());
  }

  /** Runways (e.g. "09L/27R") that a node lies on, including taxiway crossing points. */
  runwaysAt(nodeId: string): readonly string[] {
    return [...(this.runwaysAtNode.get(nodeId) ?? [])];
  }

  /** Taxiway names present in the network geometry. */
  taxiwayNames(): string[] {
    const names = new Set<string>();
    for (const e of this.data.edges) if (e.kind === 'taxiway' && e.name !== null) names.add(normaliseTaxiwayName(e.name));
    return [...names].sort();
  }

  /** Edges leaving a node, with the true bearing of each in the direction of travel. */
  linksFrom(nodeId: string): ReadonlyArray<{ readonly edge: SurfaceEdge; readonly to: string; readonly bearingDeg: number }> {
    return this.links.get(nodeId) ?? [];
  }

  /** Shortest route that obeys the request's taxiway sequence and turn limits, or null if none exists. */
  findRoute(req: RouteRequest): Route | null {
    if (!this.nodes.has(req.fromNodeId) || !this.nodes.has(req.toNodeId)) return null;
    const via = req.via?.map(normaliseTaxiwayName);
    const n = via?.length ?? 0;
    const start = new Set((req.startConnectors ?? []).map(normaliseTaxiwayName));
    const end = new Set((req.endConnectors ?? []).map(normaliseTaxiwayName));
    const runways = new Set((req.allowedRunways ?? []).map((r) => r.toUpperCase()));
    const maxTurn = req.maxTurnDeg;

    /** Progress through `via` after taking this edge at progress i, or null if not allowed. */
    const advance = (edge: SurfaceEdge, i: number): number | null => {
      const name = edge.name === null ? null : normaliseTaxiwayName(edge.name);
      if (edge.kind === 'runway') return name !== null && runways.has(name) ? i : null;
      if (via === undefined) return i;
      if (name !== null && i >= 1 && name === via[i - 1]) return i;
      if (name !== null && i < n && name === via[i]) return i + 1;
      const isConnector = edge.kind === 'taxilane' || edge.kind === 'standLead';
      if (i === 0 && (isConnector || (name !== null && start.has(name)))) return i;
      if (i === n && (isConnector || (name !== null && end.has(name)))) return i;
      return null;
    };

    // With a turn limit, the state must include the direction of arrival at the node.
    interface State {
      readonly node: string;
      readonly i: number;
      readonly heading: number | null;
      readonly via: string;
    }
    const key = (s: State) => (maxTurn === undefined ? `${s.node}|${s.i}` : `${s.node}|${s.i}|${s.via}`);
    const best = new Map<string, number>();
    const previous = new Map<string, { key: string; edgeId: string; node: string }>();
    const heap = new MinHeap<State>();
    const first: State = { node: req.fromNodeId, i: 0, heading: req.initialHeadingDeg ?? null, via: '' };
    best.set(key(first), 0);
    heap.push(0, first);

    while (heap.size > 0) {
      const { cost, value } = heap.pop()!;
      const k = key(value);
      if (cost > (best.get(k) ?? Infinity)) continue;
      if (value.node === req.toNodeId && value.i === n) return this.buildRoute(k, value.node, previous, cost);
      for (const link of this.links.get(value.node)!) {
        const next = advance(link.edge, value.i);
        if (next === null) continue;
        if (maxTurn !== undefined && value.heading !== null) {
          const turn = Math.abs(((link.bearingDeg - value.heading + 540) % 360) - 180);
          if (turn > maxTurn) continue;
        }
        // Entering or crossing a runway needs clearance for that runway, whichever edge is used.
        const runwaysAhead = this.runwaysAtNode.get(link.to);
        if (runwaysAhead !== undefined && [...runwaysAhead].some((r) => !runways.has(r))) continue;
        const nextState: State = { node: link.to, i: next, heading: link.bearingDeg, via: value.node };
        const nk = key(nextState);
        const nextCost = cost + link.edge.lengthM;
        if (nextCost < (best.get(nk) ?? Infinity)) {
          best.set(nk, nextCost);
          previous.set(nk, { key: k, edgeId: link.edge.id, node: value.node });
          heap.push(nextCost, nextState);
        }
      }
    }
    return null;
  }

  private buildRoute(goalKey: string, goalNode: string, previous: Map<string, { key: string; edgeId: string; node: string }>, lengthM: number): Route {
    const nodeIds: string[] = [goalNode];
    const edgeIds: string[] = [];
    let k = goalKey;
    for (let p = previous.get(k); p !== undefined; p = previous.get(k)) {
      edgeIds.push(p.edgeId);
      nodeIds.push(p.node);
      k = p.key;
    }
    return { nodeIds: nodeIds.reverse(), edgeIds: edgeIds.reverse(), lengthM };
  }
}
