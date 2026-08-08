/**
 * The one place a Strava HTTP request is made. Every caller passes its own
 * `fetch` so tests never touch the network.
 */

import {
  StravaAuthError,
  StravaResponseError,
  rateLimitErrorFrom,
} from "./errors";

/** Injectable fetch. Matches the global signature so `globalThis.fetch` fits. */
export type FetchImpl = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export const STRAVA_API_BASE = "https://www.strava.com/api/v3";
export const STRAVA_OAUTH_BASE = "https://www.strava.com/oauth";

/**
 * Performs a request and maps Strava's error shapes onto typed errors.
 * 401 -> StravaAuthError, 429 -> StravaRateLimitError, anything else non-2xx
 * -> StravaResponseError.
 */
export async function stravaFetch<T>(
  url: string,
  init: RequestInit,
  fetchImpl: FetchImpl,
): Promise<T> {
  const res = await fetchImpl(url, init);
  const body = await readBody(res);

  if (res.status === 401) throw new StravaAuthError(messageOf(body), body);
  if (res.status === 429) throw rateLimitErrorFrom(res.headers, body);
  if (!res.ok) {
    throw new StravaResponseError(
      messageOf(body) ?? `Strava responded ${res.status}`,
      res.status,
      body,
    );
  }
  return body as T;
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function messageOf(body: unknown): string | undefined {
  if (body && typeof body === "object" && "message" in body) {
    const m = (body as { message?: unknown }).message;
    if (typeof m === "string" && m.length > 0) return m;
  }
  return undefined;
}
