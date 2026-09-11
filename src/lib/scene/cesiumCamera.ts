/**
 * Pure camera maths for the Cesium engine.
 *
 * `track/` emits Web-Mercator style keyframes (centre, bearing, pitch-from-
 * vertical, zoom). Cesium wants a camera in metres: a target point plus
 * heading / pitch-below-horizon / range. This module is the bridge, kept free
 * of Cesium imports so the numbers can be unit-tested.
 */

/** Required by ion's terms for World Terrain + Bing imagery; burned into the HUD. */
export const CESIUM_ATTRIBUTION = ["© Cesium ion", "© Microsoft Bing", "© Maxar"] as const;

/** Equatorial circumference of the WGS84 ellipsoid, metres. */
const EARTH_CIRCUMFERENCE_M = 40_075_016.686;
/** Web-Mercator tile size the zoom level is defined against. */
const TILE_SIZE_PX = 512;
/**
 * Vertical field of view, radians. This is the value Mapbox GL and MapLibre
 * use, so a given (zoom, pitch) frames the same ground span here as it did in
 * the engines the keyframes were tuned on.
 */
export const VERTICAL_FOV_RAD = 0.6435011087932844;

/** Ground metres per screen pixel at the view centre for a given zoom. */
export function metresPerPixel(zoom: number, latDeg: number): number {
  const lat = (latDeg * Math.PI) / 180;
  return (EARTH_CIRCUMFERENCE_M * Math.cos(lat)) / (TILE_SIZE_PX * Math.pow(2, zoom));
}

/**
 * Distance from the camera to the point it looks at, in metres, such that the
 * ground scale at that point matches `zoom` in a viewport `heightPx` tall.
 * Mercator engines define zoom as the scale at the centre of the screen, and
 * the centre sits `heightPx/2 / tan(fov/2)` pixels in front of the camera.
 */
export function cameraRangeMetres(zoom: number, latDeg: number, heightPx: number): number {
  return metresPerPixel(zoom, latDeg) * (heightPx / 2) / Math.tan(VERTICAL_FOV_RAD / 2);
}

/**
 * Convert a pitch measured from the vertical (0 = straight down, the Mapbox
 * convention) into Cesium's pitch, measured from the horizon and negative when
 * looking down.
 */
export function cesiumPitchRad(pitchFromVerticalDeg: number): number {
  return -((90 - pitchFromVerticalDeg) * Math.PI) / 180;
}
