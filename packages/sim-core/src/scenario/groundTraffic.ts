import type { AircraftType } from '../aircraft/aircraftTypes';
import { distanceM } from '../geo/geo';
import { Rng } from '../random/rng';
import type { SurfaceGraph } from '../surface/graph';
import type { Stand } from '../surface/surface';
import type { GameTimeMs } from '../time/clock';
import type { WorldInput } from '../world/inputs';
import type { World } from '../world/world';

export interface ScheduledInput {
  readonly atMs: GameTimeMs;
  readonly input: WorldInput;
}

/** Where a stream of flights comes from: one airline, its fleet, the stands it uses. */
export interface TrafficSource {
  /** Callsign prefix (ICAO operator designator), e.g. "BAW". */
  readonly icao: string;
  /** Radiotelephony designator, e.g. "SPEEDBIRD"; null to use the written callsign on the radio. */
  readonly telephony: string | null;
  /** Relative share of the generated traffic. */
  readonly weight: number;
  /** Aircraft types this source flies (ICAO type designators). */
  readonly types: readonly string[];
  /** Stands it may use (e.g. its terminal). */
  readonly standFilter: (stand: Stand) => boolean;
  /** Holding points where its arrivals appear after vacating the runway (scenario assumption). */
  readonly appearAtHoldingPoints: readonly string[];
}

export interface GroundTrafficOptions {
  readonly seed: number;
  readonly startTimeMs: GameTimeMs;
  readonly positionId: string;
  readonly frequencyId: string;
  readonly sources: readonly TrafficSource[];
  readonly departures: {
    readonly count: number;
    /** Ready-for-pushback times are spread across this window after the start. */
    readonly readyWindowMs: { readonly min: number; readonly max: number };
  };
  readonly arrivals: {
    readonly count: number;
    readonly firstAtMs: number;
    readonly intervalMs: { readonly min: number; readonly max: number };
  };
}

/**
 * Heading for an aircraft stopped at a node next to a runway: along the taxiway leading away from
 * the nearest runway point.
 */
export function headingAwayFromRunway(graph: SurfaceGraph, nodeId: string): number | null {
  const here = graph.node(nodeId);
  if (here === undefined) return null;
  let nearestRunway: { lat: number; lon: number } | null = null;
  let best = Infinity;
  for (const n of graph.data.nodes) {
    if (graph.runwaysAt(n.id).length === 0) continue;
    const d = distanceM(here, n);
    if (d < best) {
      best = d;
      nearestRunway = n;
    }
  }
  const links = graph.linksFrom(nodeId).filter((l) => l.edge.kind === 'taxiway' || l.edge.kind === 'taxilane');
  if (links.length === 0) return null;
  if (nearestRunway === null) return links[0]!.bearingDeg;
  const away = [...links].sort((a, b) => distanceM(graph.node(b.to)!, nearestRunway!) - distanceM(graph.node(a.to)!, nearestRunway!))[0]!;
  return away.bearingDeg;
}

/**
 * Generates a deterministic ground traffic sample: departures parked on stands that fit them,
 * ready to push back at staggered times, and a stream of arrivals that appear after vacating the
 * runway, each assigned a free stand that fits. Callsigns are placeholders (TST…), not real flights.
 */
/**
 * Generates a deterministic ground traffic sample: departures parked on stands that fit them,
 * ready to push back at staggered times, and a stream of arrivals that appear after vacating the
 * runway, each assigned a free stand that fits. Flights are drawn from the sources by weight.
 */
