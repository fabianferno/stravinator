/**
 * Typed errors for the Strava client. Callers switch on `instanceof`, so every
 * error carries only what the caller can act on.
 */

export class StravaError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "StravaError";
    this.status = status;
    this.body = body;
  }
}

/**
 * 401 from Strava. The access token is dead and a refresh did not (or cannot)
 * fix it — the caller should prompt re-auth and preserve the intended activity.
 */
export class StravaAuthError extends StravaError {
  constructor(message = "Strava rejected the credentials", body: unknown = null) {
    super(message, 401, body);
    this.name = "StravaAuthError";
  }
}

/**
 * 429 from Strava. Strava's limits are APP-WIDE (100 req / 15 min and
 * 1000 / day by default), not per athlete, so backing off must be global —
 * dropping one user's request does not help if another user is the one burning
 * the quota.
 */
export class StravaRateLimitError extends StravaError {
  /** Seconds until the current 15-minute window rolls over. Always set. */
  readonly retryAfterSec: number;
  /** Absolute time the caller may retry at. */
  readonly retryAt: Date;
  /** `[shortTerm, daily]` limits from `X-RateLimit-Limit`, when present. */
  readonly limit: readonly [number, number] | null;
  /** `[shortTerm, daily]` usage from `X-RateLimit-Usage`, when present. */
  readonly usage: readonly [number, number] | null;
  /** True when the daily quota (not just the 15-minute window) is exhausted. */
  readonly daily: boolean;

  constructor(opts: {
    retryAfterSec: number;
    limit?: readonly [number, number] | null;
    usage?: readonly [number, number] | null;
    daily?: boolean;
    body?: unknown;
    now?: number;
  }) {
    super("Strava rate limit exceeded", 429, opts.body ?? null);
    this.name = "StravaRateLimitError";
    this.retryAfterSec = opts.retryAfterSec;
    this.retryAt = new Date((opts.now ?? Date.now()) + opts.retryAfterSec * 1000);
    this.limit = opts.limit ?? null;
    this.usage = opts.usage ?? null;
    this.daily = opts.daily ?? false;
  }
}

/** Strava returned a response we cannot parse or did not expect. */
export class StravaResponseError extends StravaError {
  constructor(message: string, status: number, body: unknown = null) {
    super(message, status, body);
    this.name = "StravaResponseError";
  }
}

const SHORT_WINDOW_SEC = 15 * 60;

function parsePair(header: string | null): readonly [number, number] | null {
  if (!header) return null;
  const parts = header.split(",").map((p) => Number(p.trim()));
  if (parts.length < 2 || parts.some((n) => !Number.isFinite(n))) return null;
  return [parts[0], parts[1]] as const;
}

/**
 * Seconds remaining in the current 15-minute window. Strava's windows are
 * aligned to the clock (:00, :15, :30, :45), so this is derivable without a
 * header — which matters because Strava does not always send `Retry-After`.
 */
export function secondsUntilWindowReset(now = Date.now()): number {
  const elapsed = Math.floor(now / 1000) % SHORT_WINDOW_SEC;
  return SHORT_WINDOW_SEC - elapsed;
}

/** Seconds until the next UTC midnight, when the daily quota resets. */
export function secondsUntilDailyReset(now = Date.now()): number {
  const d = new Date(now);
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  return Math.ceil((next - now) / 1000);
}

/** Builds a `StravaRateLimitError` from a 429 response's headers and body. */
export function rateLimitErrorFrom(
  headers: Headers,
  body: unknown,
  now = Date.now(),
): StravaRateLimitError {
  const limit = parsePair(headers.get("x-ratelimit-limit"));
  const usage = parsePair(headers.get("x-ratelimit-usage"));
  const daily = !!(limit && usage && usage[1] >= limit[1]);

  const retryAfterHeader = Number(headers.get("retry-after"));
  const retryAfterSec = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
    ? retryAfterHeader
    : daily
      ? secondsUntilDailyReset(now)
      : secondsUntilWindowReset(now);

  return new StravaRateLimitError({ retryAfterSec, limit, usage, daily, body, now });
}
