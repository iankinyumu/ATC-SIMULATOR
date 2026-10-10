import type { Provenanced } from '../data/provenance';

/** How an aircraft moves on the ground. */
export interface GroundPerformance {
  /** Speed limit on straight taxiways. */
  maxTaxiSpeedMps: number;
  /** Lowest speed the turn limit can impose (corners in the source data can be sharper than real fillets). */
  minCornerSpeedMps: number;
  taxiAccelMps2: number;
  taxiDecelMps2: number;
  /** Sideways acceleration allowed in turns: corner speed = √(lateral × radius). */
  lateralAccelMps2: number;
  maxPushbackSpeedMps: number;
  pushbackAccelMps2: number;
  /** Largest direction change the aircraft can make at a junction while taxiing. */
  maxTurnDeg: number;
  /** How far the tug pushes the aircraft along the taxiway after leaving the stand line. */
  pushbackTaxiwayDistanceM: number;
  /** Distance ahead used to smooth heading through turns. */
  headingLookaheadM: number;
  /** Nominal aircraft length, for drawing. */
  lengthM: number;
}

const PLACEHOLDER = {
  status: 'placeholder',
  tier: 6,
  note: 'Generic jet ground handling. No AIP/CAP source; replace with type-specific data (spec §15).',
} as const;

/** Generic ground performance used until type-specific data exists. */
export const DEFAULT_GROUND_PERFORMANCE: Provenanced<GroundPerformance> = {
  value: {
    maxTaxiSpeedMps: 10.3, // ≈ 20 kt
    minCornerSpeedMps: 2.6, // ≈ 5 kt
    taxiAccelMps2: 0.5,
    taxiDecelMps2: 0.8,
    lateralAccelMps2: 0.5,
    maxPushbackSpeedMps: 1.0,
    pushbackAccelMps2: 0.2,
    maxTurnDeg: 120,
    pushbackTaxiwayDistanceM: 45,
    headingLookaheadM: 12,
    lengthM: 38,
  },
  units: 'SI (m, m/s, m/s², degrees)',
  provenance: PLACEHOLDER,
};
