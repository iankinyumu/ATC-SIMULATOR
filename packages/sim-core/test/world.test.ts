import { describe, expect, it } from 'vitest';
import { replay } from '../src/world/replay';
import { addAircraft, assertNoOverlappingTransmissions, makeWorld } from './helpers';

// Any command that needs no surface position will do for radio tests.
const squawk = { kind: 'squawk', params: {} } as const;

describe('Instruction and readback', () => {
  it('pilot reads back 2–5 s after the instruction ends and the clearance becomes active (D4)', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const w = makeWorld(['GND'], seed);
      addAircraft(w, 'TST101');
      const result = w.apply({ type: 'issueInstruction', positionId: 'GND', callsign: 'TST101', commands: [squawk], text: 'squawk', durationMs: 3000 });
      expect(result.ok).toBe(true);
      w.runFor(15_000);

      const [instructionEnd] = w.log.ofType('TransmissionEnded');
      const readbackStart = w.log.ofType('TransmissionStarted')[1];
      const gap = readbackStart!.t - instructionEnd!.t;
      expect(gap).toBeGreaterThanOrEqual(2000);
      expect(gap).toBeLessThanOrEqual(5000);

      const [clearance] = w.clearances.forAircraft('TST101');
      expect(clearance!.state).toBe('active');
      expect(clearance!.history.map((h) => h.state)).toEqual(['assigned', 'transmitted', 'acknowledged', 'active']);
    }
  });

  it('keeps one transmission at a time on a busy frequency and flags player transmissions while busy (D7)', () => {
    const w = makeWorld(['GND']);
    for (const cs of ['TST1', 'TST2', 'TST3']) addAircraft(w, cs);
    w.apply({ type: 'issueInstruction', positionId: 'GND', callsign: 'TST1', commands: [squawk], text: 'squawk', durationMs: 2000 });
    w.step(); // first transmission is now on the air
    w.apply({ type: 'issueInstruction', positionId: 'GND', callsign: 'TST2', commands: [squawk], text: 'squawk', durationMs: 2000 });
    w.apply({ type: 'issueInstruction', positionId: 'GND', callsign: 'TST3', commands: [squawk], text: 'squawk', durationMs: 2000 });
    w.runFor(60_000);

    assertNoOverlappingTransmissions(w.log);
    expect(w.log.ofType('FrequencyBusyViolation')).toHaveLength(2);
    expect(w.log.ofType('TransmissionEnded')).toHaveLength(6); // 3 instructions + 3 readbacks
    expect(w.clearances.all().every((c) => c.state === 'active')).toBe(true);
  });

  it('gets no reply from an aircraft that is not on the frequency', () => {
    const w = makeWorld(['GND']);
    w.apply({
      type: 'addAircraft',
      aircraft: { callsign: 'TST9', typeDesignator: null, tunedFrequencyId: 'F-TWR', controllingPositionId: 'GND' },
    });
    w.apply({ type: 'issueInstruction', positionId: 'GND', callsign: 'TST9', commands: [squawk], text: 'squawk', durationMs: 2000 });
    w.runFor(20_000);
    expect(w.log.ofType('TransmissionStarted')).toHaveLength(1);
    expect(w.clearances.forAircraft('TST9')[0]!.state).toBe('transmitted');
  });
});

describe('Authority model', () => {
  it('rejects instructions from a position that does not control the aircraft', () => {
    const w = makeWorld(['GND', 'TWR']);
    addAircraft(w, 'TST1', 'GND');
    const r = w.apply({ type: 'issueInstruction', positionId: 'TWR', callsign: 'TST1', commands: [{ kind: 'lineUp', params: {} }], text: 'line up' });
    expect(r).toEqual({ ok: false, reason: 'TST1 is not under the control of TWR' });
    expect(w.clearances.all()).toHaveLength(0);
    expect(w.log.ofType('InputRejected')).toHaveLength(1);
  });

  it('rejects command kinds the position is not authorised for', () => {
    const w = makeWorld(['GND']);
    addAircraft(w, 'TST1');
    const r = w.apply({ type: 'issueInstruction', positionId: 'GND', callsign: 'TST1', commands: [{ kind: 'takeoff', params: {} }], text: 'cleared take off' });
    expect(r.ok).toBe(false);
  });

  it('rejects a frequency change without an accepted handoff', () => {
    const w = makeWorld(['GND']);
    addAircraft(w, 'TST1');
    const r = w.apply({
      type: 'issueInstruction',
      positionId: 'GND',
      callsign: 'TST1',
      commands: [{ kind: 'frequencyChange', params: { toPositionId: 'TWR' } }],
      text: 'contact tower',
    });
    expect(r).toEqual({ ok: false, reason: 'TWR has not accepted a handoff of TST1' });
  });
});

