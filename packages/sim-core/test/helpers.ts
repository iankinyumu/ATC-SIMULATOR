import { readFileSync } from 'node:fs';
import { loadDataset, type Dataset } from '../src/data/dataset';
import type { EventLog } from '../src/events/eventLog';
import { World } from '../src/world/world';

export const START = Date.UTC(2026, 9, 1, 7, 0, 0);

export function rawTestDataset(): unknown {
  return JSON.parse(readFileSync(new URL('./fixtures/test-airport.json', import.meta.url), 'utf8'));
}

export function testDataset(): Dataset {
  return loadDataset(rawTestDataset());
}

export function makeWorld(playerPositionIds: string[] = ['GND'], seed = 42): World {
  return new World({ dataset: testDataset(), seed, scenarioVersion: 'test-1', startTimeMs: START, playerPositionIds });
}

export function addAircraft(world: World, callsign: string, positionId = 'GND'): void {
  const frequencyId = world.getPosition(positionId)!.frequencyId;
  const result = world.apply({
    type: 'addAircraft',
    aircraft: { callsign, typeDesignator: null, tunedFrequencyId: frequencyId, controllingPositionId: positionId },
  });
  if (!result.ok) throw new Error(result.reason);
}

/** Checks Decision D7: on each frequency, no transmission starts before the previous one ends. */
export function assertNoOverlappingTransmissions(log: EventLog): void {
  const lastEnd = new Map<string, number>();
  for (const e of log.ofType('TransmissionStarted')) {
    const previous = lastEnd.get(e.event.frequencyId);
    if (previous !== undefined && e.t < previous) {
      throw new Error(`${e.event.transmissionId} started at ${e.t} before the previous transmission ended at ${previous}`);
    }
    lastEnd.set(e.event.frequencyId, e.event.endsAt);
  }
}
