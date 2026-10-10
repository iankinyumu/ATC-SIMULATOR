import { describe, expect, it } from 'vitest';
import { Path, type PathPoint } from '../src/movement/path';
import { DEFAULT_GROUND_PERFORMANCE } from '../src/movement/performance';
import { advanceSurface, type SurfaceState } from '../src/movement/surfaceMovement';
import { SurfaceGraph } from '../src/surface/graph';
import { loadSurfaceDataset, type SurfaceDataset, type SurfaceEdge } from '../src/surface/surface';
import { replay } from '../src/world/replay';
import { World } from '../src/world/world';
import { START, testDataset } from './helpers';

const perf = DEFAULT_GROUND_PERFORMANCE.value;
const M_PER_DEG = 111_195; // metres per degree of latitude (and of longitude at the equator)

/**
 * Synthetic layout near 0°N 0°E, coordinates in metres (x east, y north). Not a real airport.
 *
 *                       b2 (1000,400)  hold "B2"
 *                        |
 *   r0 ──────────────── rX ──────────────── r1     runway "09/27" at y = 300
 *                        |
 *                       b1 (1000,200)  hold "B1" (runway holding point)
 *                        |
 *   a0 ── a1 ── w ── a2 ── a3 ── a4               taxiway A at y = 0; holds "HW" at a0, "HE" at a4
 *               (455)  |
 *                     s1 (500,-120)  stand "1", lead-in s1 → a2
 */
function surface(): SurfaceDataset {
  const node = (id: string, x: number, y: number) => ({ id, lat: y / M_PER_DEG, lon: x / M_PER_DEG });
  const nodes = [
    node('a0', 0, 0), node('a1', 250, 0), node('w', 455, 0), node('a2', 500, 0), node('a3', 750, 0), node('a4', 1000, 0),
    node('s1', 500, -120), node('b1', 1000, 200), node('rX', 1000, 300), node('b2', 1000, 400),
    node('r0', 800, 300), node('r1', 1200, 300),
  ];
  const xy = new Map(nodes.map((n) => [n.id, { x: n.lon * M_PER_DEG, y: n.lat * M_PER_DEG }]));
  const edge = (from: string, to: string, kind: SurfaceEdge['kind'], name: string | null): SurfaceEdge => {
    const a = xy.get(from)!;
    const b = xy.get(to)!;
    return { id: `${from}-${to}`, from, to, kind, name, lengthM: Math.hypot(b.x - a.x, b.y - a.y), sourceId: 'test' };
  };
  return loadSurfaceDataset({
    meta: { airport: 'ZZZZ', datasetVersion: 'test', airac: null, referencePoint: { lat: 0, lon: 0 } },
    sources: [{ id: 'test', name: 'Synthetic', version: '1', licence: 'n/a', provenance: { status: 'placeholder', tier: 6 } }],
    runways: [],
    publishedTaxiways: [],
    nodes,
    edges: [
      edge('a0', 'a1', 'taxiway', 'A'), edge('a1', 'w', 'taxiway', 'A'), edge('w', 'a2', 'taxiway', 'A'),
      edge('a2', 'a3', 'taxiway', 'A'), edge('a3', 'a4', 'taxiway', 'A'),
      edge('s1', 'a2', 'standLead', '1'),
      edge('a4', 'b1', 'taxiway', 'B'), edge('b1', 'rX', 'taxiway', 'B'), edge('rX', 'b2', 'taxiway', 'B'),
      edge('r0', 'rX', 'runway', '09/27'), edge('rX', 'r1', 'runway', '09/27'),
    ],
    holdingPoints: [
      { id: 'h1', name: 'HW', nodeId: 'a0', type: 'intermediate', sourceId: 'test' },
      { id: 'h2', name: 'HE', nodeId: 'a4', type: 'intermediate', sourceId: 'test' },
      { id: 'h3', name: 'B1', nodeId: 'b1', type: 'runway', sourceId: 'test' },
      { id: 'h4', name: 'B2', nodeId: 'b2', type: 'runway', sourceId: 'test' },
    ],
    stands: [{ id: 'stand:1', name: '1', position: { lat: -120 / M_PER_DEG, lon: 500 / M_PER_DEG }, headingTrueDeg: 180, entryNodeId: 'a2', stopNodeId: 's1', sourceId: 'test' }],
  });
}

