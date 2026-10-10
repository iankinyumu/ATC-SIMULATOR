import { describe, expect, it } from 'vitest';
import type { AircraftType } from '../src/aircraft/aircraftTypes';
import { codeLetter } from '../src/aircraft/aircraftTypes';
import { generateGroundTraffic, headingAwayFromRunway, InputSchedule } from '../src/scenario/groundTraffic';
import { SurfaceGraph } from '../src/surface/graph';
import { loadSurfaceDataset, type SurfaceDataset, type SurfaceEdge } from '../src/surface/surface';
import type { AircraftInit } from '../src/world/inputs';
import { replay } from '../src/world/replay';
import { World } from '../src/world/world';
import { START, testDataset } from './helpers';

const M_PER_DEG = 111_195;

const TYPES: AircraftType[] = [
  { icao: 'A320', name: 'Test narrowbody', wakeCategory: 'M', wingspanM: 35.8, lengthM: 37.6 },
  { icao: 'B77W', name: 'Test widebody', wakeCategory: 'H', wingspanM: 64.8, lengthM: 73.9 },
];

/**
 * Synthetic layout (metres, x east / y north), not a real airport:
 *
 *   r0 ─────────────── rX ─────────────── r1      runway "09/27" at y = 300
 *                       |  B
 *                      b1 (1000,200)  holding point "B1"
 *                       |
 *   a0 ── w ── a2 ── w3 ── a3 ── a4               taxiway A at y = 0 (holds "HW" at a0, "HE" at a4)
 *              |            |  \
 *             s1           s2   s3                stands "1" (≤36 m), "2" (≤65 m), "3" (overlaps "2")
 */
function surface(): SurfaceDataset {
  const node = (id: string, x: number, y: number) => ({ id, lat: y / M_PER_DEG, lon: x / M_PER_DEG });
  const nodes = [
    node('a0', 0, 0), node('w', 455, 0), node('a2', 500, 0), node('w3', 705, 0), node('a3', 750, 0), node('a4', 1000, 0),
    node('s1', 500, -120), node('s2', 750, -120), node('s3', 765, -118),
    node('b1', 1000, 200), node('rX', 1000, 300), node('r0', 800, 300), node('r1', 1200, 300),
  ];
  const xy = new Map(nodes.map((n) => [n.id, { x: n.lon * M_PER_DEG, y: n.lat * M_PER_DEG }]));
  const edge = (from: string, to: string, kind: SurfaceEdge['kind'], name: string | null): SurfaceEdge => {
    const a = xy.get(from)!;
    const b = xy.get(to)!;
    return { id: `${from}-${to}`, from, to, kind, name, lengthM: Math.hypot(b.x - a.x, b.y - a.y), sourceId: 'test' };
  };
  const stand = (name: string, stop: string, entry: string, x: number, y: number, maxWingspanM: number, conflictsWith: string[] = []) => ({
    id: `stand:${name}`, name, position: { lat: y / M_PER_DEG, lon: x / M_PER_DEG }, headingTrueDeg: 180,
    entryNodeId: entry, stopNodeId: stop, maxWingspanM, maxWingspanSourceId: 'test', conflictsWith, sourceId: 'test',
  });
  return loadSurfaceDataset({
    meta: { airport: 'ZZZZ', datasetVersion: 'test', airac: null, referencePoint: { lat: 0, lon: 0 } },
    sources: [{ id: 'test', name: 'Synthetic', version: '1', licence: 'n/a', provenance: { status: 'placeholder', tier: 6 } }],
    runways: [],
    publishedTaxiways: [],
    nodes,
    edges: [
      edge('a0', 'w', 'taxiway', 'A'), edge('w', 'a2', 'taxiway', 'A'), edge('a2', 'w3', 'taxiway', 'A'),
      edge('w3', 'a3', 'taxiway', 'A'), edge('a3', 'a4', 'taxiway', 'A'),
      edge('s1', 'a2', 'standLead', '1'), edge('s2', 'a3', 'standLead', '2'), edge('s3', 'a3', 'standLead', '3'),
      edge('a4', 'b1', 'taxiway', 'B'), edge('b1', 'rX', 'taxiway', 'B'),
      edge('r0', 'rX', 'runway', '09/27'), edge('rX', 'r1', 'runway', '09/27'),
    ],
    holdingPoints: [
      { id: 'h1', name: 'HW', nodeId: 'a0', type: 'intermediate', sourceId: 'test' },
      { id: 'h2', name: 'HE', nodeId: 'a4', type: 'intermediate', sourceId: 'test' },
      { id: 'h3', name: 'B1', nodeId: 'b1', type: 'runway', sourceId: 'test' },
    ],
    stands: [stand('1', 's1', 'a2', 500, -120, 36), stand('2', 's2', 'a3', 750, -120, 65, ['3']), stand('3', 's3', 'a3', 765, -118, 36, ['2'])],
  });
}

function makeWorld(seed = 11) {
  return new World({ dataset: testDataset(), surface: surface(), aircraftTypes: TYPES, seed, scenarioVersion: 'test', startTimeMs: START, playerPositionIds: ['GND'] });
}

