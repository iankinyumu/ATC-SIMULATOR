import type { Provenanced } from '../data/provenance';

/** Simulation-wide parameters that are not airport data. Every value carries its provenance. */
export interface SimParameters {
  stepMs: Provenanced<number>;
  pilotResponseDelayMs: Provenanced<{ min: number; max: number }>;
  speechWordsPerSecond: Provenanced<number>;
  minTransmissionMs: Provenanced<number>;
  botHandoffAcceptDelayMs: Provenanced<{ min: number; max: number }>;
}

export const DEFAULT_PARAMETERS: SimParameters = {
  stepMs: {
    value: 100,
    units: 'ms',
    provenance: { status: 'placeholder', tier: 6, note: 'Engine tick length. Not an aviation value.' },
  },
  pilotResponseDelayMs: {
    value: { min: 2000, max: 5000 },
    units: 'ms game time',
    provenance: { status: 'owner-decision', note: 'Decision D4: pilots respond 2–5 s after a transmission ends.' },
  },
  speechWordsPerSecond: {
    value: 2.5,
    units: 'words/s',
    provenance: {
      status: 'placeholder',
      tier: 6,
      note: 'Only used to estimate transmission length when real audio duration is unknown (spec §22).',
    },
  },
  minTransmissionMs: {
    value: 1000,
    units: 'ms game time',
    provenance: { status: 'placeholder', tier: 6, note: 'Lower bound for estimated transmission length.' },
  },
  botHandoffAcceptDelayMs: {
    value: { min: 3000, max: 10000 },
    units: 'ms game time',
    provenance: { status: 'placeholder', tier: 6, note: 'How long a bot controller takes to accept a handoff.' },
  },
};