// ---------------------------------------------------------------------------------------------
// Path and kinematics
// ---------------------------------------------------------------------------------------------

const pts = (...xy: Array<[number, number]>): PathPoint[] => xy.map(([x, y]) => ({ x, y, nodeId: null }));

function moving(path: Path): SurfaceState {
  const start = path.points[0]!;
  return {
    phase: 'taxi', x: start.x, y: start.y, headingTrueDeg: 0, speedMps: 0, standName: null, nodeId: null,
    motion: { kind: 'taxi', path, s: 0, clearanceId: 'C', holdClearanceId: null, limit: 'test', toStand: null },
  };
}

/** Runs until the aircraft arrives (or the time limit); returns elapsed seconds and the speed trace. */
function drive(state: SurfaceState, maxSeconds = 600, onStep?: (t: number) => void) {
  const dt = 0.1;
  const trace: Array<{ s: number; v: number }> = [];
  for (let t = 0; t < maxSeconds; t += dt) {
    const arrived = advanceSurface(state, perf, dt);
    trace.push({ s: state.motion?.s ?? 0, v: state.speedMps });
    onStep?.(t);
    if (arrived) return { seconds: t + dt, trace };
  }
  return { seconds: Infinity, trace };
}

describe('Path', () => {
  it('measures and interpolates', () => {
    const p = new Path(pts([0, 0], [100, 0], [100, 50]));
    expect(p.length).toBe(150);
    expect(p.positionAt(120)).toEqual({ x: 100, y: 20 });
    expect(p.segmentBearingAt(10)).toBeCloseTo(90);
    expect(p.turnAngleAt(1)).toBeCloseTo(90);
    expect(p.turnRadiusAt(1)).toBeCloseTo(25); // shorter segment 50 m: 25 / tan(45°)
  });
});

describe('Ground kinematics', () => {
  it('accelerates to the taxi limit, never exceeds it, and stops exactly at the end', () => {
    const state = moving(new Path(pts([0, 0], [1000, 0])));
    const { seconds, trace } = drive(state);
    expect(Math.max(...trace.map((p) => p.v))).toBeCloseTo(perf.maxTaxiSpeedMps, 5);
    expect(trace.every((p) => p.v <= perf.maxTaxiSpeedMps + 1e-9)).toBe(true);
    expect(state.speedMps).toBe(0);
    expect(state.x).toBeCloseTo(1000, 1);
    expect(seconds).toBeGreaterThan(1000 / perf.maxTaxiSpeedMps);
    expect(seconds).toBeLessThan(1000 / perf.maxTaxiSpeedMps + 30);
  });

  it('slows down for a sharp turn', () => {
    const path = new Path(pts([0, 0], [500, 0], [500, 40], [500, 500]));
    const cornerLimit = Math.max(perf.minCornerSpeedMps, Math.sqrt(perf.lateralAccelMps2 * path.turnRadiusAt(1)));
    const { trace } = drive(moving(path));
    const arrivingAtCorner = trace.filter((p) => p.s <= 500).pop()!;
    expect(cornerLimit).toBeLessThan(perf.maxTaxiSpeedMps);
    // Speed is updated in 0.1 s steps, so allow one step of braking.
    expect(arrivingAtCorner.v).toBeLessThanOrEqual(cornerLimit + perf.taxiDecelMps2 * 0.1 + 1e-6);
    expect(Math.max(...trace.map((p) => p.v))).toBeGreaterThan(cornerLimit + 2); // fast on the straight
  });

  it('heads along the path and turns progressively through corners', () => {
    const state = moving(new Path(pts([0, 0], [300, 0], [300, 300])));
    const headings: number[] = [];
    drive(state, 600, () => headings.push(state.headingTrueDeg));
    expect(headings[10]).toBeCloseTo(90, 0);
    expect(headings.some((h) => h > 20 && h < 70)).toBe(true); // part-way round the turn from east to north
    expect(state.headingTrueDeg).toBeCloseTo(0, 0); // ends heading north
  });

  it('stops when told to hold position and resumes afterwards', () => {
    const state = moving(new Path(pts([0, 0], [2000, 0])));
    for (let i = 0; i < 300; i++) advanceSurface(state, perf, 0.1);
    state.motion!.holdClearanceId = 'HOLD';
    for (let i = 0; i < 300; i++) advanceSurface(state, perf, 0.1);
    expect(state.speedMps).toBe(0);
    const stoppedAt = state.motion!.s;
    state.motion!.holdClearanceId = null;
    for (let i = 0; i < 100; i++) advanceSurface(state, perf, 0.1);
    expect(state.motion!.s).toBeGreaterThan(stoppedAt);
  });
});

