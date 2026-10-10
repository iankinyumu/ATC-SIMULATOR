import { describe, expect, it } from 'vitest';
import { ClearanceStore } from '../src/atc/clearance';
import { HandoffStore } from '../src/atc/handoff';
import { PlayerSession } from '../src/atc/session';
import { IllegalTransitionError } from '../src/atc/stateMachine';
import { FrequencyChannel, TransmissionPriority, type Transmission } from '../src/comms/frequency';
import { DEFAULT_PARAMETERS } from '../src/config/parameters';
import { loadDataset } from '../src/data/dataset';
import { collectProvenance } from '../src/data/provenance';
import { Rng } from '../src/random/rng';
import { SimClock } from '../src/time/clock';
import { Scheduler } from '../src/time/scheduler';
import { rawTestDataset, testDataset } from './helpers';

describe('Rng', () => {
  it('produces the same sequence for the same seed', () => {
    const a = new Rng(123);
    const b = new Rng(123);
    expect(Array.from({ length: 5 }, () => a.nextUint32())).toEqual(Array.from({ length: 5 }, () => b.nextUint32()));
  });

  it('derives independent streams per label', () => {
    expect(Rng.derive(1, 'pilot').nextUint32()).not.toBe(Rng.derive(1, 'traffic').nextUint32());
    expect(Rng.derive(1, 'pilot').nextUint32()).toBe(Rng.derive(1, 'pilot').nextUint32());
  });

  it('keeps intInclusive within bounds', () => {
    const rng = new Rng(7);
    for (let i = 0; i < 1000; i++) {
      const v = rng.intInclusive(2, 5);
      expect(v).toBeGreaterThanOrEqual(2);
      expect(v).toBeLessThanOrEqual(5);
    }
  });
});

describe('SimClock', () => {
  it('runs no steps while paused', () => {
    const clock = new SimClock(0, 100);
    clock.pause();
    expect(clock.stepsForRealElapsed(1000)).toBe(0);
  });

  it('multiplies steps by speed', () => {
    const clock = new SimClock(0, 100);
    expect(clock.stepsForRealElapsed(1000)).toBe(10);
    clock.setSpeed(4);
    expect(clock.stepsForRealElapsed(1000)).toBe(40);
  });

  it('caps catch-up steps', () => {
    const clock = new SimClock(0, 100, 50);
    expect(clock.stepsForRealElapsed(60_000)).toBe(50);
  });
});

describe('Scheduler', () => {
  it('runs tasks in time order, then in scheduling order', () => {
    const s = new Scheduler();
    const order: string[] = [];
    s.schedule(200, () => order.push('b'));
    s.schedule(100, () => order.push('a'));
    s.schedule(200, () => order.push('c'));
    s.runDue(150);
    expect(order).toEqual(['a']);
    s.runDue(200);
    expect(order).toEqual(['a', 'b', 'c']);
  });
});

describe('FrequencyChannel', () => {
  const tx = (id: string, priority: number, requestedAt = 0): Transmission => ({
    id,
    frequencyId: 'F',
    speaker: { kind: 'pilot', callsign: id },
    kind: 'initialCall',
    callsign: id,
    text: '',
    durationMs: 1000,
    priority,
    clearanceIds: [],
    requestedAt,
  });

  it('transmits one at a time, readbacks before new calls', () => {
    const ch = new FrequencyChannel('F');
    const started: string[] = [];
    const hooks = { onStart: (a: { tx: Transmission }) => started.push(a.tx.id), onEnd: () => {} };
    ch.enqueue(tx('call', TransmissionPriority.pilotCall));
    ch.enqueue(tx('readback', TransmissionPriority.readback));
    ch.update(0, hooks);
    expect(started).toEqual(['readback']);
    ch.update(500, hooks);
    expect(started).toEqual(['readback']);
    ch.update(1000, hooks);
    expect(started).toEqual(['readback', 'call']);
  });
});

describe('State machines', () => {
  it('walks a clearance through its normal lifecycle', () => {
    const store = new ClearanceStore(() => 0, () => {});
    const c = store.create('TST1', 'GND', { kind: 'taxi', params: {} }, 'assigned');
    for (const s of ['transmitted', 'acknowledged', 'active', 'completed'] as const) store.transition(c.id, s);
    expect(c.history.map((h) => h.state)).toEqual(['assigned', 'transmitted', 'acknowledged', 'active', 'completed']);
  });

  it('rejects illegal clearance transitions', () => {
    const store = new ClearanceStore(() => 0, () => {});
    const c = store.create('TST1', 'GND', { kind: 'taxi', params: {} }, 'assigned');
    expect(() => store.transition(c.id, 'active')).toThrow(IllegalTransitionError);
  });

  it('allows only one open handoff per aircraft', () => {
    const store = new HandoffStore(() => 0, () => {});
    const h = store.initiate('TST1', 'GND', 'TWR');
    expect(() => store.initiate('TST1', 'GND', 'TWR')).toThrow();
    store.transition(h.id, 'rejected');
    expect(store.openFor('TST1')).toBeUndefined();
  });
});

describe('Dataset', () => {
  it('loads the test fixture', () => {
    const d = testDataset();
    expect(d.meta.isTestFixture).toBe(true);
    expect(d.positions).toHaveLength(5);
  });

  it('rejects a position that uses an unknown frequency', () => {
    const raw = rawTestDataset() as { positions: Array<{ frequencyId: string }> };
    raw.positions[0]!.frequencyId = 'F-NOPE';
    expect(() => loadDataset(raw)).toThrow(/unknown frequency/);
  });

  it('rejects a function assigned to two positions', () => {
    const raw = rawTestDataset() as { positions: Array<{ functions: string[] }> };
    raw.positions[1]!.functions.push('ground');
    expect(() => loadDataset(raw)).toThrow(/assigned to both/);
  });

  it('rejects a sourced value without a citation', () => {
    const raw = rawTestDataset() as { positions: Array<{ allowedCommands: { provenance: object } }> };
    raw.positions[0]!.allowedCommands.provenance = { status: 'sourced' };
    expect(() => loadDataset(raw)).toThrow(/citation/);
  });
});

describe('Provenance register', () => {
  it('lists every placeholder in the parameters and dataset', () => {
    const entries = [...collectProvenance(DEFAULT_PARAMETERS), ...collectProvenance(testDataset())];
    const placeholders = entries.filter((e) => e.provenance.status === 'placeholder').map((e) => e.path);
    expect(placeholders).toContain('stepMs');
    expect(placeholders).toContain('positions[0].allowedCommands');
    const pilot = entries.find((e) => e.path === 'pilotResponseDelayMs');
    expect(pilot?.provenance.status).toBe('owner-decision');
  });
});

describe('PlayerSession', () => {
  const d = testDataset();

  it('allows any combination of two positions', () => {
    expect(new PlayerSession(['GND', 'CTR'], d).isPlayer('CTR')).toBe(true);
  });

  it('rejects more than two positions', () => {
    expect(() => new PlayerSession(['GND', 'TWR', 'DEP'], d)).toThrow();
  });

  it('rejects unknown or duplicate positions', () => {
    expect(() => new PlayerSession(['XXX'], d)).toThrow();
    expect(() => new PlayerSession(['GND', 'GND'], d)).toThrow();
  });
});
