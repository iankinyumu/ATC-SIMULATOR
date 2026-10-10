/** WGS84 position in decimal degrees (spec §35A). */
export interface LatLon {
  readonly lat: number;
  readonly lon: number;
}

/** Mean Earth radius in metres (IUGG). Accurate to well under 0.5% for haversine distances. */
const EARTH_RADIUS_M = 6_371_008.8;

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/** Great-circle distance in metres. */
export function distanceM(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial true bearing from a to b, in degrees [0, 360). */
export function trueBearingDeg(a: LatLon, b: LatLon): number {
  const φ1 = toRad(a.lat);
  const φ2 = toRad(b.lat);
  const Δλ = toRad(b.lon - a.lon);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Smallest absolute difference between two bearings, in degrees [0, 180]. */
export function bearingDifferenceDeg(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360) + 360) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Parses AIP-style DMS coordinates: latitude `DDMMSS.ssN`, longitude `DDDMMSS.ssW`.
 * Example: `512839.00N` → 51.4775, `0002905.97W` → -0.48499…
 */
export function parseDms(text: string): number {
  const m = /^(\d{2,3})(\d{2})(\d{2}(?:\.\d+)?)([NSEW])$/.exec(text.trim());
  if (m === null) throw new Error(`Not a DMS coordinate: "${text}"`);
  const [, d, min, s, hemi] = m;
  const isLat = hemi === 'N' || hemi === 'S';
  if (isLat !== (d!.length === 2)) throw new Error(`Wrong number of degree digits in "${text}"`);
  const value = Number(d) + Number(min) / 60 + Number(s) / 3600;
  return hemi === 'S' || hemi === 'W' ? -value : value;
}

/** Local east/north metres around a reference point. */
export interface LocalXY {
  readonly x: number;
  readonly y: number;
}

/**
 * Equirectangular projection around a reference point. Error is negligible over the few
 * kilometres of an aerodrome surface; not for use over radar ranges.
 */
export class LocalProjection {
  private readonly cosRef: number;

  constructor(readonly reference: LatLon) {
    this.cosRef = Math.cos(toRad(reference.lat));
  }

  toLocal(p: LatLon): LocalXY {
    return {
      x: toRad(p.lon - this.reference.lon) * this.cosRef * EARTH_RADIUS_M,
      y: toRad(p.lat - this.reference.lat) * EARTH_RADIUS_M,
    };
  }

  toLatLon(p: LocalXY): LatLon {
    return {
      lat: this.reference.lat + toDeg(p.y / EARTH_RADIUS_M),
      lon: this.reference.lon + toDeg(p.x / (EARTH_RADIUS_M * this.cosRef)),
    };
  }
}
