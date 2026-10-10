export interface Point {
  x: number;
  y: number;
}

/** 2D view transform: screen = world × scale + offset. World units are metres (x east, y south). */
export class Camera {
  scale = 1;
  x = 0;
  y = 0;
  readonly minScale = 0.05;
  readonly maxScale = 40;

  constructor(private readonly onChange: () => void) {}

  toScreen(wx: number, wy: number): Point {
    return { x: wx * this.scale + this.x, y: wy * this.scale + this.y };
  }

  toWorld(sx: number, sy: number): Point {
    return { x: (sx - this.x) / this.scale, y: (sy - this.y) / this.scale };
  }

  fit(minX: number, minY: number, maxX: number, maxY: number, width: number, height: number, margin = 30): void {
    this.scale = Math.min((width - 2 * margin) / (maxX - minX), (height - 2 * margin) / (maxY - minY));
    this.x = width / 2 - ((minX + maxX) / 2) * this.scale;
    this.y = height / 2 - ((minY + maxY) / 2) * this.scale;
    this.onChange();
  }

  zoomAt(sx: number, sy: number, factor: number): void {
    const next = Math.min(this.maxScale, Math.max(this.minScale, this.scale * factor));
    const k = next / this.scale;
    this.x = sx - (sx - this.x) * k;
    this.y = sy - (sy - this.y) * k;
    this.scale = next;
    this.onChange();
  }

  panBy(dx: number, dy: number): void {
    this.x += dx;
    this.y += dy;
    this.onChange();
  }

  /** Mouse/touch handling: drag to pan, wheel to zoom. Short presses without movement are clicks. */
  attach(el: HTMLElement, handlers: { click(p: Point): void; hover(p: Point): void }): void {
    let drag: { x: number; y: number; moved: boolean; id: number } | null = null;
    const local = (e: PointerEvent | WheelEvent): Point => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const p = local(e);
        this.zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0015));
      },
      { passive: false },
    );
    el.addEventListener('pointerdown', (e) => {
      drag = { ...local(e), moved: false, id: e.pointerId };
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      const p = local(e);
      if (drag !== null && drag.id === e.pointerId) {
        const dx = p.x - drag.x;
        const dy = p.y - drag.y;
        if (drag.moved || Math.hypot(dx, dy) > 4) {
          drag.moved = true;
          drag.x = p.x;
          drag.y = p.y;
          this.panBy(dx, dy);
        }
      } else {
        handlers.hover(p);
      }
    });
    el.addEventListener('pointerup', (e) => {
      if (drag !== null && drag.id === e.pointerId && !drag.moved) handlers.click(local(e));
      drag = null;
    });
    el.addEventListener('pointercancel', () => {
      drag = null;
    });
  }
}
