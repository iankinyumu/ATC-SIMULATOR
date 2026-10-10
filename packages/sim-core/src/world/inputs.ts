import type { Command } from '../atc/commands';
import type { FlightIntent } from '../pilots/pilotAgent';

export interface AircraftInit {
  readonly callsign: string;
  /** ICAO type designator, or null until aircraft type data exists. */
  readonly typeDesignator: string | null;
  readonly tunedFrequencyId: string | null;
  readonly controllingPositionId: string | null;
  /** Parks the aircraft on this stand (needs a surface dataset). */
  readonly standName?: string;
  /** Places the aircraft stopped on the taxi network instead (e.g. an arrival that has vacated). */
  readonly position?: { readonly nodeId: string; readonly headingTrueDeg: number };
  /** What the flight will do; drives the pilot's requests. */
  readonly flight?: FlightIntent;
  /** Radiotelephony callsign, e.g. "SPEEDBIRD 23K" for BAW23K. Defaults to the callsign. */
  readonly radioCallsign?: string;
}

/**
 * Everything that enters the simulation from outside: the player, the scenario, or recognised
 * speech. Every input is written to the event log, so a session can be replayed exactly (spec §35).
 */
export type WorldInput =
  | { readonly type: 'addAircraft'; readonly aircraft: AircraftInit }
  | {
      readonly type: 'issueInstruction';
      readonly positionId: string;
      readonly callsign: string;
      readonly commands: readonly Command[];
      readonly text: string;
      /** Real audio length when known; otherwise estimated from the text. */
      readonly durationMs?: number;
    }
  | {
      /** A controller transmission speech recognition could not turn into a command (spec §21A). */
      readonly type: 'unrecognisedTransmission';
      readonly positionId: string;
      /** The callsign if it was recognised, otherwise null. */
      readonly callsign: string | null;
      readonly text: string;
      readonly durationMs?: number;
    }
  | { readonly type: 'initiateHandoff'; readonly callsign: string; readonly fromPositionId: string; readonly toPositionId: string }
  | { readonly type: 'acceptHandoff'; readonly handoffId: string; readonly positionId: string };

export type InputResult = { readonly ok: true; readonly ids: readonly string[] } | { readonly ok: false; readonly reason: string };
