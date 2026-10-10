import { Container, Text } from 'pixi.js';
import type { Camera } from './camera';
import { FONT } from './style';

export type LabelClass = 'runway' | 'taxiway' | 'hold' | 'stand';

interface Label {
  readonly text: Text;
  readonly wx: number;
  readonly wy: number;
  readonly cls: LabelClass;
  readonly minScale: number;
  /** Screen offset from the anchor, in px. */
  readonly dx: number;
  readonly dy: number;
}

/**
 * Screen-space labels that stay the same size at every zoom. Labels are placed in priority
 * order (the order they were added) and any label that would overlap one already placed is hidden.
 */
export class LabelLayer {
  readonly container = new Container();
  private readonly labels: Label[] = [];
  private readonly enabled: Record<LabelClass, boolean> = { runway: true, taxiway: true, hold: true, stand: true };

  add(cls: LabelClass, text: string, wx: number, wy: number, opts: { color: number; size: number; bold?: boolean; minScale: number; dx?: number; dy?: number }): Text {
    const t = new Text({
      text,
      style: { fontFamily: FONT, fontSize: opts.size, fill: opts.color, fontWeight: opts.bold ? 'bold' : 'normal' },
      resolution: Math.max(2, window.devicePixelRatio),
    });
    t.anchor.set(0.5);
    t.visible = false;
    this.container.addChild(t);
    this.labels.push({ text: t, wx, wy, cls, minScale: opts.minScale, dx: opts.dx ?? 0, dy: opts.dy ?? 0 });
    return t;
  }

  setEnabled(cls: LabelClass, on: boolean): void {
    this.enabled[cls] = on;
  }

  update(camera: Camera, width: number, height: number): void {
    const cell = 48;
    const grid = new Map<string, Array<{ x0: number; y0: number; x1: number; y1: number }>>();
    const overlaps = (b: { x0: number; y0: number; x1: number; y1: number }) => {
      for (let cx = Math.floor(b.x0 / cell); cx <= Math.floor(b.x1 / cell); cx++) {
        for (let cy = Math.floor(b.y0 / cell); cy <= Math.floor(b.y1 / cell); cy++) {
          for (const o of grid.get(`${cx},${cy}`) ?? []) {
            if (b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0) return true;
          }
        }
      }
      return false;
    };
    const insert = (b: { x0: number; y0: number; x1: number; y1: number }) => {
      for (let cx = Math.floor(b.x0 / cell); cx <= Math.floor(b.x1 / cell); cx++) {
        for (let cy = Math.floor(b.y0 / cell); cy <= Math.floor(b.y1 / cell); cy++) {
          const key = `${cx},${cy}`;
          grid.set(key, [...(grid.get(key) ?? []), b]);
        }
      }
    };

    for (const l of this.labels) {
      const t = l.text;
      t.visible = false;
      if (!this.enabled[l.cls] || camera.scale < l.minScale) continue;
      const p = camera.toScreen(l.wx, l.wy);
      const x = p.x + l.dx;
      const y = p.y + l.dy;
      if (x < -50 || y < -50 || x > width + 50 || y > height + 50) continue;
      const pad = 2;
      const box = { x0: x - t.width / 2 - pad, y0: y - t.height / 2 - pad, x1: x + t.width / 2 + pad, y1: y + t.height / 2 + pad };
      if (overlaps(box)) continue;
      insert(box);
      t.position.set(Math.round(x), Math.round(y));
      t.visible = true;
    }
  }
}
