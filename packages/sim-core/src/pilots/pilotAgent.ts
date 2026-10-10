import type { Provenanced } from '../data/provenance';
import type { Rng } from '../random/rng';
import type { GameTimeMs } from '../time/clock';
import type { RequestKind } from './requests';

/** What a flight intends to do on the ground. Set by the scenario. */
export type FlightIntent =
  /** Departure parked on a stand, ready to push back at `readyAtMs` (game time). */
  | { readonly kind: 'departure'; readonly readyAtMs: GameTimeMs }
  /** Arrival that has vacated the runway and is going to `stand`. */
  | { readonly kind: 'arrival'; stand: string };

export interface PilotTiming {
  /** Engine start and checks after pushback, before calling ready for taxi. */
  startupDelayMs: { min: number; max: number };
  /** How long after vacating the runway an arrival calls Ground. */
  vacateCallDelayMs: { min: number; max: number };
  /** How long a pilot waits for an answer before calling again. */
  repeatAfterMs: number;
  /** Most calls about one request (first call + repeats); after that the pilot waits. */
  maxCalls: number;
}

export const DEFAULT_PILOT_TIMING: Provenanced<PilotTiming> = {
  value: {
    startupDelayMs: { min: 30_000, max: 90_000 },
    vacateCallDelayMs: { min: 3_000, max: 10_000 },
    repeatAfterMs: 90_000,
    maxCalls: 3,
  },
  units: 'ms game time',
  provenance: { status: 'placeholder', tier: 6, note: 'Pilot behaviour timings. No authoritative source; tune for realism.' },
};

/** What the pilot agent can see and do. The World implements it; pilots never move aircraft directly. */
export interface PilotWorld {
  readonly now: GameTimeMs;
  flights(): ReadonlyArray<{
    readonly callsign: string;
    readonly flight: FlightIntent;
    readonly phase: string;
    readonly standName: string | null;
    /** True when the aircraft is listening on its controlling position's frequency. */
    readonly onFrequency: boolean;
  }>;
  hasRequested(callsign: string, kind: RequestKind): boolean;
  /** Whether the controller has already given this kind of instruction (so there is nothing to ask for). */
  hasClearance(callsign: string, kind: 'pushback' | 'taxi'): boolean;
  pendingRequests(): ReadonlyArray<{ readonly id: string; readonly callsign: string; readonly lastCallAt: GameTimeMs; readonly calls: number }>;
  raiseRequest(callsign: string, kind: RequestKind, stand: string | null): void;
  repeatRequest(requestId: string): void;
  /** Pilot reports holding at a clearance limit. */
  reportHolding(callsign: string, limit: string): void;
}

interface Memory {
  /** Earliest time the pilot will call ready for taxi (set when pushback completes). */
  readyForTaxiAt: GameTimeMs | null;
  /** Earliest time an arrival calls Ground. */
  arrivalCallAt: GameTimeMs | null;
  reportedHolding: string | null;
}

/**
 * Rule-based pilots for every flight (spec §19A). They make the calls that drive Ground work:
 * request pushback, ready for taxi, arrival stand requests, holding reports, and repeat calls
 * when not answered. Deterministic: all randomness comes from the seeded stream passed in.
 */
export class PilotAgent {
  private readonly memory = new Map<string, Memory>();

  constructor(
    private readonly rng: Rng,
    private readonly timing: PilotTiming,
  ) {}

  private mem(callsign: string): Memory {
    let m = this.memory.get(callsign);
    if (m === undefined) {
      m = { readyForTaxiAt: null, arrivalCallAt: null, reportedHolding: null };
      this.memory.set(callsign, m);
    }
    return m;
  }

  private delay(range: { min: number; max: number }): number {
    return this.rng.intInclusive(range.min, range.max);
  }

  /** Told by the World when a pushback or taxi movement finishes. */
  onMovementCompleted(callsign: string, kind: 'pushback' | 'taxi', now: GameTimeMs, limit: string, toStand: boolean): void {
    const m = this.mem(callsign);
    if (kind === 'pushback') m.readyForTaxiAt = now + this.delay(this.timing.startupDelayMs);
    else if (!toStand) m.reportedHolding = m.reportedHolding === limit ? limit : `report:${limit}`;
  }

  /** Called once per simulation step. */
  update(world: PilotWorld): void {
    const now = world.now;
    for (const f of world.flights()) {
      if (!f.onFrequency) continue;
      const m = this.mem(f.callsign);

      if (f.flight.kind === 'departure') {
        if (f.phase === 'parked' && now >= f.flight.readyAtMs && !world.hasRequested(f.callsign, 'pushback') && !world.hasClearance(f.callsign, 'pushback')) {
          world.raiseRequest(f.callsign, 'pushback', f.standName);
        }
        if (m.readyForTaxiAt !== null && now >= m.readyForTaxiAt && f.phase === 'holding' && !world.hasRequested(f.callsign, 'taxi') && !world.hasClearance(f.callsign, 'taxi')) {
          world.raiseRequest(f.callsign, 'taxi', null);
        }
      } else if (f.phase === 'holding' && !world.hasRequested(f.callsign, 'taxiToStand') && !world.hasClearance(f.callsign, 'taxi')) {
        if (m.arrivalCallAt === null) m.arrivalCallAt = now + this.delay(this.timing.vacateCallDelayMs);
        if (now >= m.arrivalCallAt) world.raiseRequest(f.callsign, 'taxiToStand', f.flight.stand);
      }

      if (m.reportedHolding?.startsWith('report:') === true) {
        const limit = m.reportedHolding.slice('report:'.length);
        m.reportedHolding = limit;
        world.reportHolding(f.callsign, limit);
      }
    }

    for (const r of world.pendingRequests()) {
      if (r.calls < this.timing.maxCalls && now - r.lastCallAt >= this.timing.repeatAfterMs) world.repeatRequest(r.id);
    }
  }
}
