import type { Aircraft, Path, World } from '@atc/sim-core';
import { Container, Graphics, Text } from 'pixi.js';
import type { Camera, Point } from './camera';
import { COLORS, FONT } from './style';

/** Aircraft outline, nose pointing up (−y), in units of aircraft length (1 = nose to tail). */
const SHAPE = [
  0, -0.5, 0.05, -0.42, 0.06, -0.12, 0.48, 0.06, 0.48, 0.12, 0.06, 0.02, 0.05, 0.3, 0.2, 0.42, 0.2, 0.47, 0, 0.42,
  -0.2, 0.47, -0.2, 0.42, -0.05, 0.3, -0.06, 0.02, -0.48, 0.12, -0.48, 0.06, -0.06, -0.12, -0.05, -0.42,
];

/** Smallest on-screen aircraft length, so symbols stay visible when zoomed out. */
const MIN_SYMBOL_PX = 16;
const KT_PER_MPS = 1.943844;

interface Sprite {
  readonly symbol: Graphics;
  readonly tag: Text;
  /** Pending pilot request, shown under the tag. */
  readonly request: Text;
  readonly leader: Graphics;
  /** Box behind the tag text. */
  readonly box: Graphics;
}

/** Short form of a pending request for data tags and lists. */
export function requestTag(kind: string, stand: string | null): string {
  if (kind === 'pushback') return 'REQ PUSH';
  if (kind === 'taxi') return 'REQ TAXI';
  return `REQ STAND ${stand ?? ''}`;
}

/** Aircraft symbols (oriented, real length when zoomed in) with screen-space data tags. */
export class TrafficLayer {
  readonly world = new Container();
  readonly screen = new Container();
  private readonly pathLayer = new Graphics();
  private readonly sprites = new Map<string, Sprite>();
  selected: string | null = null;
  /** Route of the instruction being composed, drawn before it is sent. */
  previewPath: Path | null = null;

  constructor(private readonly lengthM: number) {
    this.world.addChild(this.pathLayer);
  }

  /** Display world coordinates (x east, y south) of an aircraft. */
  static position(a: Readonly<Aircraft>): Point | null {
    return a.surface === null ? null : { x: a.surface.x, y: -a.surface.y };
  }

  update(world: World, camera: Camera): void {
    const seen = new Set<string>();
    for (const a of world.allAircraft()) {
      const p = TrafficLayer.position(a);
      if (p === null || a.surface === null) continue;
      seen.add(a.callsign);
      const sprite = this.sprites.get(a.callsign) ?? this.create(a.callsign);
      const selected = a.callsign === this.selected;

      const length = Math.max(a.type?.lengthM ?? this.lengthM, MIN_SYMBOL_PX / camera.scale);
      sprite.symbol.position.set(p.x, p.y);
      sprite.symbol.scale.set(length);
      sprite.symbol.rotation = (a.surface.headingTrueDeg * Math.PI) / 180;
      sprite.symbol.tint = selected ? COLORS.selection : a.surface.phase === 'parked' ? 0x9aa3ad : 0xffffff;

      const s = camera.toScreen(p.x, p.y);
      const tagX = s.x + 18;
      const tagY = s.y - 22;
      const speedKt = Math.round(a.surface.speedMps * KT_PER_MPS);
      const where = a.surface.motion?.limit ?? (a.surface.standName !== null ? `STAND ${a.surface.standName}` : '');
      sprite.tag.text = `${a.callsign} ${a.typeDesignator ?? ''}\n${String(speedKt).padStart(2, '0')}KT ${a.surface.phase.toUpperCase()}${where ? ` ${where.toUpperCase()}` : ''}`;
      sprite.tag.position.set(Math.round(tagX), Math.round(tagY));
      const pending = world.requests.pendingFor(a.callsign);
      sprite.request.text = pending === undefined ? '' : requestTag(pending.kind, pending.stand);
      sprite.request.position.set(Math.round(tagX), Math.round(tagY) + 26);
      sprite.tag.style.fill = selected ? COLORS.selection : 0xe6edf3;
      const boxW = Math.max(sprite.tag.width, sprite.request.text === '' ? 0 : sprite.request.width) + 8;
      const boxH = sprite.tag.height + (sprite.request.text === '' ? 0 : 14) + 4;
      const edge = selected ? COLORS.selection : pending !== undefined ? COLORS.request : 0x5f7086;
      sprite.box
        .clear()
        .rect(Math.round(tagX) - 4, Math.round(tagY) - 2, boxW, boxH)
        .fill({ color: 0x050c16, alpha: 0.78 })
        .stroke({ width: 1, color: edge });
      sprite.leader.clear().moveTo(s.x + 5, s.y - 5).lineTo(tagX - 4, tagY + boxH - 2).stroke({ width: 1, color: edge });
    }
    for (const [callsign, sprite] of this.sprites) {
      if (seen.has(callsign)) continue;
      sprite.symbol.destroy();
      sprite.tag.destroy();
      sprite.request.destroy();
      sprite.leader.destroy();
      sprite.box.destroy();
      this.sprites.delete(callsign);
    }
    this.drawSelectedPath(world, camera);
  }

