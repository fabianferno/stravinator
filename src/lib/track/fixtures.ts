import fs from "node:fs";
import path from "node:path";
import type { RawTrack } from "../types";

/**
 * Test-only fixture loader. It is the single place that touches the filesystem;
 * the smoothing engine itself is pure and does no I/O.
 */
const DIR = path.resolve(process.cwd(), "fixtures/tracks");

export function loadFixture(name: string): RawTrack {
  return JSON.parse(fs.readFileSync(path.join(DIR, `${name}.json`), "utf8")) as RawTrack;
}

/** Fixtures that represent a renderable route. */
export const RENDERABLE_FIXTURES = [
  "clean-loop",
  "out-and-back",
  "gps-dropout",
  "tunnel",
  "switchbacks",
  "altitude-spikes",
] as const;

/** Fixtures that must fail loudly. */
export const DEGENERATE_FIXTURES = ["single-point", "empty"] as const;
