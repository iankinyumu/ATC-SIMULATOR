import { describe, expect, it } from 'vitest';
import { bearingDifferenceDeg, distanceM, LocalProjection, parseDms, trueBearingDeg } from '../src/geo/geo';
import { normaliseTaxiwayName, SurfaceGraph } from '../src/surface/graph';
import { loadSurfaceDataset, type SurfaceDataset, type SurfaceEdge } from '../src/surface/surface';

describe('geo', () => {
  it('parses AIP DMS coordinates', () => {
    expect(parseDms('512839.00N')).toBeCloseTo(51 + 28 / 60 + 39 / 3600, 9);
    expect(parseDms('0002905.97W')).toBeCloseTo(-(29 / 60 + 5.97 / 3600), 9);
    expect(() => parseDms('0512839.00N')).toThrow();
    expect(() => parseDms('nonsense')).toThrow();
  });

  it('computes distance and bearing', () => {
    const a = { lat: 51.5, lon: 0 };
    const b = { lat: 51.5, lon: 0.01 };
    expect(distanceM(a, b)).toBeCloseTo(692.5, 0);
    expect(trueBearingDeg(a, b)).toBeCloseTo(90, 1);
    expect(bearingDifferenceDeg(359, 1)).toBe(2);
  });

  it('round-trips the local projection', () => {
    const proj = new LocalProjection({ lat: 51.47, lon: -0.45 });
    const p = { lat: 51.48, lon: -0.43 };
    const back = proj.toLatLon(proj.toLocal(p));
    expect(back.lat).toBeCloseTo(p.lat, 9);
    expect(back.lon).toBeCloseTo(p.lon, 9);
  });
});

/**
 * Synthetic layout (not a real airport):
 *
 *            RWY 09/27 (east-west): R1 ── R2 ── R3
 *                                         │ X (taxiway X crosses the runway at R2)
 *   stand S ─ s1 ── A ── a2 ── B ── b2 ── x1   (x1 is south of the runway, X continues north to x2)
 *                     └──── C (long way) ────┘
 */
function syntheticSurface(): SurfaceDataset {
  const node = (id: string, lat: number, lon: number) => ({ id, lat, lon });
  const edge = (id: string, from: string, to: string, kind: SurfaceEdge['kind'], name: string | null, lengthM: number): SurfaceEdge => ({
    id,
    from,
    to,
    kind,
    name,
    lengthM,
    sourceId: 'test',
  });
  return loadSurfaceDataset({
    meta: { airport: 'ZZZZ', datasetVersion: 'test', airac: null, referencePoint: { lat: 0, lon: 0 } },
    sources: [{ id: 'test', name: 'Synthetic', version: '1', licence: 'n/a', provenance: { status: 'placeholder', tier: 6 } }],
    runways: [],
    publishedTaxiways: [],
    nodes: [
      node('st', 0, 0),
      node('s1', 0, 0.001),
      node('a2', 0, 0.002),
      node('b2', 0, 0.003),
      node('x1', 0, 0.004),
      node('R1', 0.001, 0.003),
      node('R2', 0.001, 0.004),
      node('R3', 0.001, 0.005),
      node('x2', 0.002, 0.004),
    ],
    edges: [
      edge('e0', 'st', 's1', 'standLead', '101', 50),
      edge('e1', 's1', 'a2', 'taxiway', 'Taxiway A', 100),
      edge('e2', 'a2', 'b2', 'taxiway', 'B', 100),
      edge('e3', 'b2', 'x1', 'taxiway', 'B', 100),
      edge('e4', 's1', 'x1', 'taxiway', 'C', 1000),
      edge('e5', 'x1', 'R2', 'taxiway', 'X', 100),
      edge('e6', 'R2', 'x2', 'taxiway', 'X', 100),
      edge('r1', 'R1', 'R2', 'runway', '09/27', 100),
      edge('r2', 'R2', 'R3', 'runway', '09/27', 100),
    ],
    holdingPoints: [
      { id: 'hp1', name: 'X1', nodeId: 'x1', type: 'runway', sourceId: 'test' },
      { id: 'hp2', name: 'X2', nodeId: 'x2', type: 'runway', sourceId: 'test' },
    ],
    stands: [{ id: 'stand:101', name: '101', position: { lat: 0, lon: 0 }, headingTrueDeg: 270, entryNodeId: 's1', sourceId: 'test' }],
  });
}

describe('SurfaceDatasetSchema', () => {
  it('rejects edges that refer to unknown nodes', () => {
    const raw = structuredClone(syntheticSurface()) as SurfaceDataset;
    (raw.edges[0] as { to: string }).to = 'missing';
    expect(() => loadSurfaceDataset(raw)).toThrow(/unknown node/);
  });
});

describe('SurfaceGraph', () => {
  const g = new SurfaceGraph(syntheticSurface());
  const names = (edgeIds: readonly string[]) => edgeIds.join(',');

  it('normalises taxiway names', () => {
    expect(normaliseTaxiwayName(' Taxiway a ')).toBe('A');
    expect(normaliseTaxiwayName('Link  22')).toBe('LINK 22');
  });

  it('looks up stands and holding points by name', () => {
    expect(g.stand('101')?.entryNodeId).toBe('s1');
    expect(g.holdingPoints('x1')).toHaveLength(1);
  });

  it('finds the shortest free route', () => {
    const r = g.findRoute({ fromNodeId: 'st', toNodeId: 'x1' })!;
    expect(names(r.edgeIds)).toBe('e0,e1,e2,e3');
    expect(r.lengthM).toBe(350);
  });

  it('follows the cleared taxiway sequence even when it is longer', () => {
    const r = g.findRoute({ fromNodeId: 's1', toNodeId: 'x1', via: ['C'] })!;
    expect(names(r.edgeIds)).toBe('e4');
  });

  it('requires every via taxiway in order', () => {
    expect(g.findRoute({ fromNodeId: 's1', toNodeId: 'x1', via: ['A', 'B'] })).not.toBeNull();
    expect(g.findRoute({ fromNodeId: 's1', toNodeId: 'x1', via: ['B'] })).toBeNull(); // A not cleared
    expect(g.findRoute({ fromNodeId: 's1', toNodeId: 'x1', via: ['B'], startConnectors: ['A'] })).not.toBeNull();
    expect(g.findRoute({ fromNodeId: 's1', toNodeId: 'x1', via: ['B', 'A'] })).toBeNull(); // wrong order
  });

  it('allows unnamed connectors only at the start and end of a cleared route', () => {
    expect(g.findRoute({ fromNodeId: 'st', toNodeId: 'x1', via: ['A', 'B'] })).not.toBeNull(); // stand lead-in first
  });

  it('never crosses a runway without clearance for it', () => {
    expect(g.runwaysAt('R2')).toEqual(['09/27']);
    expect(g.findRoute({ fromNodeId: 'x1', toNodeId: 'x2' })).toBeNull();
    expect(g.findRoute({ fromNodeId: 'x1', toNodeId: 'x2', allowedRunways: ['09/27'] })).not.toBeNull();
  });
});