  /** Remaining cleared path of the selected aircraft. */
  private drawSelectedPath(world: World, camera: Camera): void {
    const g = this.pathLayer.clear();
    if (this.previewPath !== null) {
      const pts = this.previewPath.points;
      g.moveTo(pts[0]!.x, -pts[0]!.y);
      for (const p of pts.slice(1)) g.lineTo(p.x, -p.y);
      g.stroke({ width: 4 / camera.scale, color: COLORS.preview, alpha: 0.85, cap: 'round', join: 'round' });
    }
    const a = this.selected === null ? undefined : world.getAircraft(this.selected);
    const m = a?.surface?.motion;
    if (a === undefined || m == null) return;
    const here = { x: a.surface!.x, y: -a.surface!.y };
    g.moveTo(here.x, here.y);
    for (let i = m.path.segmentAt(m.s) + 1; i < m.path.points.length; i++) g.lineTo(m.path.points[i]!.x, -m.path.points[i]!.y);
    g.stroke({ width: 3 / camera.scale, color: COLORS.route, alpha: 0.6, cap: 'round', join: 'round' });
  }

  /** Aircraft nearest to a screen point, within radiusPx. */
  pick(world: World, camera: Camera, screen: Point, radiusPx = 16): string | null {
    let best: { d: number; callsign: string } | null = null;
    for (const a of world.allAircraft()) {
      const p = TrafficLayer.position(a);
      if (p === null) continue;
      const s = camera.toScreen(p.x, p.y);
      const d = Math.hypot(s.x - screen.x, s.y - screen.y);
      if (d <= radiusPx && (best === null || d < best.d)) best = { d, callsign: a.callsign };
    }
    return best?.callsign ?? null;
  }

  private create(callsign: string): Sprite {
    const symbol = new Graphics().poly(SHAPE).fill(0xffffff).stroke({ width: 0.02, color: 0x000000 });
    const leader = new Graphics();
    const tag = new Text({
      text: callsign,
      style: { fontFamily: FONT, fontSize: 11, fill: 0xe6edf3, lineHeight: 13 },
      resolution: Math.max(2, window.devicePixelRatio),
    });
    tag.anchor.set(0, 0);
    const request = new Text({
      text: '',
      style: { fontFamily: FONT, fontSize: 11, fill: COLORS.request, fontWeight: 'bold' },
      resolution: Math.max(2, window.devicePixelRatio),
    });
    this.world.addChild(symbol);
    const box = new Graphics();
    this.screen.addChild(leader, box, tag, request);
    const sprite = { symbol, tag, request, leader, box };
    this.sprites.set(callsign, sprite);
    return sprite;
  }
}
