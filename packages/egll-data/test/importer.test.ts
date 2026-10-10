import { existsSync, readFileSync } from 'node:fs';
import { loadSurfaceDataset, SurfaceGraph, type SurfaceEdge } from '@atc/sim-core';
import { describe, expect, it } from 'vitest';
import { parseDeclaredDistances, parseFields, parseRunwayEnds, parseTaxiways } from '../src/aip';
import { connectRunwayCrossings } from '../src/crossings';
import { buildOsmNetwork, type OverpassResponse } from '../src/osm';
import { DEFAULT_AIRAC_DATE, paths } from '../scripts/paths';

// -------------------------------------------------------------------------------------------------
// Synthetic eAIP HTML in the same markup style as the UK eAIP (values are made up).
// -------------------------------------------------------------------------------------------------

const sd = (value: string, params: string) =>
  `<span class="SD" id="x">${value}</span><span class="sdParams" style="display: none;">${params}</span>`;
const td = (...content: string[]) => `<td><p>${content.join(' ')}</p></td>`;
const tr = (...cells: string[]) => `<tr>${cells.join('')}</tr>`;

function runwayRow(desig: string, dirRec: string, lat: string, lon: string, brg: string, pointRec: string) {
  return tr(
    td(sd(desig, `TRWY_DIRECTION;TXT_DESIG;${dirRec}`)),
    td(sd(brg, `TRWY_DIRECTION;VAL_TRUE_BRG;${dirRec}`)),
    td(sd('3000', 'TRWY;VAL_LEN;7') + ' x ' + sd('45', 'TRWY;VAL_WID;7') + sd('M', 'TRWY;UOM_DIM_RWY;7')),
    td(sd(lat, `TRWY_CLINE_POINT;GEO_LAT;${pointRec}`) + sd(lon, `TRWY_CLINE_POINT;GEO_LONG;${pointRec}`)),
    td('THR ' + sd('80.0', `TRWY_CLINE_POINT;VAL_ELEV;${pointRec}`) + sd('FT', `TRWY_CLINE_POINT;UOM_DIST_VER;${pointRec}`)),
  );
}

const dist = (v: string, rec: string) => td(sd(v, `TRWY_DIRECTION_DECL_DIST;VAL_DIST;${rec}`) + sd('M', `TRWY_DIRECTION_DECL_DIST;UOM_DIST;${rec}`));

const AIP_HTML = [
  '<div id="ZZZZ-AD-2.8">',
  sd('A', 'TTWY;TXT_DESIG;1') + sd('23', 'TTWY;VAL_WID;1') + sd('M', 'TTWY;UOM_WID;1'),
  sd('LINK 1', 'TTWY;TXT_DESIG;2') + sd('25', 'TTWY;VAL_WID;2') + sd('M', 'TTWY;UOM_WID;2'),
  '</div>',
  '<div id="ZZZZ-AD-2.12"><table><tbody>',
  runwayRow('09', '10', '510000.00N', '0010000.00W', '090.00°', '20'),
  runwayRow('27', '11', '510000.00N', '0005000.00W', '270.00°', '21'),
  '</tbody></table></div>',
  '<div id="ZZZZ-AD-2.13"><table><thead><tr><td>Runway designator</td><td>TORA</td><td>TODA</td><td>ASDA</td><td>LDA</td><td>Remarks</td></tr></thead><tbody>',
  tr(td(sd('09', 'TRWY_DIRECTION;TXT_DESIG;10')), dist('3000', '1'), dist('3100', '2'), dist('3000', '3'), dist('2700', '4'), td(sd('LDA: threshold displaced by 300 M.', 'TRWY_DIRECTION_DECL_DIST;ANNOTATION:9.eng;4'))),
  tr(td(sd('27', 'TRWY_DIRECTION;TXT_DESIG;11')), dist('3000', '5'), dist('3000', '6'), dist('3000', '7'), dist('3000', '8'), td('-')),
  tr(td(sd('09', 'TRWY_DIRECTION;TXT_DESIG;10')), dist('2500', '9'), dist('2600', '10'), dist('2500', '11'), td('<span>-</span>'), td(sd('Take-off from intersection with A2', 'TRWY_DIRECTION_DECL_DIST;ANNOTATION:9.eng;9'))),
  '</tbody></table></div>',
].join('\n');

