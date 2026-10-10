import type { LocalXY } from '../geo/geo';

/** A point on a movement path, in local metres (x east, y north). */
export interface PathPoint {
  readonly x: number;
  readonly y: number;
  /** Surface network node at this point, if any. */
  readonly nodeId: string | null;
}

/** True bearing (degrees) of a local vector. */
export function bearingOf(dx: number, dy: number): number {
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
}

/** Polyline that an aircraft follows, measured by distance along it (`s`, metres). */
export class Path {
  readonly points: readonly PathPoint[];
  /** Distance from the start to each point. */
  readonly cumulative: readonly number[];
  readonly length: number;

  constructor(points: readonly PathPoint[]) {
    const kept: PathPoint[] = [];
    for (const p of points) {
      const last = kept[kept.length - 1];
      if (last !== undefined && Math.hypot(p.x - last.x, p.y - last.y) < 0.01) {
        if (last.nodeId === null && p.nodeId !== null) kept[kept.length - 1] = p;
        continue;
      }
      kept.push(p);
    }
    if (kept.length === 0) throw new Error('A path needs at least one point');
    const cumulative = [0];
    for (let i = 1; i < kept.length; i++) {
      cumulative.push(cumulative[i - 1]! + Math.hypot(kept[i]!.x - kept[i - 1]!.x, kept[i]!.y - kept[i - 1]!.y));
    }
    this.points = kept;
    this.cumulative = cumulative;
    this.length = cumulative[cumulative.length - 1]!;
  }

  /** Index of the segment containing distance s (segment i runs from point i to point i+1). */
  segmentAt(s: number): number {
    if (this.points.length < 2) return 0;
    let lo = 0;
    let hi = this.points.length - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.cumulative[mid]! <= s) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  positionAt(s: number): LocalXY {
    if (this.points.length < 2) return this.points[0]!;
    const clamped = Math.max(0, Math.min(this.length, s));
    const i = this.segmentAt(clamped);
    const a = this.points[i]!;
    const b = this.points[i + 1]!;
    const segLen = this.cumulative[i + 1]! - this.cumulative[i]!;
    const t = segLen === 0 ? 0 : (clamped - this.cumulative[i]!) / segLen;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }

  /** Bearing of the segment at distance s. */
  segmentBearingAt(s: number): number {
    if (this.points.length < 2) return 0;
    const i = this.segmentAt(Math.max(0, Math.min(this.length, s)));
    const a = this.points[i]!;
    const b = this.points[i + 1]!;
    return bearingOf(b.x - a.x, b.y - a.y);
  }

  /**
   * Smoothed direction of travel: from the point at s towards the point `lookaheadM` further on.
   * This turns the aircraft progressively through corners instead of snapping at each vertex.
   */
  travelBearingAt(s: number, lookaheadM: number): number {
    if (this.points.length < 2) return 0;
    const here = this.positionAt(s);
    const ahead = this.positionAt(Math.min(this.length, s + lookaheadM));
    const d = Math.hypot(ahead.x - here.x, ahead.y - here.y);
    return d < 0.5 ? this.segmentBearingAt(Math.min(s, this.length - 0.01)) : bearingOf(ahead.x - here.x, ahead.y - here.y);
  }

  /** Direction change (degrees, 0–180) at interior point i. */
  turnAngleAt(i: number): number {
    if (i <= 0 || i >= this.points.length - 1) return 0;
    const a = this.points[i - 1]!;
    const b = this.points[i]!;
    const c = this.points[i + 1]!;
    const d = Math.abs(((bearingOf(c.x - b.x, c.y - b.y) - bearingOf(b.x - a.x, b.y - a.y) + 540) % 360) - 180);
    return d;
  }

  /**
   * Approximate turn radius at interior point i, from the turn angle and the shorter adjoining
   * segment. Infinity on a straight.
   */
  turnRadiusAt(i: number): number {
    const angle = (this.turnAngleAt(i) * Math.PI) / 180;
    if (angle < 1e-3) return Infinity;
    const shorter = Math.min(this.cumulative[i]! - this.cumulative[i - 1]!, this.cumulative[i + 1]! - this.cumulative[i]!);
    return shorter / 2 / Math.tan(angle / 2);
  }

  /** The first point at or after distance s that is a network node. */
  nextNodeFrom(s: number): { index: number; nodeId: string } | null {
    for (let i = 0; i < this.points.length; i++) {
      const id = this.points[i]!.nodeId;
      if (this.cumulative[i]! >= s - 0.01 && id !== null) return { index: i, nodeId: id };
    }
    return null;
  }
}