describe('Speech recognition failures', () => {
  it('pilot says "say again" when the callsign was recognised but the instruction was not', () => {
    const w = makeWorld(['GND']);
    addAircraft(w, 'TST1');
    w.apply({ type: 'unrecognisedTransmission', positionId: 'GND', callsign: 'TST1', text: 'mumble', durationMs: 1500 });
    w.runFor(10_000);
    const kinds = w.log.ofType('TransmissionQueued').map((e) => e.event.kind);
    expect(kinds).toEqual(['unrecognised', 'sayAgain']);
    expect(w.clearances.all()).toHaveLength(0);
  });

  it('nobody answers when the callsign was not recognised', () => {
    const w = makeWorld(['GND']);
    addAircraft(w, 'TST1');
    w.apply({ type: 'unrecognisedTransmission', positionId: 'GND', callsign: null, text: 'mumble', durationMs: 1500 });
    w.runFor(10_000);
    expect(w.log.ofType('TransmissionQueued')).toHaveLength(1);
  });
});

describe('Handoff', () => {
  function handoffToBotTower() {
    const w = makeWorld(['GND']); // Tower is run by a bot
    addAircraft(w, 'TST1');
    const h = w.apply({ type: 'initiateHandoff', callsign: 'TST1', fromPositionId: 'GND', toPositionId: 'TWR' });
    expect(h.ok).toBe(true);
    w.runFor(15_000); // bot accepts within 3–10 s
    expect(w.handoffs.openFor('TST1')!.state).toBe('accepted');

    const r = w.apply({
      type: 'issueInstruction',
      positionId: 'GND',
      callsign: 'TST1',
      commands: [{ kind: 'frequencyChange', params: { toPositionId: 'TWR' } }],
      text: 'contact tower',
      durationMs: 2000,
    });
    expect(r.ok).toBe(true);
    w.runFor(30_000);
    return w;
  }

  it('transfers control after the aircraft calls the receiving position', () => {
    const w = handoffToBotTower();
    const aircraft = w.getAircraft('TST1')!;
    expect(aircraft.tunedFrequencyId).toBe('F-TWR');
    expect(aircraft.controllingPositionId).toBe('TWR');
    expect(w.handoffs.all()[0]!.history.map((h) => h.state)).toEqual(['initiated', 'accepted', 'communicationTransferred', 'completed']);

    const types = w.log.all().map((e) => e.event.type);
    const initialCallEnd = w.log
      .ofType('TransmissionEnded')
      .find((e) => e.event.frequencyId === 'F-TWR')!.seq;
    expect(types.indexOf('ControlTransferred')).toBeGreaterThan(initialCallEnd);
  });

  it('waits for the player when the player works the receiving position', () => {
    const w = makeWorld(['GND', 'TWR']);
    addAircraft(w, 'TST1');
    const h = w.apply({ type: 'initiateHandoff', callsign: 'TST1', fromPositionId: 'GND', toPositionId: 'TWR' });
    w.runFor(30_000);
    const handoffId = h.ok ? h.ids[0]! : '';
    expect(w.handoffs.get(handoffId)!.state).toBe('initiated');
    expect(w.apply({ type: 'acceptHandoff', handoffId, positionId: 'GND' }).ok).toBe(false);
    expect(w.apply({ type: 'acceptHandoff', handoffId, positionId: 'TWR' }).ok).toBe(true);
  });

  it('replays to an identical event log', () => {
    const original = handoffToBotTower();
    const copy = replay(original.config, original.log.all(), original.now);
    expect(copy.now).toBe(original.now);
    expect(JSON.stringify(copy.log.all())).toBe(JSON.stringify(original.log.all()));
  });
});
