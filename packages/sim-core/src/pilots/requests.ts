import { StateMachineStore, type Tracked, type TransitionListener } from '../atc/stateMachine';
import type { GameTimeMs } from '../time/clock';

/** What a pilot is asking Ground for. */
export type RequestKind =
  /** Parked departure, ready to push back. */
  | 'pushback'
  /** Departure after pushback and engine start, ready to taxi. */
  | 'taxi'
  /** Arrival after vacating the runway, asking to taxi to its stand. */
  | 'taxiToStand';

export type RequestState = 'pending' | 'granted' | 'withdrawn';

export const REQUEST_TRANSITIONS: Readonly<Record<RequestState, readonly RequestState[]>> = {
  pending: ['granted', 'withdrawn'],
  granted: [],
  withdrawn: [],
};

export interface PilotRequest extends Tracked<RequestState> {
  readonly callsign: string;
  readonly kind: RequestKind;
  /** Stand asked for (taxiToStand) or the stand the aircraft is on (pushback). */
  readonly stand: string | null;
  /** When the pilot last called about it (repeat calls update this). */
  lastCallAt: GameTimeMs;
  calls: number;
}

export class RequestStore extends StateMachineStore<RequestState, PilotRequest> {
  constructor(now: () => GameTimeMs, listener: TransitionListener<PilotRequest, RequestState>) {
    super('Request', 'REQ', REQUEST_TRANSITIONS, now, listener);
  }

  raise(callsign: string, kind: RequestKind, stand: string | null, at: GameTimeMs): PilotRequest {
    return this.add((id) => ({ id, callsign, kind, stand, lastCallAt: at, calls: 1, state: 'pending', history: [] }));
  }

  pending(): PilotRequest[] {
    return this.all().filter((r) => r.state === 'pending');
  }

  pendingFor(callsign: string, kind?: RequestKind): PilotRequest | undefined {
    return this.all().find((r) => r.callsign === callsign && r.state === 'pending' && (kind === undefined || r.kind === kind));
  }

  hasRaised(callsign: string, kind: RequestKind): boolean {
    return this.all().some((r) => r.callsign === callsign && r.kind === kind);
  }
}