describe('Heading-aware routing', () => {
  const g = new SurfaceGraph(surface());

  it('will not U-turn when a turn limit is given', () => {
    expect(g.findRoute({ fromNodeId: 'w', toNodeId: 'a0' })).not.toBeNull();
    expect(g.findRoute({ fromNodeId: 'w', toNodeId: 'a0', initialHeadingDeg: 90, maxTurnDeg: 120 })).toBeNull();
    expect(g.findRoute({ fromNodeId: 'w', toNodeId: 'a4', initialHeadingDeg: 90, maxTurnDeg: 120 })).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// World: pushback, taxi, hold position
// ---------------------------------------------------------------------------------------------

function makeWorld(seed = 7) {
  const w = new World({ dataset: testDataset(), surface: surface(), seed, scenarioVersion: 'test-1', startTimeMs: START, playerPositionIds: ['GND'] });
  const r = w.apply({ type: 'addAircraft', aircraft: { callsign: 'TST1', typeDesignator: null, tunedFrequencyId: 'F-GND', controllingPositionId: 'GND', standName: '1' } });
  expect(r.ok).toBe(true);
  return w;
}

const instruct = (w: World, kind: Parameters<World['apply']>[0] extends infer I ? (I extends { commands: readonly (infer C)[] } ? C extends { kind: infer K } ? K : never : never) : never, params: Record<string, string> = {}) =>
  w.apply({ type: 'issueInstruction', positionId: 'GND', callsign: 'TST1', commands: [{ kind, params }], text: kind, durationMs: 2000 });

const surfaceOf = (w: World) => w.getAircraft('TST1')!.surface!;

function runUntil(w: World, done: () => boolean, maxMs = 600_000): void {
  for (let t = 0; t < maxMs && !done(); t += w.clock.stepMs) w.step();
  if (!done()) throw new Error('condition not reached');
}

function pushBackEast(w: World): void {
  expect(instruct(w, 'pushback', { face: 'E' }).ok).toBe(true);
  runUntil(w, () => surfaceOf(w).phase === 'holding');
}

describe('Ground movement in the world', () => {
  it('parks the aircraft on its stand, nose-in', () => {
    const s = surfaceOf(makeWorld());
    expect(s).toMatchObject({ phase: 'parked', standName: '1', nodeId: 's1', headingTrueDeg: 180, speedMps: 0 });
    expect(s.x).toBeCloseTo(500, 1);
    expect(s.y).toBeCloseTo(-120, 1);
  });

  it('requires pushback before taxi from a nose-in stand', () => {
    const r = instruct(makeWorld(), 'taxi', { holdingPoint: 'HE' });
    expect(r).toEqual({ ok: false, reason: 'TST1 is parked nose-in; push back first' });
  });

  it('pushes back tail-first onto the taxiway and ends facing the instructed direction', () => {
    const w = makeWorld();
    expect(instruct(w, 'pushback', { face: 'N' }).ok).toBe(false);
    expect(instruct(w, 'pushback').ok).toBe(false); // two possible directions: face required
    pushBackEast(w);
    const s = surfaceOf(w);
    expect(s.nodeId).toBe('w');
    expect(s.headingTrueDeg).toBeCloseTo(90, 0);
    expect(s.speedMps).toBe(0);
    const phases = w.log.ofType('SurfacePhaseChanged').map((e) => e.event.to);
    expect(phases).toEqual(['parked', 'pushback', 'holding']);
    expect(w.clearances.forAircraft('TST1').map((c) => c.state)).toEqual(['completed']);
  });

  it('moves only after the readback', () => {
    const w = makeWorld();
    instruct(w, 'pushback', { face: 'E' });
    const readbackEnd = () => w.log.ofType('TransmissionEnded')[1]?.t;
    runUntil(w, () => readbackEnd() !== undefined);
    const started = w.log.ofType('SurfacePhaseChanged').find((e) => e.event.to === 'pushback')!;
    expect(started.t).toBe(readbackEnd());
  });

  it('taxis to the holding point and stops there', () => {
    const w = makeWorld();
    pushBackEast(w);
    expect(instruct(w, 'taxi', { holdingPoint: 'HE' }).ok).toBe(true);
    runUntil(w, () => surfaceOf(w).phase === 'taxi');
    runUntil(w, () => surfaceOf(w).phase === 'holding');
    const s = surfaceOf(w);
    expect(s.nodeId).toBe('a4');
    expect(s.x).toBeCloseTo(1000, 1);
    const taxi = w.clearances.forAircraft('TST1').find((c) => c.command.kind === 'taxi')!;
    expect(taxi.state).toBe('completed');
  });

  it('refuses a route that needs a U-turn or an uncleared runway crossing', () => {
    const w = makeWorld();
    pushBackEast(w);
    expect(instruct(w, 'taxi', { holdingPoint: 'HW' }).ok).toBe(false); // behind the aircraft
    expect(instruct(w, 'taxi', { holdingPoint: 'B2' })).toEqual({ ok: false, reason: 'No taxi route to B2 without crossing a runway' });
    expect(instruct(w, 'taxi', { holdingPoint: 'B2', crossRunways: '09/27' }).ok).toBe(true);
  });

  it('follows the cleared taxiways only', () => {
    const w = makeWorld();
    pushBackEast(w);
    expect(instruct(w, 'taxi', { holdingPoint: 'B1', via: 'B' }).ok).toBe(true); // already on A
    expect(instruct(w, 'taxi', { holdingPoint: 'B1', via: 'C' }).ok).toBe(false);
  });

  it('holds position on request and continues when told', () => {
    const w = makeWorld();
    pushBackEast(w);
    instruct(w, 'taxi', { holdingPoint: 'HE' });
    runUntil(w, () => surfaceOf(w).speedMps > 5);
    expect(instruct(w, 'holdPosition').ok).toBe(true);
    runUntil(w, () => surfaceOf(w).phase === 'holding');
    const heldAt = surfaceOf(w).x;
    expect(heldAt).toBeLessThan(1000);
    w.runFor(20_000);
    expect(surfaceOf(w).x).toBe(heldAt);

    expect(instruct(w, 'continueTaxi').ok).toBe(true);
    runUntil(w, () => surfaceOf(w).phase === 'taxi');
    runUntil(w, () => surfaceOf(w).phase === 'holding');
    expect(surfaceOf(w).nodeId).toBe('a4');
    const kinds = w.clearances.forAircraft('TST1').map((c) => `${c.command.kind}:${c.state}`);
    expect(kinds).toEqual(['pushback:completed', 'taxi:completed', 'holdPosition:completed', 'continueTaxi:completed']);
  });

  it('tells interfaces which commands are possible now, without side effects', () => {
    const w = makeWorld();
    const logLength = w.log.all().length;
    expect(w.pushbackFaces('GND', 'TST1')).toEqual(['E', 'W']);
    expect(w.commandProblem('GND', 'TST1', { kind: 'taxi', params: { holdingPoint: 'HE' } })).toBe('TST1 is parked nose-in; push back first');
    expect(w.commandProblem('TWR', 'TST1', { kind: 'holdPosition', params: {} })).toBe('TST1 is not under the control of TWR');
    const preview = w.previewSurfaceCommand('GND', 'TST1', { kind: 'pushback', params: { face: 'E' } });
    expect(preview.ok && preview.path.length).toBeCloseTo(165, 0); // 120 m lead-in + 45 m along A
    expect(w.log.all()).toHaveLength(logLength);
    expect(w.clearances.all()).toHaveLength(0);
  });

  it('replays a session with movement exactly', () => {
    const w = makeWorld();
    pushBackEast(w);
    instruct(w, 'taxi', { holdingPoint: 'HE' });
    w.runFor(30_000);
    const copy = replay(w.config, w.log.all(), w.now);
    expect(JSON.stringify(copy.log.all())).toBe(JSON.stringify(w.log.all()));
    expect(copy.getAircraft('TST1')!.surface).toEqual(w.getAircraft('TST1')!.surface);
  });
});