const base = { tunedFrequencyId: 'F-GND', controllingPositionId: 'GND' } as const;
const add = (w: World, a: Omit<AircraftInit, 'tunedFrequencyId' | 'controllingPositionId'>) => w.apply({ type: 'addAircraft', aircraft: { ...base, ...a } });
const say = (w: World, callsign: string, kind: string, params: Record<string, string> = {}) =>
  w.apply({ type: 'issueInstruction', positionId: 'GND', callsign, commands: [{ kind: kind as never, params }], text: kind, durationMs: 2000 });

function runUntil(w: World, done: () => boolean, maxMs = 900_000): void {
  for (let t = 0; t < maxMs && !done(); t += w.clock.stepMs) w.step();
  if (!done()) throw new Error('condition not reached');
}

const requestsOf = (w: World, callsign: string) => w.requests.all().filter((r) => r.callsign === callsign).map((r) => `${r.kind}:${r.state}`);
const transmissions = (w: World, kind: string) => w.log.ofType('TransmissionQueued').filter((e) => e.event.kind === kind);

describe('Aircraft types', () => {
  it('derives the aerodrome reference code letter from wingspan', () => {
    expect(codeLetter(35.8)).toBe('C');
    expect(codeLetter(64.8)).toBe('E');
    expect(codeLetter(79.75)).toBe('F');
  });

  it('resolves types and rejects unknown ones', () => {
    const w = makeWorld();
    expect(add(w, { callsign: 'TST1', typeDesignator: 'A320', standName: '1' }).ok).toBe(true);
    expect(w.getAircraft('TST1')!.type?.wingspanM).toBe(35.8);
    expect(add(w, { callsign: 'TST2', typeDesignator: 'ZZZZ', standName: '2' })).toEqual({ ok: false, reason: 'Unknown aircraft type ZZZZ' });
  });
});

describe('Stands', () => {
  it('refuses a stand too small for the type', () => {
    const w = makeWorld();
    expect(add(w, { callsign: 'TST1', typeDesignator: 'B77W', standName: '1' })).toEqual({
      ok: false,
      reason: 'Stand 1 is too small for a B77W (wingspan 64.8 m, stand limit 36 m)',
    });
  });

  it('blocks a stand that is in use, and stands that overlap it', () => {
    const w = makeWorld();
    add(w, { callsign: 'TST1', typeDesignator: 'A320', standName: '2' });
    expect(w.standUser('2')).toBe('TST1');
    expect(w.standProblem('2', 'TST9', TYPES[0]!)).toBe('Stand 2 is in use by TST1');
    expect(w.standProblem('3', 'TST9', TYPES[0]!)).toBe('Stand 3 is blocked: overlapping stand 2 is in use by TST1');
    expect(w.standProblem('1', 'TST9', TYPES[0]!)).toBeNull();
  });
});

describe('Pilot requests: departure', () => {
  it('requests pushback when ready, then ready for taxi after pushback, and reports holding', () => {
    const w = makeWorld();
    add(w, { callsign: 'TST1', typeDesignator: 'A320', standName: '1', flight: { kind: 'departure', readyAtMs: START + 30_000 } });
    w.runFor(29_000);
    expect(requestsOf(w, 'TST1')).toEqual([]);
    runUntil(w, () => w.requests.pendingFor('TST1', 'pushback') !== undefined);
    expect(w.now).toBeGreaterThanOrEqual(START + 30_000);
    expect(transmissions(w, 'request').map((e) => e.event.text)).toEqual(['GROUND, TST1, STAND 1, REQUEST PUSHBACK']);

    expect(say(w, 'TST1', 'pushback', { face: 'E' }).ok).toBe(true);
    expect(requestsOf(w, 'TST1')).toEqual(['pushback:granted']);

    runUntil(w, () => w.requests.pendingFor('TST1', 'taxi') !== undefined);
    expect(w.getAircraft('TST1')!.surface!.phase).toBe('holding');
    expect(say(w, 'TST1', 'taxi', { holdingPoint: 'HE' }).ok).toBe(true);
    expect(requestsOf(w, 'TST1')).toEqual(['pushback:granted', 'taxi:granted']);

    runUntil(w, () => transmissions(w, 'report').length > 0);
    expect(transmissions(w, 'report')[0]!.event.text).toBe('TST1, HOLDING AT HE');
  });

  it('does not ask for what it has already been given', () => {
    const w = makeWorld();
    add(w, { callsign: 'TST1', typeDesignator: 'A320', standName: '1', flight: { kind: 'departure', readyAtMs: START + 600_000 } });
    say(w, 'TST1', 'pushback', { face: 'E' });
    runUntil(w, () => w.getAircraft('TST1')!.surface!.phase === 'holding');
    say(w, 'TST1', 'taxi', { holdingPoint: 'HE' });
    w.runFor(700_000);
    expect(requestsOf(w, 'TST1')).toEqual([]);
  });

  it('repeats an unanswered request, but not forever', () => {
    const w = makeWorld();
    add(w, { callsign: 'TST1', typeDesignator: 'A320', standName: '1', flight: { kind: 'departure', readyAtMs: START } });
    w.runFor(900_000);
    expect(transmissions(w, 'request')).toHaveLength(3);
    expect(w.requests.pendingFor('TST1', 'pushback')!.calls).toBe(3);
  });
});

