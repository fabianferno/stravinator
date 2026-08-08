/**
 * Minimal geodesy. Everything downstream of `resample` works in a local
 * equirectangular metre frame anchored at the track's first point: over a
 * single activity (tens of km at most) the distortion is far below GPS noise,
 * and it lets the spline / bearing maths be plain 2D Euclidean.
 */

/** metres per degree of latitude (WGS84 mean) */
export const M_PER_DEG_LAT = 110574;
/** metres per degree of longitude at the equator */
export const M_PER_DEG_LNG_EQ = 111320;

export interface XY {
  x: number;
  y: number;
}

export interface Projector {
  toXY(lng: number, lat: number): XY;
  toLngLat(p: XY): { lng: number; lat: number };
}

/** Build a local metre projection anchored at (lng0, lat0). */
export function makeProjector(lng0: number, lat0: number): Projector {
  const kx = M_PER_DEG_LNG_EQ * Math.cos((lat0 * Math.PI) / 180);
  const ky = M_PER_DEG_LAT;
  // Guard the poles; kx -> 0 would make the inverse explode.
  const kxSafe = Math.abs(kx) < 1 ? (kx < 0 ? -1 : 1) : kx;
  return {
    toXY(lng, lat) {
      return { x: (lng - lng0) * kxSafe, y: (lat - lat0) * ky };
    },
    toLngLat(p) {
      return { lng: lng0 + p.x / kxSafe, lat: lat0 + p.y / ky };
    },
  };
}

/** Great-circle distance in metres. */
export function haversine(
  lng1: number,
  lat1: number,
  lng2: number,
  lat2: number,
): number {
  const R = 6371008.8;
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLng = (lng2 - lng1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Bearing in degrees clockwise from north for a displacement in the metre frame. */
export function bearingFromXY(dx: number, dy: number): number {
  const deg = (Math.atan2(dx, dy) * 180) / Math.PI;
  return normalizeBearing(deg);
}

/** Fold any angle into [0, 360). */
export function normalizeBearing(deg: number): number {
  const d = deg % 360;
  return d < 0 ? d + 360 : d;
}

export function isFiniteNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}
