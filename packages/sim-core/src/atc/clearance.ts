import type { GameTimeMs } from '../time/clock';
import type { Command } from './commands';
import { StateMachineStore, type Tracked, type TransitionListener } from './stateMachine';

/** Clearance lifecycle (spec §45 E). */
export type ClearanceState =
  /** Known from the flight plan or procedure, not yet issued. */
  | 'planned'
  /** Issued by a controller and validated, waiting to be transmitted. */
  | 'assigned'
  /** Transmission has ended; waiting for the pilot. */
  | 'transmitted'
  /** Pilot has read back. */
  | 'acknowledged'
  /** Aircraft is acting on it. */
  | 'active'
  | 'completed'
  | 'cancelled';

export const CLEARANCE_TRANSITIONS: Readonly<Record<ClearanceState, readonly ClearanceState[]>> = {
  planned: ['assigned', 'cancelled'],
  assigned: ['transmitted', 'cancelled'],
  // Back to 'assigned' when it has to be transmitted again (e.g. after "say again").
  transmitted: ['acknowledged', 'assigned', 'cancelled'],
  acknowledged: ['active', 'cancelled'],
  active: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

export interface Clearance extends Tracked<ClearanceState> {
  readonly callsign: string;
  readonly positionId: string;
  readonly command: Command;
}

export class ClearanceStore extends StateMachineStore<ClearanceState, Clearance> {
  constructor(now: () => GameTimeMs, listener: TransitionListener<Clearance, ClearanceState>) {
    super('Clearance', 'CLR', CLEARANCE_TRANSITIONS, now, listener);
  }

  create(callsign: string, positionId: string, command: Command, initial: 'planned' | 'assigned'): Clearance {
    return this.add((id) => ({ id, callsign, positionId, command, state: initial, history: [] }));
  }

  forAircraft(callsign: string): Clearance[] {
    return this.all().filter((c) => c.callsign === callsign);
  }
}
