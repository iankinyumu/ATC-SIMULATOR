import {
  bearingDifferenceDeg,
  distanceM,
  LocalProjection,
  normaliseTaxiwayName,
  SurfaceGraph,
  trueBearingDeg,
  type LatLon,
  type Runway,
  type RunwayEnd,
  type SurfaceDataset,
  type SurfaceSource,
} from '@atc/sim-core';
import { parseDeclaredDistances, parseReferencePoint, parseRunwayEnds, parseTaxiways } from './aip';
import { buildOsmNetwork, type OverpassResponse } from './osm';
import { estimateStands } from './standSizes';

export interface BuildInput {
  readonly icao: string;
  readonly aipHtml: string;
  /** AIRAC effective date of the AIP page, YYYY-MM-DD. */
  readonly airacDate: string;
  readonly osm: OverpassResponse;
}

export interface CheckResult {
  readonly status: 'ok' | 'warning' | 'error';
  readonly message: string;
}

export interface BuildOutput {
  readonly dataset: SurfaceDataset;
  readonly checks: CheckResult[];
  readonly osmWarnings: string[];
}

/** Distance from a point to the nearest of a set of segments, in metres (local projection). */
function distanceToSegmentsM(p: LatLon, segments: ReadonlyArray<readonly [LatLon, LatLon]>): number {
  const proj = new LocalProjection(p);
  let best = Infinity;
  for (const [from, to] of segments) {
    const a = proj.toLocal(from);
    const b = proj.toLocal(to);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / len2));
    best = Math.min(best, Math.hypot(a.x + t * dx, a.y + t * dy));
  }
  return best;
}

/** Thresholds for cross-checks between the AIP and OSM geometry. Engineering tolerances, not aviation values. */
const TOLERANCE = {
  thresholdOffCentrelineM: 15,
  runwayLengthDiffM: 30,
};

