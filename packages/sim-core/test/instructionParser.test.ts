import { describe, expect, it } from 'vitest';
import { parseInstruction, type ParseContext } from '../src/atc/instructionParser';

const ctx: ParseContext = {
  callsigns: ['TST101', 'TST102'],
  holdingPoints: ['A10E', 'A10W', 'N4W'],
  stands: ['501', '503', '211L'],
  taxiways: ['A', 'B', 'LINK 56', 'LINK 58', 'A10E'],
  runways: ['09L/27R', '09R/27L'],
};

const parse = (text: string, extra: Partial<ParseContext> = {}) => parseInstruction(text, { ...ctx, ...extra });

describe('parseInstruction', () => {
  it('parses pushback in full and short forms', () => {
    expect(parse('TST101 push back approved face east')).toEqual({
      ok: true,
      callsign: 'TST101',
      commands: [{ kind: 'pushback', params: { face: 'E' } }],
      summary: 'TST101 push back face E',
    });
    expect(parse('tst101 pb w')).toMatchObject({ ok: true, commands: [{ kind: 'pushback', params: { face: 'W' } }] });
    expect(parse('TST101 pushback approved')).toMatchObject({ ok: true, commands: [{ kind: 'pushback', params: {} }] });
  });

  it('parses taxi to a holding point with a multi-word via list and a runway crossing', () => {
    const r = parse('TST101 taxi to holding point A10E via LINK 56, LINK 58 and A cross runway 09R');
    expect(r).toEqual({
      ok: true,
      callsign: 'TST101',
      commands: [{ kind: 'taxi', params: { holdingPoint: 'A10E', via: 'LINK 56,LINK 58,A', crossRunways: '09R/27L' } }],
      summary: 'TST101 taxi holding point A10E via LINK 56, LINK 58, A crossing 09R/27L',
    });
  });

  it('parses taxi to a stand', () => {
    expect(parse('TST102 taxi stand 211l')).toMatchObject({ ok: true, commands: [{ kind: 'taxi', params: { stand: '211L' } }] });
  });

  it('parses hold position and continue taxi', () => {
    expect(parse('TST101 hold position')).toMatchObject({ ok: true, commands: [{ kind: 'holdPosition' }] });
    expect(parse('TST101 continue taxi')).toMatchObject({ ok: true, commands: [{ kind: 'continueTaxi' }] });
  });

  it('uses the selected aircraft when no callsign is given', () => {
    expect(parse('hold position', { defaultCallsign: 'TST102' })).toMatchObject({ ok: true, callsign: 'TST102' });
    expect(parse('hold position')).toEqual({ ok: false, error: 'Unknown callsign "HOLD"', callsign: null });
  });

  it('reports what it could not understand', () => {
    expect(parse('TST101 taxi A99')).toEqual({ ok: false, error: 'Unknown holding point A99', callsign: 'TST101' });
    expect(parse('TST101 taxi A10E via Q')).toEqual({ ok: false, error: 'Unknown taxiway Q', callsign: 'TST101' });
    expect(parse('TST101 taxi A10E cross 05')).toEqual({ ok: false, error: 'Unknown runway 05', callsign: 'TST101' });
    expect(parse('TST101 climb to the moon')).toEqual({ ok: false, error: 'Did not understand "CLIMB TO THE MOON"', callsign: 'TST101' });
    expect(parse('TST101')).toEqual({ ok: false, error: 'No instruction after the callsign', callsign: 'TST101' });
  });
});
