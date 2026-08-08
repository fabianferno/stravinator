import { query } from "./pool";

/**
 * Structurally identical to `StravaTokens`, deliberately: these values are
 * handed straight to the Strava client and back, so a second shape would only
 * mean mapping between them at every call site.
 */
export interface AthleteTokens {
  accessToken: string;
  refreshToken: string;
  /** epoch seconds */
  expiresAt: number;
  /**
   * Present on read so the record can be handed straight to the Strava client,
   * which needs it to refresh. Writes omit it — it is already the row key, and
   * accepting it there would invite the two disagreeing.
   */
  athleteId: string;
}

/** What callers supply when persisting tokens. */
export type AthleteTokensInput = Omit<AthleteTokens, "athleteId">;

export interface AthleteRecord {
  id: string;
  name: string;
  avatar: string | null;
  tokens: AthleteTokens;
}

interface Row {
  id: string;
  name: string;
  avatar_url: string | null;
  access_token: string;
  refresh_token: string;
  token_expires_at: Date;
}

const toTokens = (r: Row): AthleteTokens => ({
  accessToken: r.access_token,
  refreshToken: r.refresh_token,
  expiresAt: Math.floor(r.token_expires_at.getTime() / 1000),
  athleteId: r.id,
});

/**
 * @throws if the athlete is unknown — the worker cannot call Strava without
 * tokens, and a null here would only surface later as a confusing 401.
 */
export async function getAthleteTokens(athleteId: string): Promise<AthleteTokens> {
  const { rows } = await query<Row>(
    "SELECT id, name, avatar_url, access_token, refresh_token, token_expires_at FROM athletes WHERE id = $1",
    [athleteId],
  );
  if (!rows[0]) throw new Error(`no athlete ${athleteId}: cannot load Strava tokens`);
  return toTokens(rows[0]);
}

/**
 * Strava rotates the refresh token on every refresh, so all three fields are
 * written together — persisting only the access token would strand the athlete
 * at the next refresh.
 */
export async function saveAthleteTokens(athleteId: string, tokens: AthleteTokensInput): Promise<void> {
  const { rowCount } = await query(
    `UPDATE athletes
        SET access_token = $2, refresh_token = $3,
            token_expires_at = to_timestamp($4), updated_at = now()
      WHERE id = $1`,
    [athleteId, tokens.accessToken, tokens.refreshToken, tokens.expiresAt],
  );
  if ((rowCount ?? 0) === 0) throw new Error(`no athlete ${athleteId}: cannot save Strava tokens`);
}

export async function upsertAthlete(a: {
  id: string;
  name: string;
  avatar: string | null;
  tokens: AthleteTokensInput;
}): Promise<void> {
  await query(
    `INSERT INTO athletes (id, name, avatar_url, access_token, refresh_token, token_expires_at)
     VALUES ($1, $2, $3, $4, $5, to_timestamp($6))
     ON CONFLICT (id) DO UPDATE
       SET name = EXCLUDED.name,
           avatar_url = EXCLUDED.avatar_url,
           access_token = EXCLUDED.access_token,
           refresh_token = EXCLUDED.refresh_token,
           token_expires_at = EXCLUDED.token_expires_at,
           updated_at = now()`,
    [a.id, a.name, a.avatar, a.tokens.accessToken, a.tokens.refreshToken, a.tokens.expiresAt],
  );
}

export async function getAthlete(athleteId: string): Promise<AthleteRecord | null> {
  const { rows } = await query<Row>(
    "SELECT id, name, avatar_url, access_token, refresh_token, token_expires_at FROM athletes WHERE id = $1",
    [athleteId],
  );
  const r = rows[0];
  return r ? { id: r.id, name: r.name, avatar: r.avatar_url, tokens: toTokens(r) } : null;
}