export function generateGroundTraffic(graph: SurfaceGraph, types: readonly AircraftType[], opts: GroundTrafficOptions): ScheduledInput[] {
  const rng = Rng.derive(opts.seed, 'ground-traffic');
  const typeByIcao = new Map(types.map((t) => [t.icao, t]));
  const sources = opts.sources.filter((s) => s.types.some((t) => typeByIcao.has(t)));
  const totalWeight = sources.reduce((sum, s) => sum + s.weight, 0);
  const pick = <T>(list: readonly T[]): T => list[rng.intInclusive(0, list.length - 1)]!;
  const pickSource = (): TrafficSource => {
    let r = rng.next() * totalWeight;
    for (const s of sources) {
      r -= s.weight;
      if (r < 0) return s;
    }
    return sources[sources.length - 1]!;
  };

  const stands = graph.data.stands.filter((s) => s.stopNodeId !== null && s.headingTrueDeg !== null);
  const usedStands = new Set<string>();
  const takeStand = (source: TrafficSource, type: AircraftType): Stand | null => {
    const free = stands.filter(
      (s) =>
        source.standFilter(s) &&
        !usedStands.has(s.name) &&
        !s.conflictsWith.some((c) => usedStands.has(c)) &&
        (s.maxWingspanM === null || type.wingspanM <= s.maxWingspanM),
    );
    if (free.length === 0) return null;
    const stand = pick(free);
    usedStands.add(stand.name);
    return stand;
  };

  // Flight numbers: 1–4 digits, sometimes with letters, as airlines file them (e.g. BAW23K).
  const usedCallsigns = new Set<string>();
  const callsignFor = (source: TrafficSource): string => {
    for (;;) {
      const digits = String(rng.intInclusive(1, rng.next() < 0.6 ? 999 : 2999));
      const letters = 'ABCDEFGHJKLMNPRSTUVWXYZ';
      const suffix = rng.next() < 0.3 ? letters[rng.intInclusive(0, letters.length - 1)]! : '';
      const callsign = `${source.icao}${digits}${suffix}`;
      if (!usedCallsigns.has(callsign)) {
        usedCallsigns.add(callsign);
        return callsign;
      }
    }
  };

  /** A flight from a random source whose fleet has a type that fits a free stand. */
  const flight = () => {
    for (let attempt = 0; attempt < 50; attempt++) {
      const source = pickSource();
      const type = typeByIcao.get(pick(source.types.filter((t) => typeByIcao.has(t))))!;
      const stand = takeStand(source, type);
      if (stand === null) continue;
      const callsign = callsignFor(source);
      const radioCallsign = source.telephony === null ? callsign : `${source.telephony} ${callsign.slice(source.icao.length)}`;
      return { source, type, stand, callsign, radioCallsign };
    }
    return null;
  };

  const base = { tunedFrequencyId: opts.frequencyId, controllingPositionId: opts.positionId };
  const out: ScheduledInput[] = [];

  for (let i = 0; i < opts.departures.count; i++) {
    const f = flight();
    if (f === null) break;
    const readyAtMs = opts.startTimeMs + rng.intInclusive(opts.departures.readyWindowMs.min, opts.departures.readyWindowMs.max);
    out.push({
      atMs: opts.startTimeMs,
      input: {
        type: 'addAircraft',
        aircraft: { ...base, callsign: f.callsign, radioCallsign: f.radioCallsign, typeDesignator: f.type.icao, standName: f.stand.name, flight: { kind: 'departure', readyAtMs } },
      },
    });
  }

  let t = opts.startTimeMs + opts.arrivals.firstAtMs;
  for (let i = 0; i < opts.arrivals.count; i++) {
    const f = flight();
    if (f === null) break;
    const appearAt = f.source.appearAtHoldingPoints
      .map((name) => graph.holdingPoints(name)[0])
      .filter((h): h is NonNullable<typeof h> => h !== undefined)
      .map((h) => ({ nodeId: h.nodeId, heading: headingAwayFromRunway(graph, h.nodeId) }))
      .filter((p): p is { nodeId: string; heading: number } => p.heading !== null);
    if (appearAt.length === 0) continue;
    const where = pick(appearAt);
    out.push({
      atMs: t,
      input: {
        type: 'addAircraft',
        aircraft: {
          ...base,
          callsign: f.callsign,
          radioCallsign: f.radioCallsign,
          typeDesignator: f.type.icao,
          position: { nodeId: where.nodeId, headingTrueDeg: where.heading },
          flight: { kind: 'arrival', stand: f.stand.name },
        },
      },
    });
    t += rng.intInclusive(opts.arrivals.intervalMs.min, opts.arrivals.intervalMs.max);
  }
  return out.sort((a, b) => a.atMs - b.atMs);
}

/** Applies scheduled inputs to the world when their time comes. */
export class InputSchedule {
  private next = 0;
  constructor(private readonly items: readonly ScheduledInput[]) {}

  applyDue(world: World): void {
    while (this.next < this.items.length && this.items[this.next]!.atMs <= world.now) {
      world.apply(this.items[this.next]!.input);
      this.next++;
    }
  }

  /** Inputs not yet applied. */
  get remaining(): number {
    return this.items.length - this.next;
  }
}
