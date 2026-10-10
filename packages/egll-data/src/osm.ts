import {
  distanceM,
  normaliseTaxiwayName,
  trueBearingDeg,
  type HoldingPoint,
  type LatLon,
  type Stand,
  type SurfaceArea,
  type SurfaceEdge,
  type SurfaceEdgeKind,
  type SurfaceNode,
} from '@atc/sim-core';
import { connectRunwayCrossings } from './crossings';

/** Subset of the Overpass API JSON format that the importer uses. */
export interface OsmNode {
  type: 'node';
  id: number;
  lat: number;
  lon: number;
  tags?: Record<string, string>;
}
export interface OsmWay {
  type: 'way';
  id: number;
  nodes: number[];
  tags?: Record<string, string>;
}
export interface OsmRelation {
  type: 'relation';
  id: number;
  tags?: Record<string, string>;
}
export type OsmElement = OsmNode | OsmWay | OsmRelation;
export interface OverpassResponse {
  osm3s?: { timestamp_osm_base?: string };
  elements: OsmElement[];
}

/** A runway as mapped in OSM: possibly several ways (main section plus displaced-threshold sections). */
export interface OsmRunway {
  readonly ref: string | null;
  readonly wayIds: number[];
  readonly segments: Array<readonly [LatLon, LatLon]>;
}

export interface OsmNetwork {
  readonly nodes: SurfaceNode[];
  readonly edges: SurfaceEdge[];
  readonly holdingPoints: HoldingPoint[];
  readonly stands: Stand[];
  readonly areas: SurfaceArea[];
  readonly runways: OsmRunway[];
  readonly warnings: string[];
}

const nodeId = (osmId: number) => `osm:n${osmId}`;
const isDisused = (tags: Record<string, string>) => Object.keys(tags).some((k) => k.startsWith('disused:'));

const HOLDING_TYPES: Record<string, HoldingPoint['type']> = {
  runway: 'runway',
  intermediate: 'intermediate',
  ILS: 'ils',
};

/**
 * Builds the movement-area network from OpenStreetMap aeroway data:
 * taxiways, runways and stand lead-in lines become edges between OSM nodes.
 */
