import {
  LocalProjection,
  normaliseTaxiwayName,
  type HoldingPoint,
  type LatLon,
  type Route,
  type Stand,
  type SurfaceDataset,
  type SurfaceEdge,
  type SurfaceGraph,
} from '@atc/sim-core';
import { Container, Graphics, type Text } from 'pixi.js';
import type { Camera, Point } from './camera';
import { LabelLayer } from './labels';
import { CENTRELINE_DASH_M, COLORS, DISPLAY_DEFAULT_WIDTH_M, LABEL_MIN_SCALE, STAND_MARKER_MIN_SCALE, TAXIWAY_CENTRELINE_MIN_SCALE } from './style';

/**
 * Draws the aerodrome surface plan. Pavement is drawn once in world units (metres) so it scales
 * with zoom; thin lines and symbols are redrawn on zoom so they keep a constant screen width.
 */
export class SurfaceScene {
  readonly root = new Container();
  readonly labels = new LabelLayer();
  private readonly world = new Container();
  private readonly pavement = new Graphics();
  private readonly overlay = new Graphics();
  private readonly routeLayer = new Graphics();
  private readonly standLayer = new Graphics();
  private readonly standLabels = new Map<string, Text>();
  /** Per-stand marker colour (e.g. fits / too small / in use for the selected aircraft); default otherwise. */
  private standColors: ReadonlyMap<string, number> | null = null;
  /** Stand to ring (e.g. the one the selected aircraft asked for). */
  private highlightedStand: string | null = null;
  private readonly projection: LocalProjection;
  private readonly nodeXY = new Map<string, Point>();
  private readonly edgeById = new Map<string, SurfaceEdge>();
  private readonly widthByTaxiway = new Map<string, number>();
  private lastScale = NaN;

  route: Route | null = null;
  routeStart: Stand | null = null;
  selectedStand: Stand | null = null;
  selectedHold: HoldingPoint | null = null;

  constructor(
    readonly data: SurfaceDataset,
    readonly graph: SurfaceGraph,
  ) {
    this.projection = new LocalProjection(data.meta.referencePoint);
    for (const n of data.nodes) this.nodeXY.set(n.id, this.toWorld(n));
    for (const e of data.edges) this.edgeById.set(e.id, e);
    for (const t of data.publishedTaxiways) {
      const base = normaliseTaxiwayName(t.designator).replace(/\s+(EAST|WEST|NORTH|SOUTH)$/, '');
      this.widthByTaxiway.set(base, Math.max(t.widthM, this.widthByTaxiway.get(base) ?? 0));
    }

    this.world.addChild(this.pavement, this.overlay, this.standLayer, this.routeLayer);
    this.root.addChild(this.world, this.labels.container);
    this.drawPavement();
    this.addLabels();
  }

  /** Adds a layer drawn in world metres (moves and scales with the map), above the surface. */
  addWorldLayer(layer: Container): void {
    this.world.addChild(layer);
  }

  /** Adds a layer drawn in screen pixels, above the labels. */
  addScreenLayer(layer: Container): void {
    this.root.addChild(layer);
  }

  /** World coordinates: metres east (x) and south (y) of the reference point. */
  toWorld(p: LatLon): Point {
    const l = this.projection.toLocal(p);
    return { x: l.x, y: -l.y };
  }

  toLatLon(p: Point): LatLon {
    return this.projection.toLatLon({ x: p.x, y: -p.y });
  }

