import { LocalProjection, standFamily, type LatLon, type Stand } from '@atc/sim-core';

/**
 * Wingtip clearance assumed between aircraft on adjacent stands: 7.5 m for code D–F and 4.5 m
 * for code C (ICAO Annex 14 stand clearances, recalled — to verify).
 */
const CLEARANCE_LARGE_M = 7.5;
const CLEARANCE_CODE_C_M = 4.5;
const CODE_C_MAX_SPAN_M = 36;
const CODE_F_MAX_SPAN_M = 80;

/** Geometry tolerances for deciding that two stands are side by side. Not aviation values. */
const SIDE_BY_SIDE = { maxAlongM: 45, maxLateralM: 120, maxHeadingDiffDeg: 30 };
/**
 * Stand centre-lines closer than this are alternatives on a Multi Choice Apron or MARS stand
 * (UK AIP EGLL AD 2.9), not neighbours: only one of them can be used at a time.
 */
const ALTERNATIVE_MAX_LATERAL_M = 25;

export interface StandEstimate {
  /** Largest wingspan, or null when the stand has no parallel neighbour or no heading. */
  readonly maxWingspanM: number | null;
  /** Stands that overlap this one and cannot be used at the same time. */
  readonly conflictsWith: string[];
}

/**
 * Estimates each stand's largest wingspan from the spacing to its side-by-side neighbours
 * (span ≤ centre-line spacing − wingtip clearance, assuming similar-sized neighbours), and finds
 * overlapping alternative stands. A derived estimate, not published stand data.
 */
export function estimateStands(stands: readonly Stand[], reference: LatLon): Map<string, StandEstimate> {
  const proj = new LocalProjection(reference);
  const names = stands.map((s) => s.name);
  const local = stands.map((s) => ({ stand: s, p: proj.toLocal(s.position), family: standFamily(s.name, names) }));
  const result = new Map<string, StandEstimate>();

  for (const a of local) {
    const conflicts = new Set<string>();
    // MARS: the centre stand and its own L/R stands are alternatives.
    for (const b of local) {
      if (b !== a && b.family === a.family && (a.family === a.stand.name || b.family === b.stand.name)) conflicts.add(b.stand.name);
    }
    const h = a.stand.headingTrueDeg;
    if (h === null) {
      result.set(a.stand.name, { maxWingspanM: null, conflictsWith: [...conflicts].sort() });
      continue;
    }
    const rad = (h * Math.PI) / 180;
    const axis = { x: Math.sin(rad), y: Math.cos(rad) };
    const lateralAxis = { x: Math.cos(rad), y: -Math.sin(rad) };
    let left = Infinity;
    let right = Infinity;
    for (const b of local) {
      if (b === a || conflicts.has(b.stand.name) || b.stand.headingTrueDeg === null) continue;
      const headingDiff = Math.abs(((b.stand.headingTrueDeg - h + 540) % 360) - 180);
      if (headingDiff > SIDE_BY_SIDE.maxHeadingDiffDeg) continue;
      const d = { x: b.p.x - a.p.x, y: b.p.y - a.p.y };
      const along = d.x * axis.x + d.y * axis.y;
      const lateral = d.x * lateralAxis.x + d.y * lateralAxis.y;
      if (Math.abs(along) > SIDE_BY_SIDE.maxAlongM || Math.abs(lateral) > SIDE_BY_SIDE.maxLateralM) continue;
      if (Math.abs(lateral) < ALTERNATIVE_MAX_LATERAL_M) {
        conflicts.add(b.stand.name);
        continue;
      }
      if (lateral > 0) left = Math.min(left, lateral);
      else right = Math.min(right, -lateral);
    }
    const spacing = Math.min(left, right);
    let span: number | null = null;
    if (Number.isFinite(spacing)) {
      span = spacing - CLEARANCE_LARGE_M;
      if (span < CODE_C_MAX_SPAN_M) span = Math.min(spacing - CLEARANCE_CODE_C_M, CODE_C_MAX_SPAN_M);
      span = Math.round(Math.min(span, CODE_F_MAX_SPAN_M) * 10) / 10;
    }
    result.set(a.stand.name, { maxWingspanM: span, conflictsWith: [...conflicts].sort() });
  }

  // Overlap is mutual: make every conflict symmetric.
  for (const [name, est] of result) {
    for (const other of est.conflictsWith) {
      const o = result.get(other);
      if (o !== undefined && !o.conflictsWith.includes(name)) o.conflictsWith.push(name);
    }
  }
  for (const est of result.values()) est.conflictsWith.sort();
  return result;
}
