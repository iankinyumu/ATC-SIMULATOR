import { z } from 'zod';
import { ProvenanceSchema } from '../data/provenance';

const LatLonSchema = z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) });

/**
 * Where a group of values came from. Elements refer to a source by id, so provenance is recorded
 * once per source instead of on every node.
 */
export const SurfaceSourceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** e.g. "AIRAC 10/2026, effective 2026-10-01" or an OSM snapshot timestamp. */
  version: z.string().min(1),
  licence: z.string().min(1),
  provenance: ProvenanceSchema,
});
export type SurfaceSource = z.infer<typeof SurfaceSourceSchema>;

export const SurfaceNodeSchema = z.object({
  id: z.string().min(1),
  lat: z.number(),
  lon: z.number(),
});
export type SurfaceNode = z.infer<typeof SurfaceNodeSchema>;

/**
 * Kind of movement-area edge:
 * - `taxiway`: named taxiway
 * - `taxilane`: unnamed apron taxi route (name unknown in the source)
 * - `runway`: runway centreline; never used for taxi routing unless explicitly cleared
 * - `standLead`: stand lead-in line
 */
export const SurfaceEdgeKindSchema = z.enum(['taxiway', 'taxilane', 'runway', 'standLead']);
export type SurfaceEdgeKind = z.infer<typeof SurfaceEdgeKindSchema>;

export const SurfaceEdgeSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  kind: SurfaceEdgeKindSchema,
  /** Taxiway designator ("A", "LINK 22", "A10E"), runway designator ("09L/27R"), stand id, or null. */
  name: z.string().nullable(),
  lengthM: z.number().nonnegative(),
  sourceId: z.string().min(1),
  sourceRef: z.string().optional(),
});
export type SurfaceEdge = z.infer<typeof SurfaceEdgeSchema>;

export const HoldingPointSchema = z.object({
  id: z.string().min(1),
  /** Published designator (e.g. "A10E"), or null when the source has none. */
  name: z.string().nullable(),
  nodeId: z.string().min(1),
  type: z.enum(['runway', 'intermediate', 'ils', 'unknown']),
  sourceId: z.string().min(1),
  sourceRef: z.string().optional(),
});
export type HoldingPoint = z.infer<typeof HoldingPointSchema>;

export const StandSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Parked (stop) position. */
  position: LatLonSchema,
  /** True heading of a parked aircraft (nose-in), when it can be derived. */
  headingTrueDeg: z.number().min(0).max(360).nullable(),
  /** Node where the stand joins the taxi network, or null if not connected in the source. */
  entryNodeId: z.string().nullable(),
  /** Network node at the parked position (end of the lead-in line), or null if not in the network. */
  stopNodeId: z.string().nullable().default(null),
  /** Largest wingspan the stand can take, or null when unknown (no limit is then applied). */
  maxWingspanM: z.number().positive().nullable().default(null),
  /** Source of `maxWingspanM` and `conflictsWith` (e.g. an estimate from stand geometry). */
  maxWingspanSourceId: z.string().nullable().default(null),
  /** Overlapping stands (MARS / Multi Choice Apron alternatives) that cannot be used at the same time. */
  conflictsWith: z.array(z.string()).default([]),
  sourceId: z.string().min(1),
  sourceRef: z.string().optional(),
});
export type Stand = z.infer<typeof StandSchema>;

export const DeclaredDistancesSchema = z.object({
  toraM: z.number().positive(),
  todaM: z.number().positive(),
  asdaM: z.number().positive(),
  /** Null for intersection take-off entries, which have no LDA. */
  ldaM: z.number().positive().nullable(),
});
export type DeclaredDistances = z.infer<typeof DeclaredDistancesSchema>;

export const RunwayEndSchema = z.object({
  designator: z.string().min(2),
  threshold: LatLonSchema,
  thresholdElevationFt: z.number(),
  trueBearingDeg: z.number().min(0).max(360),
  declared: DeclaredDistancesSchema,
  /** Remarks published with the declared distances, e.g. displaced threshold. */
  remarks: z.array(z.string()),
  intersectionDepartures: z.array(
    z.object({
      taxiway: z.string().min(1),
      declared: DeclaredDistancesSchema,
    }),
  ),
});
export type RunwayEnd = z.infer<typeof RunwayEndSchema>;

