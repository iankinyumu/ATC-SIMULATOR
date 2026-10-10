/** FNV-1a 32-bit hash, used to derive independent random streams from labels. */
function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Seeded pseudo-random number generator (mulberry32).
 *
 * All randomness in the simulation must come from an Rng derived from the session seed (spec §35).
 * Each subsystem gets its own stream via `Rng.derive`, so adding randomness to one subsystem does
 * not change the results of another.
 */
export class Rng {
  private state: number;

  constructor(readonly seed: number) {
    this.state = seed >>> 0;
  }

  static derive(seed: number, label: string): Rng {
    return new Rng(Math.imul((seed >>> 0) ^ hashString(label), 0x9e3779b1) >>> 0);
  }

  nextUint32(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    return this.nextUint32() / 4294967296;
  }

  /** Uniform integer in [min, max]. */
  intInclusive(min: number, max: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
      throw new Error(`Invalid integer range [${min}, ${max}]`);
    }
    return min + Math.floor(this.next() * (max - min + 1));
  }
}
