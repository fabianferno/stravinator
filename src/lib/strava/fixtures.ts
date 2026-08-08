/**
 * Test-only fixture loading and a scripted `fetch`. Lives in `src` rather than
 * a `__tests__` folder so several test files can share one definition of "what
 * Strava sends back".
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import type { FetchImpl } from "./http";

const FIXTURE_DIR = path.resolve(process.cwd(), "fixtures/strava");

export function loadFixture<T = unknown>(name: string): T {
  return JSON.parse(readFileSync(path.join(FIXTURE_DIR, `${name}.json`), "utf8")) as T;
}

export interface ScriptedResponse {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface RecordedCall {
  url: string;
  init: RequestInit | undefined;
  method: string;
  /** Parsed form body for token posts. */
  form: Record<string, string> | null;
}

export interface FakeFetch {
  fetch: FetchImpl;
  calls: RecordedCall[];
}

/**
 * Returns a `fetch` that replays the given responses in order and records
 * every call. Running past the end of the script is an error, which is how the
 * "no streams call for a treadmill activity" test proves a negative.
 */
export function fakeFetch(...responses: ScriptedResponse[]): FakeFetch {
  const calls: RecordedCall[] = [];
  let i = 0;

  const impl: FetchImpl = async (url, init) => {
    const body = typeof init?.body === "string" ? init.body : null;
    calls.push({
      url,
      init,
      method: (init?.method ?? "GET").toUpperCase(),
      form: body && !body.trimStart().startsWith("{")
        ? Object.fromEntries(new URLSearchParams(body))
        : null,
    });

    const spec = responses[i++];
    if (!spec) throw new Error(`Unexpected extra fetch call: ${url}`);

    const status = spec.status ?? 200;
    return new Response(spec.body == null ? "" : JSON.stringify(spec.body), {
      status,
      headers: { "content-type": "application/json", ...(spec.headers ?? {}) },
    });
  };

  return { fetch: impl, calls };
}

export const TEST_OAUTH_CONFIG = {
  clientId: "12345",
  clientSecret: "shh-test-secret",
  redirectUri: "https://stravinator.test/api/strava/callback",
};