describe('Pilot requests: arrival', () => {
  const arrive = (w: World, stand: string, type = 'A320') =>
    add(w, { callsign: 'TST2', typeDesignator: type, position: { nodeId: 'b1', headingTrueDeg: 180 }, flight: { kind: 'arrival', stand } });

  it('asks for its stand after vacating, and parks there when cleared', () => {
    const w = makeWorld();
    expect(arrive(w, '1').ok).toBe(true);
    expect(w.standUser('1')).toBe('TST2'); // reserved for the arrival
    runUntil(w, () => w.requests.pendingFor('TST2') !== undefined);
    expect(transmissions(w, 'request')[0]!.event.text).toBe('GROUND, TST2, VACATED, REQUEST TAXI TO STAND 1');

    expect(say(w, 'TST2', 'taxi', { stand: '1' }).ok).toBe(true);
    expect(requestsOf(w, 'TST2')).toEqual(['taxiToStand:granted']);
    runUntil(w, () => w.getAircraft('TST2')!.surface!.phase === 'parked');
    expect(w.getAircraft('TST2')!.surface!.standName).toBe('1');
  });

  it('can be given a different stand, if it fits and is free', () => {
    const w = makeWorld();
    arrive(w, '1');
    add(w, { callsign: 'TST3', typeDesignator: 'A320', standName: '2' });
    runUntil(w, () => w.requests.pendingFor('TST2') !== undefined);
    expect(say(w, 'TST2', 'taxi', { stand: '3' })).toEqual({ ok: false, reason: 'Stand 3 is blocked: overlapping stand 2 is in use by TST3' });
    expect(say(w, 'TST2', 'taxi', { stand: '2' })).toEqual({ ok: false, reason: 'Stand 2 is in use by TST3' });
    w.apply({ type: 'addAircraft', aircraft: { ...base, callsign: 'TST4', typeDesignator: 'B77W', position: { nodeId: 'a0', headingTrueDeg: 90 } } });
    expect(say(w, 'TST4', 'taxi', { stand: '1' })).toEqual({ ok: false, reason: 'Stand 1 is too small for a B77W (wingspan 64.8 m, stand limit 36 m)' });

    const w2 = makeWorld();
    arrive(w2, '1');
    runUntil(w2, () => w2.requests.pendingFor('TST2') !== undefined);
    expect(say(w2, 'TST2', 'taxi', { stand: '2' }).ok).toBe(true);
    const granted = w2.log.ofType('RequestStateChanged').find((e) => e.event.to === 'granted')!;
    expect(granted.event.reason).toBe('given stand 2 instead of 1');
    expect(w2.standUser('1')).toBeNull();
    expect(w2.standUser('2')).toBe('TST2');
  });
});

describe('Ground traffic generator', () => {
  const graph = new SurfaceGraph(surface());
  const generate = (seed: number) =>
    generateGroundTraffic(graph, TYPES, {
      seed,
      startTimeMs: START,
      positionId: 'GND',
      frequencyId: 'F-GND',
      sources: [
        { icao: 'BAW', telephony: 'SPEEDBIRD', weight: 1, types: ['A320', 'B77W'], standFilter: () => true, appearAtHoldingPoints: ['B1'] },
      ],
      departures: { count: 1, readyWindowMs: { min: 10_000, max: 60_000 } },
      arrivals: { count: 1, firstAtMs: 30_000, intervalMs: { min: 60_000, max: 60_000 } },
    });

  it('gives flights airline callsigns and radio callsigns', () => {
    for (const item of generate(9)) {
      const a = item.input.type === 'addAircraft' ? item.input.aircraft : null;
      expect(a?.callsign).toMatch(/^BAW\d{1,4}[A-Z]?$/);
      expect(a?.radioCallsign).toBe(`SPEEDBIRD ${a!.callsign.slice(3)}`);
    }
  });

  it('is deterministic and only uses stands that fit and do not overlap', () => {
    expect(generate(5)).toEqual(generate(5));
    for (let seed = 1; seed <= 20; seed++) {
      const w = makeWorld();
      for (const item of generate(seed)) expect(w.apply(item.input)).toMatchObject({ ok: true });
    }
  });

  it('points arrivals away from the runway', () => {
    expect(headingAwayFromRunway(graph, 'b1')).toBeCloseTo(180, 0);
  });

  it('replays a session with pilots and scheduled traffic exactly', () => {
    const w = makeWorld();
    const schedule = new InputSchedule(generate(3));
    for (let i = 0; i < 3000; i++) {
      schedule.applyDue(w);
      w.step();
    }
    expect(w.requests.all().length).toBeGreaterThan(0);
    const copy = replay(w.config, w.log.all(), w.now);
    expect(JSON.stringify(copy.log.all())).toBe(JSON.stringify(w.log.all()));
  });
});
