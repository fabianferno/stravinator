/**
 * Token freshness. Strava access tokens live 6 hours and Strava ROTATES the
 * refresh token on every refresh, so every code path that might refresh has to
 * hand the new pair back to the caller for persistence. That is why nothing
 * here mutates in place and why `rotated` is an explicit flag rather than
 * something the caller has to infer by comparing strings.
 */

import { StravaAuthError } from "./errors";
import type { FetchImpl } from "./http";
import { refreshToken as refreshTokenRequest, type OAuthConfig, type StravaTokens } from "./oauth";

/**
 * Refresh this far before actual expiry. A token that expires mid-flight would
 * fail a request that has already cost us rate limit, and the render worker's
 * calls can sit queued for a while before they run.
 */
export const REFRESH_SKEW_SEC = 5 * 60;

export interface FreshTokenOptions {
  fetchImpl?: FetchImpl;
  config?: OAuthConfig;
  /** Override for tests. Milliseconds. */
  now?: number;
  /** Override the 5-minute skew. */
  skewSec?: number;
}

export interface FreshTokens {
  tokens: StravaTokens;
  /** True when `tokens` differs from what was passed in — PERSIST IT. */
  rotated: boolean;
}

export interface WithFreshTokenResult<T> extends FreshTokens {
  result: T;
}

/** True when the token is expired or will expire within the skew window. */
export function needsRefresh(
  tokens: Pick<StravaTokens, "expiresAt">,
  opts: Pick<FreshTokenOptions, "now" | "skewSec"> = {},
): boolean {
  const nowSec = Math.floor((opts.now ?? Date.now()) / 1000);
  const skew = opts.skewSec ?? REFRESH_SKEW_SEC;
  return tokens.expiresAt - nowSec <= skew;
}

/**
 * Returns tokens guaranteed fresh for at least the skew window, refreshing
 * only when needed. `rotated` tells the caller whether to write to the DB.
 */
export async function ensureFreshToken(
  tokens: StravaTokens,
  opts: FreshTokenOptions = {},
): Promise<FreshTokens> {
  if (!needsRefresh(tokens, opts)) return { tokens, rotated: false };

  const next = await refreshTokenRequest(
    tokens.refreshToken,
    opts.fetchImpl ?? fetch,
    opts.config,
    tokens.athleteId,
  );
  return { tokens: { ...next, athleteId: tokens.athleteId }, rotated: true };
}

/**
 * Runs `fn` with a guaranteed-fresh access token.
 *
 * Refreshes up front if the token is inside the skew window, and refreshes once
 * more on a 401 — Strava can invalidate a token early (athlete revokes the app,
 * password change), and one retry converts that into a working request instead
 * of a spurious re-auth prompt. A 401 after the retry is a real auth failure and
 * propagates.
 *
 * ALWAYS persist the returned `tokens` when `rotated` is true, including on the
 * error path: `withFreshTokenError` carries the rotated pair so a failed request
 * does not strand the athlete with a refresh token Strava has already burned.
 */
export async function withFreshToken<T>(
  tokens: StravaTokens,
  fn: (accessToken: string) => Promise<T>,
  opts: FreshTokenOptions = {},
): Promise<WithFreshTokenResult<T>> {
  let current = await ensureFreshToken(tokens, opts);

  try {
    return { ...current, result: await fn(current.tokens.accessToken) };
  } catch (err) {
    if (!(err instanceof StravaAuthError)) {
      throw current.rotated ? withRotatedTokens(err, current) : err;
    }
    try {
      current = await ensureFreshToken(current.tokens, { ...opts, skewSec: Infinity });
    } catch (refreshErr) {
      throw current.rotated ? withRotatedTokens(refreshErr, current) : refreshErr;
    }
    try {
      return { ...current, result: await fn(current.tokens.accessToken) };
    } catch (retryErr) {
      throw withRotatedTokens(retryErr, current);
    }
  }
}

/** An error thrown after tokens rotated. Persist `tokens` before re-auth. */
export interface RotatedTokenCarrier {
  rotatedTokens: StravaTokens;
}

/** Type guard for errors that carry a rotated token pair. */
export function hasRotatedTokens(err: unknown): err is Error & RotatedTokenCarrier {
  return (
    typeof err === "object" &&
    err !== null &&
    "rotatedTokens" in err &&
    (err as RotatedTokenCarrier).rotatedTokens != null
  );
}

function withRotatedTokens(err: unknown, fresh: FreshTokens): unknown {
  if (!fresh.rotated) return err;
  if (typeof err === "object" && err !== null) {
    (err as Partial<RotatedTokenCarrier>).rotatedTokens = fresh.tokens;
  }
  return err;
}