export function buildSurface(input: BuildInput): BuildOutput {
  const { icao, aipHtml, airacDate, osm } = input;
  const checks: CheckResult[] = [];
  const ok = (message: string) => checks.push({ status: 'ok', message });
  const warn = (message: string) => checks.push({ status: 'warning', message });
  const fail = (message: string) => checks.push({ status: 'error', message });

  const osmVersion = osm.osm3s?.timestamp_osm_base ?? 'unknown';
  const sources: SurfaceSource[] = [
    {
      id: 'uk-aip',
      name: `UK AIP ${icao} AD 2 (NATS AIS)`,
      version: `AIRAC effective ${airacDate}`,
      licence: 'UK AIP published by NATS AIS. Used for a personal, non-distributed project (spec §48); terms not separately verified.',
      provenance: {
        status: 'sourced',
        tier: 1,
        citation: `UK AIP ${icao} AD 2.8, 2.12, 2.13 — AIRAC effective ${airacDate}`,
      },
    },
    {
      id: 'osm',
      name: 'OpenStreetMap',
      version: `snapshot ${osmVersion}`,
      licence: 'ODbL 1.0 — © OpenStreetMap contributors',
      provenance: {
        status: 'derived',
        tier: 5,
        note: 'Community-mapped geometry. Must be checked against the AIP AD 2.24 aerodrome and ground movement charts.',
      },
    },
  ];

  // ---------------------------------------------------------------- AIP
  const aipEnds = parseRunwayEnds(aipHtml, icao);
  const declared = parseDeclaredDistances(aipHtml, icao);
  const publishedTaxiways = parseTaxiways(aipHtml, icao).map((t) => ({ ...t, sourceId: 'uk-aip' }));

  const runways: Runway[] = [];
  const byRecord = new Map<string, typeof aipEnds>();
  for (const e of aipEnds) byRecord.set(e.runwayRecord, [...(byRecord.get(e.runwayRecord) ?? []), e]);
  for (const pair of byRecord.values()) {
    if (pair.length !== 2) {
      fail(`AIP runway record has ${pair.length} ends: ${pair.map((e) => e.designator).join(', ')}`);
      continue;
    }
    const sorted = [...pair].sort((a, b) => a.designator.localeCompare(b.designator));
    const ends = sorted.map((e): RunwayEnd => {
      const full = declared.filter((d) => d.designator === e.designator && d.intersectionTaxiway === null);
      if (full.length !== 1) throw new Error(`AD 2.13: expected one full-length entry for ${e.designator}, found ${full.length}`);
      return {
        designator: e.designator,
        threshold: e.threshold,
        thresholdElevationFt: e.thresholdElevationFt,
        trueBearingDeg: e.trueBearingDeg,
        declared: full[0]!.declared,
        remarks: full[0]!.remarks,
        intersectionDepartures: declared
          .filter((d) => d.designator === e.designator && d.intersectionTaxiway !== null)
          .map((d) => ({ taxiway: normaliseTaxiwayName(d.intersectionTaxiway!), declared: d.declared })),
      };
    }) as [RunwayEnd, RunwayEnd];
    runways.push({
      designator: `${ends[0].designator}/${ends[1].designator}`,
      lengthM: sorted[0]!.lengthM,
      widthM: sorted[0]!.widthM,
      ends,
      sourceId: 'uk-aip',
    });
  }
  runways.sort((a, b) => a.designator.localeCompare(b.designator));
  ok(`AIP: ${runways.length} runways, ${declared.length} declared-distance entries, ${publishedTaxiways.length} published taxiways`);

  // Internal consistency of the AIP threshold data: bearing between the two thresholds should match the published true bearing.
  for (const r of runways) {
    const [a, b] = r.ends;
    const diff = bearingDifferenceDeg(trueBearingDeg(a.threshold, b.threshold), a.trueBearingDeg);
    (diff < 0.1 ? ok : warn)(`AIP ${r.designator}: threshold-to-threshold bearing differs from published ${a.designator} bearing by ${diff.toFixed(3)}°`);
  }

  // ---------------------------------------------------------------- OSM
  const net = buildOsmNetwork(osm, 'osm');
  ok(
    `OSM: ${net.nodes.length} nodes, ${net.edges.length} edges, ${net.holdingPoints.length} holding points ` +
      `(${net.holdingPoints.filter((h) => h.name !== null).length} named), ${net.stands.length} stands`,
  );

  // ---------------------------------------------------------------- Cross-checks
  for (const r of runways) {
    const osmRunway = net.runways.find((o) => o.ref === r.designator);
    if (osmRunway === undefined) {
      fail(`Runway ${r.designator}: not found in OSM`);
      continue;
    }
    const osmLength = osmRunway.segments.reduce((sum, [a, b]) => sum + distanceM(a, b), 0);
    const lengthDiff = Math.abs(osmLength - r.lengthM);
    (lengthDiff <= TOLERANCE.runwayLengthDiffM ? ok : warn)(
      `Runway ${r.designator}: OSM centreline ${osmLength.toFixed(0)} m (${osmRunway.wayIds.length} ways) vs AIP length ${r.lengthM} m (diff ${lengthDiff.toFixed(0)} m)`,
    );
    for (const end of r.ends) {
      const off = distanceToSegmentsM(end.threshold, osmRunway.segments);
      (off <= TOLERANCE.thresholdOffCentrelineM ? ok : warn)(
        `Runway ${end.designator}: AIP threshold is ${off.toFixed(1)} m from the OSM centreline`,
      );
    }
  }

  // Stand size limits: estimated from stand geometry until published stand data is imported.
  sources.push({
    id: 'stand-size-estimate',
    name: 'Stand wingspan limits estimated from stand spacing',
    version: `derived from OSM snapshot ${osmVersion}`,
    licence: 'Derived internally from ODbL data',
    provenance: {
      status: 'derived',
      tier: 5,
      note: 'Max wingspan = spacing to the nearest side-by-side stand minus wingtip clearance. Replace with EGLL AD 2.24 parking chart / stand data.',
    },
  });
  const estimates = estimateStands(net.stands, centroid(runways.flatMap((r) => r.ends.map((e) => e.threshold))));
  const stands = net.stands.map((s) => {
    const est = estimates.get(s.name);
    const span = est?.maxWingspanM ?? null;
    return { ...s, maxWingspanM: span, maxWingspanSourceId: 'stand-size-estimate', conflictsWith: est?.conflictsWith ?? [] };
  });
  const sized = stands.filter((s) => s.maxWingspanM !== null);
  ok(
    `Stand size estimate: ${sized.length} of ${stands.length} stands sized ` +
      `(code C or smaller: ${sized.filter((s) => s.maxWingspanM! < 36).length}, ` +
      `up to code E: ${sized.filter((s) => s.maxWingspanM! >= 36 && s.maxWingspanM! < 65).length}, ` +
      `code F: ${sized.filter((s) => s.maxWingspanM! >= 65).length})`,
  );

  const surfaceDraft: SurfaceDataset = {
    meta: { airport: icao, datasetVersion: '', airac: null, referencePoint: { lat: 0, lon: 0 } },
    sources,
    runways,
    publishedTaxiways,
    nodes: net.nodes,
    edges: net.edges,
    holdingPoints: net.holdingPoints,
    stands,
    areas: net.areas,
  };
  const graph = new SurfaceGraph(surfaceDraft);
  const osmTaxiways = new Set(graph.taxiwayNames());

  // Published taxiways: AD 2.8 lists sections like "A EAST"; compare on the base designator.
  const baseName = (d: string) => normaliseTaxiwayName(d).replace(/\s+(EAST|WEST|NORTH|SOUTH)$/, '');
  const missingPublished = [...new Set(publishedTaxiways.map((t) => baseName(t.designator)))].filter((n) => !osmTaxiways.has(n));
  if (missingPublished.length === 0) ok('Every AIP AD 2.8 taxiway is present in the OSM network');
  else warn(`AIP AD 2.8 taxiways not found in OSM: ${missingPublished.join(', ')}`);

  // Intersection departure points: the taxiway must exist and have a named holding point.
  const intersectionTaxiways = [...new Set(runways.flatMap((r) => r.ends.flatMap((e) => e.intersectionDepartures.map((d) => d.taxiway))))];
  for (const t of intersectionTaxiways.sort()) {
    const hasTaxiway = osmTaxiways.has(t);
    const holds = graph.holdingPoints(t).length;
    (hasTaxiway && holds > 0 ? ok : warn)(`Intersection departure ${t}: taxiway ${hasTaxiway ? 'found' : 'MISSING'}, ${holds} holding point(s) named ${t}`);
  }

  const unconnected = net.stands.filter((s) => s.entryNodeId === null);
  (unconnected.length === 0 ? ok : warn)(
    `${net.stands.length - unconnected.length} of ${net.stands.length} stands connect to the taxi network` +
      (unconnected.length > 0 ? `; not connected: ${unconnected.map((s) => s.name).join(', ')}` : ''),
  );

  const extraOsm = [...osmTaxiways].filter((n) => !publishedTaxiways.some((t) => baseName(t.designator) === n));
  ok(`OSM taxiway names not in the AD 2.8 width table (expected for runway access taxiways/links): ${extraOsm.join(', ')}`);

  // ---------------------------------------------------------------- Final dataset
  const referencePoint =
    parseReferencePoint(aipHtml, icao) ?? centroid(runways.flatMap((r) => r.ends.map((e) => e.threshold)));
  const dataset: SurfaceDataset = {
    ...surfaceDraft,
    meta: {
      airport: icao,
      datasetVersion: `${icao}-surface-${airacDate}-osm-${osmVersion.slice(0, 10)}`,
      airac: airacDate,
      referencePoint,
    },
  };
  return { dataset, checks, osmWarnings: net.warnings };
}

function centroid(points: readonly LatLon[]): LatLon {
  return {
    lat: points.reduce((s, p) => s + p.lat, 0) / points.length,
    lon: points.reduce((s, p) => s + p.lon, 0) / points.length,
  };
}

/** Markdown report of the build and its cross-checks. */
export function formatReport(out: BuildOutput): string {
  const icon = { ok: 'OK', warning: 'WARN', error: 'ERROR' } as const;
  const lines = [
    `# ${out.dataset.meta.airport} surface data — build report`,
    '',
    `Dataset version: \`${out.dataset.meta.datasetVersion}\``,
    '',
    '## Sources',
    '',
    ...out.dataset.sources.map((s) => `- **${s.name}** — ${s.version}. Provenance: ${s.provenance.status} (tier ${s.provenance.tier}). Licence: ${s.licence}`),
    '',
    '## Checks',
    '',
    ...out.checks.map((c) => `- ${icon[c.status]} — ${c.message}`),
    '',
    `## OSM import warnings (${out.osmWarnings.length})`,
    '',
    ...out.osmWarnings.map((w) => `- ${w}`),
    '',
  ];
  return lines.join('\n');
}
