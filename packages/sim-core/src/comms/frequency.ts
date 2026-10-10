import type { GameTimeMs } from '../time/clock';

export type Speaker =
  | { readonly kind: 'controller'; readonly positionId: string }
  | { readonly kind: 'pilot'; readonly callsign: string };

export type TransmissionKind =
  /** Controller instruction carrying one or more clearances. */
  | 'instruction'
  /** Pilot readback of an instruction. */
  | 'readback'
  /** Pilot asking the controller to repeat. */
  | 'sayAgain'
  /** Pilot's first call on a new frequency. */
  | 'initialCall'
  /** Controller transmission that speech recognition could not turn into a command. */
  | 'unrecognised'
  /** Pilot-initiated request (pushback, ready for taxi, stand). */
  | 'request'
  /** Pilot report (e.g. holding at a holding point). */
  | 'report';

/** Lower number transmits first when several stations are waiting (spec §23A). */
export const TransmissionPriority = {
  /** The player has already spoken, so their transmission goes next. */
  player: 0,
  readback: 1,
  controller: 2,
  pilotCall: 3,
} as const;

export interface Transmission {
  readonly id: string;
  readonly frequencyId: string;
  readonly speaker: Speaker;
  readonly kind: TransmissionKind;
  /** Aircraft the transmission concerns, or null if no callsign was recognised. */
  readonly callsign: string | null;
  /** Spoken text. Built by the phraseology system once it exists (spec §21). */
  readonly text: string;
  readonly durationMs: number;
  readonly priority: number;
  readonly clearanceIds: readonly string[];
  readonly requestedAt: GameTimeMs;
}

export interface ActiveTransmission {
  readonly tx: Transmission;
  readonly startedAt: GameTimeMs;
  readonly endsAt: GameTimeMs;
}

export interface ChannelHooks {
  onStart(active: ActiveTransmission): void;
  onEnd(active: ActiveTransmission): void;
}

/**
 * A half-duplex radio frequency. Only one transmission is ever active (Decision D7); everything
 * else waits in a priority queue.
 */
export class FrequencyChannel {
  private current: ActiveTransmission | null = null;
  private readonly queue: Array<{ tx: Transmission; seq: number }> = [];
  private nextSeq = 0;

  constructor(readonly id: string) {}

  get busy(): boolean {
    return this.current !== null;
  }

  get active(): ActiveTransmission | null {
    return this.current;
  }

  get pending(): readonly Transmission[] {
    return this.queue.map((q) => q.tx);
  }

  enqueue(tx: Transmission): void {
    if (tx.frequencyId !== this.id) throw new Error(`Transmission ${tx.id} is for ${tx.frequencyId}, not ${this.id}`);
    this.queue.push({ tx, seq: this.nextSeq++ });
    this.queue.sort((a, b) => a.tx.priority - b.tx.priority || a.tx.requestedAt - b.tx.requestedAt || a.seq - b.seq);
  }

  /** Ends the active transmission if it is over, then starts the next waiting one. */
  update(now: GameTimeMs, hooks: ChannelHooks): void {
    if (this.current !== null && now >= this.current.endsAt) {
      const ended = this.current;
      this.current = null;
      hooks.onEnd(ended);
    }
    if (this.current === null) {
      const next = this.queue.shift();
      if (next !== undefined) {
        this.current = { tx: next.tx, startedAt: now, endsAt: now + next.tx.durationMs };
        hooks.onStart(this.current);
      }
    }
  }
}

/** Estimates transmission length from its text, for use when the real audio length is unknown. */
export function estimateDurationMs(text: string, wordsPerSecond: number, minMs: number): number {
  const words = text.trim().split(/\s+/).filter((w) => w.length > 0).length;
  return Math.max(minMs, Math.round((words / wordsPerSecond) * 1000));
}
