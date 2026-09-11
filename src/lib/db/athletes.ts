import { athletes, type AthleteDoc } from "./client";

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
   * which needs it to refresh. Writes omit it — it is already the document key,
   * and accepting it there would invite the two disagreeing.
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

const toTokens = (d: AthleteDoc): AthleteTokens => ({
  accessToken: d.accessToken,
  refreshToken: d.refreshToken,
  expiresAt: Math.floor(d.tokenExpiresAt.getTime() / 1000),
  athleteId: d._id,
});

/**
 * @throws if the athlete is unknown — the worker cannot call Strava without
 * tokens, and a null here would only surface later as a confusing 401.
 */
export async function getAthleteTokens(athleteId: string): Promise<AthleteTokens> {
  const doc = await athletes().findOne({ _id: athleteId });
  if (!doc) throw new Error(`no athlete ${athleteId}: cannot load Strava tokens`);
  return toTokens(doc);
}

/**
 * Strava rotates the refresh token on every refresh, so all three fields are
 * written together — persisting only the access token would strand the athlete
 * at the next refresh.
 */
export async function saveAthleteTokens(athleteId: string, tokens: AthleteTokensInput): Promise<void> {
  const { matchedCount } = await athletes().updateOne(
    { _id: athleteId },
    {
      $set: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        tokenExpiresAt: new Date(tokens.expiresAt * 1000),
        updatedAt: new Date(),
      },
    },
  );
  if (matchedCount === 0) throw new Error(`no athlete ${athleteId}: cannot save Strava tokens`);
}

export async function upsertAthlete(a: {
  id: string;
  name: string;
  avatar: string | null;
  tokens: AthleteTokensInput;
}): Promise<void> {
  const now = new Date();
  await athletes().updateOne(
    { _id: a.id },
    {
      $set: {
        name: a.name,
        avatarUrl: a.avatar,
        accessToken: a.tokens.accessToken,
        refreshToken: a.tokens.refreshToken,
        tokenExpiresAt: new Date(a.tokens.expiresAt * 1000),
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true },
  );
}

export async function getAthlete(athleteId: string): Promise<AthleteRecord | null> {
  const d = await athletes().findOne({ _id: athleteId });
  return d ? { id: d._id, name: d.name, avatar: d.avatarUrl, tokens: toTokens(d) } : null;
}
