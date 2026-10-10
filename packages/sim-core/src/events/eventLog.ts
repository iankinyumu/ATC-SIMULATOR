import type { ClearanceState } from '../atc/clearance';
import type { CommandKind } from '../atc/commands';
import type { HandoffState } from '../atc/handoff';
import type { Speaker, TransmissionKind } from '../comms/frequency';
import type { SurfacePhase } from '../movement/surfaceMovement';
import type { RequestKind, RequestState } from '../pilots/requests';
import type { GameTimeMs } from '../time/clock';
import type { WorldInput } from '../world/inputs';

export type SimEvent =
  | {
      type: 'SessionStarted';
      airport: string;
      datasetVersion: string;
      scenarioVersion: string;
      seed: number;
      playerPositionIds: readonly string[];
    }
  | { type: 'Input'; input: WorldInput }
  | { type: 'InputRejected'; inputType: WorldInput['type']; reason: string }
  | { type: 'AircraftAdded'; callsign: string; tunedFrequencyId: string | null; controllingPositionId: string | null }
  | {
      type: 'TransmissionQueued';
      transmissionId: string;
      frequencyId: string;
      speaker: Speaker;
      kind: TransmissionKind;
      callsign: string | null;
      text: string;
      durationMs: number;
    }
  | { type: 'TransmissionStarted'; transmissionId: string; frequencyId: string; endsAt: GameTimeMs }
  | { type: 'TransmissionEnded'; transmissionId: string; frequencyId: string }
  | { type: 'FrequencyBusyViolation'; frequencyId: string; positionId: string; transmissionId: string }
  | {
      type: 'ClearanceStateChanged';
      clearanceId: string;
      callsign: string;
      commandKind: CommandKind;
      from: ClearanceState | null;
      to: ClearanceState;
      reason?: string;
    }
  | {
      type: 'HandoffStateChanged';
      handoffId: string;
      callsign: string;
      fromPositionId: string;
      toPositionId: string;
      from: HandoffState | null;
      to: HandoffState;
      reason?: string;
    }
  | { type: 'AircraftFrequencyChanged'; callsign: string; from: string | null; to: string }
  | {
      type: 'RequestStateChanged';
      requestId: string;
      callsign: string;
      kind: RequestKind;
      stand: string | null;
      from: RequestState | null;
      to: RequestState;
      reason?: string;
    }
  | { type: 'RequestRepeated'; requestId: string; callsign: string; calls: number }
  | {
      type: 'SurfacePhaseChanged';
      callsign: string;
      from: SurfacePhase | null;
      to: SurfacePhase;
      /** Clearance limit or stand, e.g. "A10E", "stand 501", "end of pushback". */
      detail: string | null;
      /** Path length for a new movement, metres. */
      pathLengthM?: number;
    }
  | { type: 'ControlTransferred'; callsign: string; fromPositionId: string | null; toPositionId: string };

export type SimEventType = SimEvent['type'];

export interface LoggedEvent<E extends SimEvent = SimEvent> {
  readonly seq: number;
  readonly t: GameTimeMs;
  readonly event: E;
}

/** Append-only record of every input and state change in a session (spec §35, Rule 5). */
export class EventLog {
  private readonly entries: LoggedEvent[] = [];

  append(t: GameTimeMs, event: SimEvent): LoggedEvent {
    const entry: LoggedEvent = { seq: this.entries.length, t, event };
    this.entries.push(entry);
    return entry;
  }

  all(): readonly LoggedEvent[] {
    return this.entries;
  }

  ofType<K extends SimEventType>(type: K): LoggedEvent<Extract<SimEvent, { type: K }>>[] {
    return this.entries.filter((e): e is LoggedEvent<Extract<SimEvent, { type: K }>> => e.event.type === type);
  }
}

/** One readable line per event, for development logging (Rule 5). */
export function formatEvent(entry: LoggedEvent): string {
  const { type, ...fields } = entry.event;
  const details = Object.entries(fields)
    .map(([key, value]) => {
      if (key === 'endsAt' && typeof value === 'number') return `${key}=${formatGameTime(value)}`;
      return `${key}=${typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value)}`;
    })
    .join(' ');
  return `${formatGameTime(entry.t)}  ${type.padEnd(24)} ${details}`;
}

/** HH:MM:SS.mmm (UTC) */
export function formatGameTime(t: GameTimeMs): string {
  return new Date(t).toISOString().slice(11, 23);
}