  bounds(): { minX: number; minY: number; maxX: number; maxY: number } {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of this.nodeXY.values()) {
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
    }
    return { minX, minY, maxX, maxY };
  }

  edge(id: string): SurfaceEdge | undefined {
    return this.edgeById.get(id);
  }

  node(id: string): Point {
    return this.nodeXY.get(id)!;
  }

  private widthOf(e: SurfaceEdge): number {
    if (e.kind === 'runway') {
      return this.data.runways.find((r) => r.designator === e.name)?.widthM ?? DISPLAY_DEFAULT_WIDTH_M.taxiway;
    }
    if (e.kind === 'taxilane') return DISPLAY_DEFAULT_WIDTH_M.taxilane;
    return (e.name !== null ? this.widthByTaxiway.get(e.name) : undefined) ?? DISPLAY_DEFAULT_WIDTH_M.taxiway;
  }

  // ------------------------------------------------------------------------------------- static

  private drawPavement(): void {
    const g = this.pavement;
    const poly = (outline: readonly LatLon[]) => outline.flatMap((p) => { const w = this.toWorld(p); return [w.x, w.y]; });

    for (const a of this.data.areas.filter((a) => a.kind === 'apron')) g.poly(poly(a.outline)).fill(COLORS.apron);

    // Pavement strokes grouped by colour and width, drawn as one path per group.
    const groups = new Map<string, { color: number; width: number; edges: SurfaceEdge[] }>();
    const order: SurfaceEdge['kind'][] = ['taxilane', 'taxiway', 'runway'];
    for (const e of this.data.edges) {
      if (e.kind === 'standLead') continue;
      const color = e.kind === 'runway' ? COLORS.runway : e.kind === 'taxilane' ? COLORS.taxilane : COLORS.taxiway;
      const width = this.widthOf(e);
      const key = `${e.kind}|${width}`;
      const group = groups.get(key) ?? { color, width, edges: [] };
      group.edges.push(e);
      groups.set(key, group);
    }
    const sorted = [...groups.entries()].sort(([a], [b]) => order.indexOf(a.split('|')[0] as SurfaceEdge['kind']) - order.indexOf(b.split('|')[0] as SurfaceEdge['kind']));
    for (const [, group] of sorted) {
      for (const e of group.edges) {
        const a = this.nodeXY.get(e.from)!;
        const b = this.nodeXY.get(e.to)!;
        g.moveTo(a.x, a.y).lineTo(b.x, b.y);
      }
      g.stroke({ width: group.width, color: group.color, cap: 'round', join: 'round' });
    }

    for (const a of this.data.areas.filter((a) => a.kind !== 'apron')) {
      const terminal = a.kind === 'terminal';
      g.poly(poly(a.outline)).fill(terminal ? COLORS.terminal : COLORS.hangar).stroke({ width: 2, color: terminal ? COLORS.terminalEdge : COLORS.hangarEdge });
    }
  }

  private addLabels(): void {
    // Runway designators, just inside each threshold
    for (const r of this.data.runways) {
      for (const end of r.ends) {
        const t = this.toWorld(end.threshold);
        const rad = (end.trueBearingDeg * Math.PI) / 180;
        const dir = { x: Math.sin(rad), y: -Math.cos(rad) };
        this.labels.add('runway', end.designator, t.x + dir.x * 180, t.y + dir.y * 180, {
          color: COLORS.runwayLabel, size: 15, bold: true, minScale: LABEL_MIN_SCALE.runway,
        });
      }
    }

    // Taxiway names: one label per ~500 m of each connected run of the same taxiway
    const byName = new Map<string, SurfaceEdge[]>();
    for (const e of this.data.edges) {
      if (e.kind !== 'taxiway' || e.name === null) continue;
      byName.set(e.name, [...(byName.get(e.name) ?? []), e]);
    }
    for (const [name, edges] of byName) {
      const anchors: Point[] = [];
      for (const e of [...edges].sort((a, b) => b.lengthM - a.lengthM)) {
        const a = this.nodeXY.get(e.from)!;
        const b = this.nodeXY.get(e.to)!;
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (anchors.some((p) => Math.hypot(p.x - mid.x, p.y - mid.y) < 500)) continue;
        anchors.push(mid);
        this.labels.add('taxiway', name, mid.x, mid.y, { color: COLORS.taxiwayLabel, size: 12, bold: true, minScale: LABEL_MIN_SCALE.taxiway });
      }
    }

    // Holding point names (runway holds first)
    const holds = [...this.data.holdingPoints].sort((a, b) => Number(b.type === 'runway') - Number(a.type === 'runway'));
    for (const h of holds) {
      if (h.name === null) continue;
      const p = this.nodeXY.get(h.nodeId)!;
      this.labels.add('hold', h.name, p.x, p.y, { color: COLORS.holdLabel, size: 11, minScale: LABEL_MIN_SCALE.hold, dy: -11 });
    }

    // Stand numbers
    for (const s of this.data.stands) {
      const p = this.toWorld(s.position);
      this.standLabels.set(s.name, this.labels.add('stand', s.name, p.x, p.y, { color: COLORS.stand, size: 11, minScale: LABEL_MIN_SCALE.stand, dy: 11 }));
    }
  }

  // ------------------------------------------------------------------------------------ dynamic

  update(camera: Camera, width: number, height: number): void {
    this.world.scale.set(camera.scale);
    this.world.position.set(camera.x, camera.y);
    if (camera.scale !== this.lastScale) {
      this.lastScale = camera.scale;
      this.drawOverlay(camera.scale);
      this.drawStandMarkers(camera.scale);
      this.drawRoute(camera.scale);
    }
    this.labels.update(camera, width, height);
  }

  /**
   * Colours stand markers and numbers (null restores the default) and rings one stand.
   * Used to show which stands suit the selected aircraft.
   */
  setStandColors(colors: ReadonlyMap<string, number> | null, highlight: string | null): void {
    this.standColors = colors;
    this.highlightedStand = highlight;
    for (const [name, text] of this.standLabels) text.style.fill = colors?.get(name) ?? COLORS.stand;
    this.drawStandMarkers(this.lastScale);
  }

  /** Stand markers: a small square at each parking position, coloured by status. */
  private drawStandMarkers(scale: number): void {
    const g = this.standLayer.clear();
    if (!Number.isFinite(scale) || scale < STAND_MARKER_MIN_SCALE) return;
    const px = (n: number) => n / scale;
    const half = px(3.5);
    for (const s of this.data.stands) {
      const p = this.toWorld(s.position);
      g.rect(p.x - half, p.y - half, half * 2, half * 2).fill(this.standColors?.get(s.name) ?? COLORS.stand);
    }
    if (this.highlightedStand !== null) {
      const s = this.data.stands.find((x) => x.name === this.highlightedStand);
      if (s !== undefined) {
        const p = this.toWorld(s.position);
        g.circle(p.x, p.y, px(11)).stroke({ width: px(2.5), color: COLORS.request });
      }
    }
  }

  /** Redraws the route and selection markers (call after the route or selection changes). */
  refreshRoute(): void {
    this.drawRoute(this.lastScale);
  }

  private drawOverlay(scale: number): void {
    const g = this.overlay;
    const px = (n: number) => n / scale;
    g.clear();

    // Runway markings: dashed centreline between thresholds and a threshold bar at each end.
    for (const r of this.data.runways) {
      const a = this.toWorld(r.ends[0].threshold);
      const b = this.toWorld(r.ends[1].threshold);
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const ux = (b.x - a.x) / len;
      const uy = (b.y - a.y) / len;
      for (let d = 0; d < len; d += CENTRELINE_DASH_M.dash + CENTRELINE_DASH_M.gap) {
        const e = Math.min(len, d + CENTRELINE_DASH_M.dash);
        g.moveTo(a.x + ux * d, a.y + uy * d).lineTo(a.x + ux * e, a.y + uy * e);
      }
      g.stroke({ width: px(1), color: COLORS.runwayMarking, alpha: 0.8 });
      const half = r.widthM / 2;
      for (const t of [a, b]) g.moveTo(t.x - uy * half, t.y + ux * half).lineTo(t.x + uy * half, t.y - ux * half);
      g.stroke({ width: px(2.5), color: COLORS.runwayMarking });
    }

    // Taxiway centrelines when zoomed in
    if (scale >= TAXIWAY_CENTRELINE_MIN_SCALE) {
      for (const e of this.data.edges) {
        if (e.kind !== 'taxiway' && e.kind !== 'taxilane') continue;
        const a = this.nodeXY.get(e.from)!;
        const b = this.nodeXY.get(e.to)!;
        g.moveTo(a.x, a.y).lineTo(b.x, b.y);
      }
      g.stroke({ width: px(1), color: COLORS.standLead, alpha: 0.55 });
    }

    // Stand lead-in lines
    for (const e of this.data.edges) {
      if (e.kind !== 'standLead') continue;
      const a = this.nodeXY.get(e.from)!;
      const b = this.nodeXY.get(e.to)!;
      g.moveTo(a.x, a.y).lineTo(b.x, b.y);
    }
    g.stroke({ width: px(1), color: COLORS.standLead, alpha: 0.85 });

    // Holding points: a bar across the taxiway (red = runway holding point, amber = intermediate)
    for (const h of this.data.holdingPoints) {
      const p = this.nodeXY.get(h.nodeId)!;
      const along = this.directionAt(h.nodeId);
      const halfWidth = Math.max(px(5), this.widthAtNode(h.nodeId) / 2);
      const color = h.type === 'intermediate' ? COLORS.holdIntermediate : COLORS.holdRunway;
      g.moveTo(p.x - along.y * halfWidth, p.y + along.x * halfWidth)
        .lineTo(p.x + along.y * halfWidth, p.y - along.x * halfWidth)
        .stroke({ width: px(h.type === 'runway' || h.type === 'ils' ? 3 : 2), color });
    }
  }

  private drawRoute(scale: number): void {
    const g = this.routeLayer;
    const px = (n: number) => n / scale;
    g.clear();
    if (this.route !== null && this.route.nodeIds.length > 0) {
      const pts = this.route.nodeIds.map((id) => this.nodeXY.get(id)!);
      if (this.routeStart !== null) pts.unshift(this.toWorld(this.routeStart.position));
      g.moveTo(pts[0]!.x, pts[0]!.y);
      for (const p of pts.slice(1)) g.lineTo(p.x, p.y);
      g.stroke({ width: px(4), color: COLORS.route, alpha: 0.9, cap: 'round', join: 'round' });
    }
    if (this.selectedStand !== null) {
      const p = this.toWorld(this.selectedStand.position);
      g.circle(p.x, p.y, px(9)).stroke({ width: px(2), color: COLORS.selection });
    }
    if (this.selectedHold !== null) {
      const p = this.nodeXY.get(this.selectedHold.nodeId)!;
      g.circle(p.x, p.y, px(9)).stroke({ width: px(2), color: COLORS.selection });
    }
  }

  /** A taxiway or taxilane edge through the node (used to orient holding point bars). */
  private taxiEdgeAt(nodeId: string): SurfaceEdge | undefined {
    if (this.taxiEdgeByNode === null) {
      this.taxiEdgeByNode = new Map();
      for (const e of this.data.edges) {
        if (e.kind === 'runway' || e.kind === 'standLead') continue;
        for (const n of [e.from, e.to]) if (!this.taxiEdgeByNode.has(n)) this.taxiEdgeByNode.set(n, e);
      }
    }
    return this.taxiEdgeByNode.get(nodeId);
  }
  private taxiEdgeByNode: Map<string, SurfaceEdge> | null = null;

  /** Unit direction of the taxiway through a node. */
  private directionAt(nodeId: string): Point {
    const e = this.taxiEdgeAt(nodeId);
    if (e === undefined) return { x: 1, y: 0 };
    const a = this.nodeXY.get(e.from)!;
    const b = this.nodeXY.get(e.to)!;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  }

  private widthAtNode(nodeId: string): number {
    const e = this.taxiEdgeAt(nodeId);
    return e === undefined ? DISPLAY_DEFAULT_WIDTH_M.taxiway : this.widthOf(e);
  }

  // -------------------------------------------------------------------------------- hit testing

  /** Nearest stand or holding point within `radiusPx` of a screen point. */
  pick(camera: Camera, screen: Point, radiusPx = 12): { stand: Stand } | { hold: HoldingPoint } | null {
    let best: { d: number; hit: { stand: Stand } | { hold: HoldingPoint } } | null = null;
    const consider = (wx: number, wy: number, hit: { stand: Stand } | { hold: HoldingPoint }) => {
      const p = camera.toScreen(wx, wy);
      const d = Math.hypot(p.x - screen.x, p.y - screen.y);
      if (d <= radiusPx && (best === null || d < best.d)) best = { d, hit };
    };
    for (const s of this.data.stands) {
      const p = this.toWorld(s.position);
      consider(p.x, p.y, { stand: s });
    }
    for (const h of this.data.holdingPoints) {
      const p = this.nodeXY.get(h.nodeId)!;
      consider(p.x, p.y, { hold: h });
    }
    return best === null ? null : (best as { hit: { stand: Stand } | { hold: HoldingPoint } }).hit;
  }
}