export function buildOsmNetwork(osm: OverpassResponse, sourceId: string): OsmNetwork {
  const warnings: string[] = [];
  const osmNodes = new Map<number, OsmNode>();
  const ways: OsmWay[] = [];
  for (const e of osm.elements) {
    // Overpass lists tagged nodes, then repeats them untagged ("skel"); keep the tagged copy.
    if (e.type === 'node') {
      if (osmNodes.get(e.id)?.tags === undefined) osmNodes.set(e.id, e);
    } else if (e.type === 'way' && e.tags?.aeroway !== undefined && !isDisused(e.tags)) ways.push(e);
  }

  // OSM maps displaced-threshold sections as separate, unnamed runway ways. They are part of the
  // runway they touch, so they take that runway's designator.
  const runwayRef = new Map<number, string>();
  const runwayWays = ways.filter((w) => w.tags!.aeroway === 'runway');
  for (const w of runwayWays) if (w.tags!.ref !== undefined) runwayRef.set(w.id, w.tags!.ref);
  for (const w of runwayWays) {
    if (runwayRef.has(w.id)) continue;
    const ends = [w.nodes[0], w.nodes[w.nodes.length - 1]];
    const parent = runwayWays.find((o) => o.tags!.ref !== undefined && o.nodes.some((n) => ends.includes(n)));
    if (parent === undefined) warnings.push(`Runway way ${w.id} has no designator and does not touch a named runway`);
    else runwayRef.set(w.id, parent.tags!.ref!);
  }

  const used = new Set<number>();
  const edges: SurfaceEdge[] = [];
  const addWayEdges = (way: OsmWay, kind: SurfaceEdgeKind, name: string | null) => {
    for (let i = 1; i < way.nodes.length; i++) {
      const a = osmNodes.get(way.nodes[i - 1]!);
      const b = osmNodes.get(way.nodes[i]!);
      if (a === undefined || b === undefined) {
        warnings.push(`Way ${way.id} refers to a missing node; segment skipped`);
        continue;
      }
      used.add(a.id);
      used.add(b.id);
      edges.push({
        id: `osm:w${way.id}:${i}`,
        from: nodeId(a.id),
        to: nodeId(b.id),
        kind,
        name,
        lengthM: distanceM(a, b),
        sourceId,
        sourceRef: `way/${way.id}`,
      });
    }
  };

  // Taxiways and runways
  const runways: OsmRunway[] = [];
  const networkNodeIds = new Set<number>();
  for (const way of ways) {
    const tags = way.tags!;
    if (tags.aeroway === 'taxiway') {
      const label = tags.ref ?? tags.name;
      const name = label === undefined ? null : normaliseTaxiwayName(label);
      addWayEdges(way, name === null ? 'taxilane' : 'taxiway', name);
      way.nodes.forEach((n) => networkNodeIds.add(n));
    } else if (tags.aeroway === 'runway') {
      const ref = runwayRef.get(way.id) ?? null;
      addWayEdges(way, 'runway', ref);
      way.nodes.forEach((n) => networkNodeIds.add(n));
      const points = way.nodes.map((n) => osmNodes.get(n)).filter((n): n is OsmNode => n !== undefined);
      const segments = points.slice(1).map((p, i) => [points[i]!, p] as const);
      const existing = runways.find((r) => r.ref === ref && ref !== null);
      if (existing !== undefined) {
        existing.wayIds.push(way.id);
        existing.segments.push(...segments);
      } else {
        runways.push({ ref, wayIds: [way.id], segments: [...segments] });
      }
    }
  }

  // Stands from lead-in lines (preferred) and stand nodes (position only)
  const stands = new Map<string, Stand>();
  for (const way of ways) {
    const tags = way.tags!;
    if (tags.aeroway !== 'parking_position') continue;
    const ref = tags.ref;
    if (ref === undefined) continue;
    if (stands.has(ref)) {
      warnings.push(`Stand ${ref}: more than one lead-in line (way ${way.id} ignored)`);
      continue;
    }
    const entryIndex = way.nodes.findIndex((n) => networkNodeIds.has(n));
    // The parked position is the end of the line furthest from where it joins the network.
    const stopIndex = entryIndex <= (way.nodes.length - 1) / 2 ? way.nodes.length - 1 : 0;
    const beforeStopIndex = stopIndex === 0 ? 1 : stopIndex - 1;
    const stop = osmNodes.get(way.nodes[stopIndex]!);
    const beforeStop = osmNodes.get(way.nodes[beforeStopIndex]!);
    if (stop === undefined || beforeStop === undefined) {
      warnings.push(`Stand ${ref}: lead-in line ${way.id} has missing nodes`);
      continue;
    }
    if (entryIndex < 0) warnings.push(`Stand ${ref}: lead-in line ${way.id} does not join the taxi network`);
    addWayEdges(way, 'standLead', ref);
    stands.set(ref, {
      id: `stand:${ref}`,
      name: ref,
      position: { lat: stop.lat, lon: stop.lon },
      headingTrueDeg: Math.round(trueBearingDeg(beforeStop, stop) * 10) / 10,
      entryNodeId: entryIndex < 0 ? null : nodeId(way.nodes[entryIndex]!),
      stopNodeId: entryIndex < 0 ? null : nodeId(stop.id),
      maxWingspanM: null,
      maxWingspanSourceId: null,
      conflictsWith: [],
      sourceId,
      sourceRef: `way/${way.id}`,
    });
  }
  for (const node of osmNodes.values()) {
    const ref = node.tags?.ref;
    if (node.tags?.aeroway !== 'parking_position' || ref === undefined || stands.has(ref)) continue;
    warnings.push(`Stand ${ref}: position only (no lead-in line), not connected to the taxi network`);
    stands.set(ref, {
      id: `stand:${ref}`,
      name: ref,
      position: { lat: node.lat, lon: node.lon },
      headingTrueDeg: null,
      entryNodeId: null,
      stopNodeId: null,
      maxWingspanM: null,
      maxWingspanSourceId: null,
      conflictsWith: [],
      sourceId,
      sourceRef: `node/${node.id}`,
    });
  }

  // Holding points
  const holdingPoints: HoldingPoint[] = [];
  for (const node of osmNodes.values()) {
    if (node.tags?.aeroway !== 'holding_position') continue;
    if (!used.has(node.id)) {
      warnings.push(`Holding point ${node.tags.ref ?? node.id} is not on the network; skipped`);
      continue;
    }
    holdingPoints.push({
      id: `hp:${node.id}`,
      name: node.tags.ref ?? null,
      nodeId: nodeId(node.id),
      type: HOLDING_TYPES[node.tags['holding_position:type'] ?? ''] ?? 'unknown',
      sourceId,
      sourceRef: `node/${node.id}`,
    });
  }

  const osmNetworkNodes: SurfaceNode[] = [...used]
    .sort((a, b) => a - b)
    .map((id) => {
      const n = osmNodes.get(id)!;
      return { id: nodeId(id), lat: n.lat, lon: n.lon };
    });
  // Display outlines: closed apron, terminal and hangar ways
  const areas: SurfaceArea[] = [];
  for (const way of ways) {
    const kind = way.tags!.aeroway;
    if (kind !== 'apron' && kind !== 'terminal' && kind !== 'hangar') continue;
    if (way.nodes.length < 4 || way.nodes[0] !== way.nodes[way.nodes.length - 1]) continue;
    const outline = way.nodes
      .slice(0, -1)
      .map((n) => osmNodes.get(n))
      .filter((n): n is OsmNode => n !== undefined)
      .map((n) => ({ lat: n.lat, lon: n.lon }));
    if (outline.length < 3) continue;
    areas.push({ id: `area:${way.id}`, kind, name: way.tags!.name ?? way.tags!.ref ?? null, outline, sourceId, sourceRef: `way/${way.id}` });
  }

  const crossings = connectRunwayCrossings(osmNetworkNodes, edges);
  if (crossings.inserted > 0) {
    warnings.push(`Inserted ${crossings.inserted} runway crossing node(s) where OSM taxiways cross runways without connecting`);
  }

  return {
    nodes: crossings.nodes,
    edges: crossings.edges,
    holdingPoints,
    stands: [...stands.values()].sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true })),
    areas,
    runways,
    warnings,
  };
}
