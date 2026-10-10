import type { GameTimeMs } from '../time/clock';
import { StateMachineStore, type Tracked, type TransitionListener } from './stateMachine';

/**
 * Handoff lifecycle (spec §20, §45 F).
 *
 * ASSUMPTION A1 (to confirm against CAP 493): control of the aircraft passes to the receiving
 * position when the aircraft makes its initial call on the new frequency ('completed'), not when
 * the handoff is accepted.
 */
export type HandoffState =
  | 'initiated'
  | 'accepted'
  | 'rejected'
  | 'cancelled'
  /** Aircraft has read back the frequency change and left the old frequency. */
  | 'communicationTransferred'
  /** Aircraft has called the receiving position; control has passed. */
  | 'completed';

export const HANDOFF_TRANSITIONS: Readonly<Record<HandoffState, readonly HandoffState[]>> = {
  initiated: ['accepted', 'rejected', 'cancelled'],
  accepted: ['communicationTransferred', 'cancelled'],
  communicationTransferred: ['completed'],
  rejected: [],
  cancelled: [],
  completed: [],
};

const OPEN_STATES: readonly HandoffState[] = ['initiated', 'accepted', 'communicationTransferred'];

export interface Handoff extends Tracked<HandoffState> {
  readonly callsign: string;
  readonly fromPositionId: string;
  readonly toPositionId: string;
}

export class HandoffStore extends StateMachineStore<HandoffState, Handoff> {
  constructor(now: () => GameTimeMs, listener: TransitionListener<Handoff, HandoffState>) {
    super('Handoff', 'HO', HANDOFF_TRANSITIONS, now, listener);
  }

  initiate(callsign: string, fromPositionId: string, toPositionId: string): Handoff {
    if (this.openFor(callsign) !== undefined) throw new Error(`${callsign} already has an open handoff`);
    return this.add((id) => ({ id, callsign, fromPositionId, toPositionId, state: 'initiated', history: [] }));
  }

  /** The handoff for this aircraft that has not yet finished, if any. */
  openFor(callsign: string): Handoff | undefined {
    return this.all().find((h) => h.callsign === callsign && OPEN_STATES.includes(h.state));
  }
}