export const RunwaySchema = z.object({
  designator: z.string().min(3),
  lengthM: z.number().positive(),
  widthM: z.number().positive(),
  ends: z.tuple([RunwayEndSchema, RunwayEndSchema]),
  sourceId: z.string().min(1),
});
export type Runway = z.infer<typeof RunwaySchema>;

export const PublishedTaxiwaySchema = z.object({
  /** As published, e.g. "A EAST", "LINK 22", "Y". */
  designator: z.string().min(1),
  widthM: z.number().positive(),
  sourceId: z.string().min(1),
});

/** Outline of a paved area or building, for display only (not used for routing). */
export const SurfaceAreaSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['apron', 'terminal', 'hangar']),
  name: z.string().nullable(),
  outline: z.array(LatLonSchema).min(3),
  sourceId: z.string().min(1),
  sourceRef: z.string().optional(),
});
export type SurfaceArea = z.infer<typeof SurfaceAreaSchema>;

/**
 * Aerodrome surface dataset: runways and published taxiways from the AIP, plus the movement
 * network geometry (nodes, edges, holding points, stands) and display outlines (areas).
 */
export const SurfaceDatasetSchema = z
  .object({
    meta: z.object({
      airport: z.string().min(1),
      datasetVersion: z.string().min(1),
      airac: z.string().nullable(),
      referencePoint: LatLonSchema,
    }),
    sources: z.array(SurfaceSourceSchema).min(1),
    runways: z.array(RunwaySchema),
    publishedTaxiways: z.array(PublishedTaxiwaySchema),
    nodes: z.array(SurfaceNodeSchema),
    edges: z.array(SurfaceEdgeSchema),
    holdingPoints: z.array(HoldingPointSchema),
    stands: z.array(StandSchema),
    areas: z.array(SurfaceAreaSchema).default([]),
  })
  .superRefine((d, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    const sourceIds = new Set(d.sources.map((s) => s.id));
    const nodeIds = new Set<string>();
    for (const n of d.nodes) {
      if (nodeIds.has(n.id)) issue(`Duplicate node id ${n.id}`);
      nodeIds.add(n.id);
    }
    const checkSource = (what: string, sourceId: string) => {
      if (!sourceIds.has(sourceId)) issue(`${what} refers to unknown source ${sourceId}`);
    };
    for (const e of d.edges) {
      if (!nodeIds.has(e.from) || !nodeIds.has(e.to)) issue(`Edge ${e.id} refers to an unknown node`);
      checkSource(`Edge ${e.id}`, e.sourceId);
    }
    for (const h of d.holdingPoints) {
      if (!nodeIds.has(h.nodeId)) issue(`Holding point ${h.id} refers to unknown node ${h.nodeId}`);
      checkSource(`Holding point ${h.id}`, h.sourceId);
    }
    for (const s of d.stands) {
      if (s.entryNodeId !== null && !nodeIds.has(s.entryNodeId)) issue(`Stand ${s.id} refers to unknown node ${s.entryNodeId}`);
      checkSource(`Stand ${s.id}`, s.sourceId);
      if (s.maxWingspanSourceId !== null) checkSource(`Stand ${s.id} size`, s.maxWingspanSourceId);
    }
    for (const r of d.runways) checkSource(`Runway ${r.designator}`, r.sourceId);
    for (const a of d.areas) checkSource(`Area ${a.id}`, a.sourceId);
    for (const t of d.publishedTaxiways) checkSource(`Taxiway ${t.designator}`, t.sourceId);
  });
export type SurfaceDataset = z.infer<typeof SurfaceDatasetSchema>;

export function loadSurfaceDataset(raw: unknown): SurfaceDataset {
  return SurfaceDatasetSchema.parse(raw);
}
