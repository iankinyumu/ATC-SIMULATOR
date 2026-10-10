import { describe, expect, it } from 'vitest';
import { radioCallsign } from '../src/aircraft/operators';
import { parseInstruction } from '../src/atc/instructionParser';
import { readbackText, requestText, spellDesignator, stationName, toSpoken } from '../src/phraseology/phraseology';
import { addAircraft, makeWorld } from './helpers';

describe('phraseology: written text', () => {
  const names = (id: string) => ({ TWR: 'Tower', GND: 'Ground' })[id];

  it('builds readbacks ending with the callsign', () => {
    expect(readbackText([{ kind: 'pushback', params: { face: 'E' } }], 'TST101', names)).toBe('PUSH BACK APPROVED, FACE EAST, TST101');
    expect(readbackText([{ kind: 'taxi', params: { holdingPoint: 'A10E', via: 'LINK 56,A' } }], 'TST101', names)).toBe(
      'TAXI HOLDING POINT A10E VIA LINK 56, A, TST101',
    );
    expect(readbackText([{ kind: 'taxi', params: { stand: '541', crossRunways: '09R/27L' } }], 'TST2', names)).toBe('TAXI STAND 541, CROSS RUNWAY 09R/27L, TST2');
    expect(readbackText([{ kind: 'frequencyChange', params: { toPositionId: 'TWR' } }], 'TST1', names)).toBe('CONTACT TOWER, TST1');
  });

  it('builds pilot requests addressed to the station', () => {
    expect(stationName('Ground')).toBe('GROUND');
    expect(requestText('pushback', 'TST101', 'GROUND', '501')).toBe('GROUND, TST101, STAND 501, REQUEST PUSHBACK');
    expect(requestText('taxi', 'TST101', 'GROUND', null)).toBe('TST101, READY FOR TAXI');
    expect(requestText('taxiToStand', 'TST201', 'GROUND', '541')).toBe('GROUND, TST201, VACATED, REQUEST TAXI TO STAND 541');
  });

  it('gives readbacks real text in the world', () => {
    const w = makeWorld(['GND']);
    addAircraft(w, 'TST1');
    w.apply({ type: 'issueInstruction', positionId: 'GND', callsign: 'TST1', commands: [{ kind: 'squawk', params: { code: '4721' } }], text: 'squawk', durationMs: 1000 });
    w.runFor(10_000);
    const readback = w.log.ofType('TransmissionQueued').find((e) => e.event.kind === 'readback')!;
    expect(readback.event.text).toBe('SQUAWK 4721, TST1');
  });
});

describe('radio callsigns', () => {
  it('pilots identify themselves with their radio callsign', () => {
    const w = makeWorld(['GND']);
    w.apply({
      type: 'addAircraft',
      aircraft: { callsign: 'BAW23K', radioCallsign: 'SPEEDBIRD 23K', typeDesignator: null, tunedFrequencyId: 'F-GND', controllingPositionId: 'GND' },
    });
    w.apply({ type: 'issueInstruction', positionId: 'GND', callsign: 'BAW23K', commands: [{ kind: 'squawk', params: { code: '4721' } }], text: 'x', durationMs: 1000 });
    w.runFor(10_000);
    const readback = w.log.ofType('TransmissionQueued').find((e) => e.event.kind === 'readback')!;
    expect(readback.event.text).toBe('SQUAWK 4721, SPEEDBIRD 23K');
    expect(toSpoken(readback.event.text)).toBe('Squawk four seven two one, speedbird two three Kilo.');
  });

  it('accepts either form when typing', () => {
    const ctx = {
      callsigns: ['BAW23K'],
      callsignAliases: { 'SPEEDBIRD 23K': 'BAW23K' },
      holdingPoints: [],
      stands: [],
      taxiways: [],
      runways: [],
    };
    expect(parseInstruction('speedbird 23k hold position', ctx)).toMatchObject({ ok: true, callsign: 'BAW23K' });
    expect(parseInstruction('BAW23K hold position', ctx)).toMatchObject({ ok: true, callsign: 'BAW23K' });
  });

  it('derives the radio callsign from the operator', () => {
    const ops = [{ icao: 'BAW', name: 'British Airways', telephony: 'SPEEDBIRD', terminal: 'T5', weight: 1, fleet: ['A320'] }];
    expect(radioCallsign('BAW23K', ops)).toBe('SPEEDBIRD 23K');
    expect(radioCallsign('ZZZ1', ops)).toBe('ZZZ1');
  });
});

describe('phraseology: spoken form', () => {
  it('spells designators with the spelling alphabet and radiotelephony digits', () => {
    expect(spellDesignator('A10E')).toBe('Alpha one zero Echo');
    expect(spellDesignator('TST139')).toBe('Tango Sierra Tango one three niner');
    expect(spellDesignator('545')).toBe('five four five');
  });

  it('turns transmission text into words', () => {
    expect(toSpoken('GROUND, TST101, STAND 501, REQUEST PUSHBACK')).toBe(
      'Ground, Tango Sierra Tango one zero one, stand five zero one, request pushback.',
    );
    expect(toSpoken('TAXI HOLDING POINT A10E VIA LINK 56, A, TST101')).toBe(
      'Taxi holding point Alpha one zero Echo via link five six, Alpha, Tango Sierra Tango one zero one.',
    );
    expect(toSpoken('TAXI STAND 541, CROSS RUNWAY 09R/27L, TST2')).toBe(
      'Taxi stand five four one, cross runway zero niner right, Tango Sierra Tango two.',
    );
  });
});