describe('eAIP parser', () => {
  it('reads tagged fields', () => {
    expect(parseFields(sd('09L', 'TRWY_DIRECTION;TXT_DESIG;342'))).toEqual([{ table: 'TRWY_DIRECTION', field: 'TXT_DESIG', record: '342', value: '09L' }]);
    expect(parseFields(sd('note', 'TRWY;ANNOTATION:17.eng;5'))[0]!.field).toBe('ANNOTATION');
  });

  it('parses runway ends from AD 2.12', () => {
    const ends = parseRunwayEnds(AIP_HTML, 'ZZZZ');
    expect(ends.map((e) => e.designator)).toEqual(['09', '27']);
    expect(ends[0]).toMatchObject({ runwayRecord: '7', trueBearingDeg: 90, lengthM: 3000, widthM: 45, thresholdElevationFt: 80 });
    expect(ends[0]!.threshold.lat).toBeCloseTo(51, 9);
    expect(ends[0]!.threshold.lon).toBeCloseTo(-1, 9);
  });

  it('parses declared distances by column, including intersection take-offs', () => {
    const d = parseDeclaredDistances(AIP_HTML, 'ZZZZ');
    expect(d[0]).toEqual({
      designator: '09',
      declared: { toraM: 3000, todaM: 3100, asdaM: 3000, ldaM: 2700 },
      intersectionTaxiway: null,
      remarks: ['LDA: threshold displaced by 300 M.'],
    });
    expect(d[2]).toMatchObject({ designator: '09', intersectionTaxiway: 'A2', declared: { toraM: 2500, ldaM: null } });
  });

  it('parses the AD 2.8 taxiway list', () => {
    expect(parseTaxiways(AIP_HTML, 'ZZZZ')).toEqual([
      { designator: 'A', widthM: 23 },
      { designator: 'LINK 1', widthM: 25 },
    ]);
  });
});

// -------------------------------------------------------------------------------------------------
// OSM import
// -------------------------------------------------------------------------------------------------

describe('OSM import', () => {
  const osm: OverpassResponse = {
    osm3s: { timestamp_osm_base: '2026-01-01T00:00:00Z' },
    elements: [
      { type: 'node', id: 1, lat: 0, lon: 0 },
      { type: 'node', id: 2, lat: 0, lon: 0.001, tags: { aeroway: 'holding_position', ref: 'A1', 'holding_position:type': 'runway' } },
      { type: 'node', id: 3, lat: 0, lon: 0.002 },
      { type: 'node', id: 4, lat: -0.0005, lon: 0.0005 },
      { type: 'node', id: 10, lat: 0.001, lon: 0 },
      { type: 'node', id: 11, lat: 0.001, lon: 0.003 },
      { type: 'node', id: 12, lat: 0.001, lon: 0.004 },
      // Overpass "skel" repeat without tags must not erase the tagged node
      { type: 'node', id: 2, lat: 0, lon: 0.001 },
      { type: 'way', id: 100, nodes: [1, 2, 3], tags: { aeroway: 'taxiway', ref: 'A' } },
      { type: 'way', id: 101, nodes: [4, 1], tags: { aeroway: 'parking_position', ref: '7' } },
      { type: 'way', id: 102, nodes: [10, 11], tags: { aeroway: 'runway', ref: '09/27' } },
      { type: 'way', id: 103, nodes: [11, 12], tags: { aeroway: 'runway' } }, // displaced-threshold section
      { type: 'way', id: 104, nodes: [1, 3], tags: { aeroway: 'taxiway', 'disused:aeroway': 'taxiway' } },
    ],
  };
  const net = buildOsmNetwork(osm, 'osm');

  it('keeps tagged holding points', () => {
    expect(net.holdingPoints).toEqual([
      { id: 'hp:2', name: 'A1', nodeId: 'osm:n2', type: 'runway', sourceId: 'osm', sourceRef: 'node/2' },
    ]);
  });

  it('joins displaced-threshold sections to their runway', () => {
    expect(net.runways).toHaveLength(1);
    expect(net.runways[0]!.wayIds).toEqual([102, 103]);
    expect(net.edges.filter((e) => e.kind === 'runway').every((e) => e.name === '09/27')).toBe(true);
  });

  it('derives stand position and nose-in heading from the lead-in line', () => {
    const stand = net.stands[0]!;
    expect(stand).toMatchObject({ id: 'stand:7', entryNodeId: 'osm:n1' });
    expect(stand.position).toEqual({ lat: -0.0005, lon: 0.0005 });
    expect(stand.headingTrueDeg).toBeCloseTo(135, 0);
  });

  it('skips disused ways', () => {
    expect(net.edges.some((e) => e.sourceRef === 'way/104')).toBe(false);
  });
});

