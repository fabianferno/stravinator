/**
 * Strava OAuth 2.0 authorization-code flow.
 *
 * Scope is fixed at `read,activity:read` — the athlete's own activities and
 * nothing else. Spec §2.1 forbids requesting anything that reaches another
 * athlete's data, so the scope is a module constant rather than a parameter:
 * there is no call site that is allowed to widen it.
 */

import { STRAVA_OAUTH_BASE, stravaFetch, type FetchImpl } from "./http";

/** Own public activities only. Never widen this. */
export const STRAVA_SCOPE = "read,activity:read";

/** Strava access tokens live 6 hours. */
export const TOKEN_LIFETIME_SEC = 6 * 60 * 60;

export interface StravaTokens {
  accessToken: string;
  /**
   * Strava ROTATES this on every refresh. Whatever comes back must be
   * persisted or the athlete is logged out at the next refresh.
   */
  refreshToken: string;
  /** Unix seconds (Strava's `expires_at`). */
  expiresAt: number;
  athleteId: string;
}

export interface StravaAthlete {
  id: number;
  username: string | null;
  firstname: string | null;
  lastname: string | null;
  profile: string | null;
}

export interface ExchangeResult {
  tokens: StravaTokens;
  /** Only the initial code exchange returns the athlete. */
  athlete: StravaAthlete | null;
}

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/**
 * Reads OAuth config from the environment. Throws loudly at call time rather
 * than producing a request that Strava will reject with a vague error.
 */
export function oauthConfigFromEnv(env: NodeJS.ProcessEnv = process.env): OAuthConfig {
  const clientId = env.STRAVA_CLIENT_ID;
  const clientSecret = env.STRAVA_CLIENT_SECRET;
  const redirectUri = env.STRAVA_REDIRECT_URI;
  const missing = [
    !clientId && "STRAVA_CLIENT_ID",
    !clientSecret && "STRAVA_CLIENT_SECRET",
    !redirectUri && "STRAVA_REDIRECT_URI",
  ].filter(Boolean);
  if (missing.length) {
    throw new Error(`Missing Strava OAuth env vars: ${missing.join(", ")}`);
  }
  return { clientId: clientId!, clientSecret: clientSecret!, redirectUri: redirectUri! };
}

/**
 * URL to send the athlete to. `state` is the caller's CSRF token — generate it
 * per-attempt, store it in a cookie, and compare on callback.
 *
 * `approval_prompt=auto` so a returning athlete is not re-prompted.
 */
export function buildAuthorizeUrl(
  state: string,
  config: OAuthConfig = oauthConfigFromEnv(),
): string {
  if (!state) throw new Error("buildAuthorizeUrl requires a state value");
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    approval_prompt: "auto",
    scope: STRAVA_SCOPE,
    state,
  });
  return `${STRAVA_OAUTH_BASE}/authorize?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  expires_in?: number;
  token_type?: string;
  athlete?: {
    id: number;
    username?: string | null;
    firstname?: string | null;
    lastname?: string | null;
    profile?: string | null;
  };
}

/** Trades the callback `code` for tokens. Returns the athlete too, once. */
export async function exchangeCode(
  code: string,
  fetchImpl: FetchImpl = fetch,
  config: OAuthConfig = oauthConfigFromEnv(),
): Promise<ExchangeResult> {
  const body = await postToken(
    {
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      grant_type: "authorization_code",
    },
    fetchImpl,
  );
  return {
    tokens: toTokens(body, body.athlete ? String(body.athlete.id) : ""),
    athlete: body.athlete
      ? {
          id: body.athlete.id,
          username: body.athlete.username ?? null,
          firstname: body.athlete.firstname ?? null,
          lastname: body.athlete.lastname ?? null,
          profile: body.athlete.profile ?? null,
        }
      : null,
  };
}

/**
 * Exchanges a refresh token for a fresh access token. The returned
 * `refreshToken` may differ from the one passed in — persist it.
 *
 * `athleteId` is carried through because the refresh response does not
 * include the athlete.
 */
export async function refreshToken(
  refreshTokenValue: string,
  fetchImpl: FetchImpl = fetch,
  config: OAuthConfig = oauthConfigFromEnv(),
  athleteId = "",
): Promise<StravaTokens> {
  const body = await postToken(
    {
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshTokenValue,
      grant_type: "refresh_token",
    },
    fetchImpl,
  );
  return toTokens(body, athleteId);
}

/** Revokes a token, ending the athlete's connection. */
export async function deauthorize(
  accessToken: string,
  fetchImpl: FetchImpl = fetch,
): Promise<void> {
  await stravaFetch<unknown>(
    `${STRAVA_OAUTH_BASE}/deauthorize`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    fetchImpl,
  );
}

async function postToken(
  fields: Record<string, string>,
  fetchImpl: FetchImpl,
): Promise<TokenResponse> {
  return stravaFetch<TokenResponse>(
    `${STRAVA_OAUTH_BASE}/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
    },
    fetchImpl,
  );
}

function toTokens(body: TokenResponse, athleteId: string): StravaTokens {
  if (!body?.access_token || !body?.refresh_token) {
    throw new Error("Strava token response missing access_token/refresh_token");
  }
  // Prefer the absolute `expires_at`; fall back to `expires_in`, then the
  // documented 6-hour lifetime.
  const expiresAt = Number.isFinite(body.expires_at)
    ? body.expires_at
    : Math.floor(Date.now() / 1000) + (body.expires_in ?? TOKEN_LIFETIME_SEC);
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt,
    athleteId,
  };
}
