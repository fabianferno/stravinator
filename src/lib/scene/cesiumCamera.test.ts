import { describe, expect, it } from "vitest";
import { cameraRangeMetres, cesiumPitchRad, metresPerPixel, VERTICAL_FOV_RAD } from "./cesiumCamera";

describe("metresPerPixel", () => {
  it("matches the Web-Mercator scale table at the equator", () => {
    // 512px tiles: z0 spans the whole circumference across one tile.
    expect(metresPerPixel(0, 0)).toBeCloseTo(40_075_016.686 / 512, 3);
    expect(metresPerPixel(14.5, 0)).toBeCloseTo(3.3781, 3);
  });

  it("shrinks with the cosine of latitude", () => {
    expect(metresPerPixel(14.5, 60)).toBeCloseTo(metresPerPixel(14.5, 0) / 2, 6);
  });
});

describe("cameraRangeMetres", () => {
  it("places the centre at height/2 / tan(fov/2) pixels from the camera", () => {
    const px = 1920 / 2 / Math.tan(VERTICAL_FOV_RAD / 2);
    expect(cameraRangeMetres(14.5, 46, 1920)).toBeCloseTo(metresPerPixel(14.5, 46) * px, 6);
  });

  it("is about 7 km at the preset zoom in the Alps — a helicopter, not a satellite", () => {
    const r = cameraRangeMetres(14.5, 46, 1920);
    expect(r).toBeGreaterThan(6_000);
    expect(r).toBeLessThan(8_000);
  });

  it("halves per zoom level", () => {
    expect(cameraRangeMetres(15.5, 46, 1920)).toBeCloseTo(cameraRangeMetres(14.5, 46, 1920) / 2, 6);
  });
});

describe("cesiumPitchRad", () => {
  it("maps straight-down to -90° and the horizon to 0", () => {
    expect(cesiumPitchRad(0)).toBeCloseTo(-Math.PI / 2);
    expect(cesiumPitchRad(90)).toBeCloseTo(0);
  });
  it("maps the 65° chase preset to -25°", () => {
    expect(cesiumPitchRad(65)).toBeCloseTo((-25 * Math.PI) / 180);
  });
});