describe('Runway crossings', () => {
  const nodes = [
    { id: 'w', lat: 0, lon: -0.001 },
    { id: 'e', lat: 0, lon: 0.001 },
    { id: 's', lat: -0.001, lon: 0 },
    { id: 'n', lat: 0.001, lon: 0 },
  ];
  const edge = (id: string, from: string, to: string, kind: SurfaceEdge['kind']): SurfaceEdge => ({
    id, from, to, kind, name: kind === 'runway' ? '09/27' : 'X', lengthM: 222, sourceId: 'osm',
  });

  it('inserts a shared node where a taxiway crosses a runway unconnected', () => {
    const result = connectRunwayCrossings(nodes, [edge('rwy', 'w', 'e', 'runway'), edge('twy', 's', 'n', 'taxiway')]);
    expect(result.inserted).toBe(1);
    expect(result.edges).toHaveLength(4);
    const crossing = result.nodes.find((n) => n.id.startsWith('x:'))!;
    expect(crossing.lat).toBeCloseTo(0, 9);
    expect(crossing.lon).toBeCloseTo(0, 9);
    const total = result.edges.filter((e) => e.kind === 'runway').reduce((s, e) => s + e.lengthM, 0);
    expect(total).toBeCloseTo(222.4, 0);
  });

  it('leaves non-crossing edges alone', () => {
    const result = connectRunwayCrossings(nodes, [edge('rwy', 'w', 'e', 'runway'), edge('twy', 's', 'w', 'taxiway')]);
    expect(result.inserted).toBe(0);
    expect(result.edges).toHaveLength(2);
  });
});

// -------------------------------------------------------------------------------------------------
// Real EGLL data (runs only after `npm run data:fetch && npm run data:build`)
// -------------------------------------------------------------------------------------------------

const generated = `${paths.generatedDir}/surface-${DEFAULT_AIRAC_DATE}.json`;

describe.skipIf(!existsSync(generated))('EGLL generated surface', () => {
  const ds = loadSurfaceDataset(JSON.parse(readFileSync(generated, 'utf8')));
  const g = new SurfaceGraph(ds);
  const from = () => g.stand('501')!.entryNodeId!;

  it('contains both runways with AIP declared distances', () => {
    expect(ds.runways.map((r) => r.designator)).toEqual(['09L/27R', '09R/27L']);
    const r09L = ds.runways[0]!.ends.find((e) => e.designator === '09L')!;
    expect(r09L.declared.toraM).toBe(3901);
    expect(r09L.intersectionDepartures.map((d) => d.taxiway)).toContain('A12');
  });

  it('routes from a stand to a holding point along the cleared taxiways', () => {
    const r = g.findRoute({ fromNodeId: from(), toNodeId: g.holdingPoints('A10E')[0]!.nodeId, via: ['LINK 56', 'LINK 58', 'A'], endConnectors: ['A10E'] });
    expect(r).not.toBeNull();
  });

  it('will not cross 09R/27L without a crossing clearance', () => {
    const to = g.holdingPoints('S4W')[0]!.nodeId;
    expect(g.findRoute({ fromNodeId: from(), toNodeId: to })).toBeNull();
    expect(g.findRoute({ fromNodeId: from(), toNodeId: to, allowedRunways: ['09R/27L'] })).not.toBeNull();
  });
});
