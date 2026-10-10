/**
 * Runs a short scripted session on the fictional test airport and prints the event log (Rule 5).
 *
 *   npm run demo
 */
import { readFileSync } from 'node:fs';
import { collectProvenance, DEFAULT_PARAMETERS, formatEvent, loadDataset, World } from '../src/index';

const dataset = loadDataset(JSON.parse(readFileSync(new URL('../test/fixtures/test-airport.json', import.meta.url), 'utf8')));
const world = new World({
  dataset,
  seed: 2026,
  scenarioVersion: 'demo-1',
  startTimeMs: Date.UTC(2026, 9, 1, 7, 0, 0),
  playerPositionIds: ['GND'], // Tower, Departure, Arrival and Center are run by bots
});

world.apply({
  type: 'addAircraft',
  aircraft: { callsign: 'TST101', typeDesignator: null, tunedFrequencyId: 'F-GND', controllingPositionId: 'GND' },
});
world.apply({ type: 'issueInstruction', positionId: 'GND', callsign: 'TST101', commands: [{ kind: 'taxi', params: {} }], text: 'TST101 taxi to holding point' });
world.runFor(10_000);

world.apply({ type: 'unrecognisedTransmission', positionId: 'GND', callsign: 'TST101', text: '(unclear)' });
world.runFor(10_000);

world.apply({ type: 'initiateHandoff', callsign: 'TST101', fromPositionId: 'GND', toPositionId: 'TWR' });
world.runFor(12_000);

world.apply({
  type: 'issueInstruction',
  positionId: 'GND',
  callsign: 'TST101',
  commands: [{ kind: 'frequencyChange', params: { toPositionId: 'TWR' } }],
  text: 'TST101 contact Tower',
});
world.runFor(20_000);

console.log('EVENT LOG');
for (const entry of world.log.all()) console.log(formatEvent(entry));

console.log('\nFINAL AIRCRAFT STATE');
console.log(world.getAircraft('TST101'));

console.log('\nPLACEHOLDER VALUES (provenance register)');
for (const e of [...collectProvenance(DEFAULT_PARAMETERS), ...collectProvenance(dataset)]) {
  if (e.provenance.status === 'placeholder') console.log(`  ${e.path}: ${JSON.stringify(e.value)} ${e.units ?? ''}`);
}
