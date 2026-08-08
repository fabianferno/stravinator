/** Public surface of the Strava integration. */

export {
  StravaError,
  StravaAuthError,
  StravaRateLimitError,
  StravaResponseError,
  rateLimitErrorFrom,
  secondsUntilWindowReset,
  secondsUntilDailyReset,
} from "./errors";

export {
  STRAVA_API_BASE,
  STRAVA_OAUTH_BASE,
  stravaFetch,
  type FetchImpl,
} from "./http";

export {
  STRAVA_SCOPE,
  TOKEN_LIFETIME_SEC,
  buildAuthorizeUrl,
  exchangeCode,
  refreshToken,
  deauthorize,
  oauthConfigFromEnv,
  type StravaTokens,
  type StravaAthlete,
  type ExchangeResult,
  type OAuthConfig,
} from "./oauth";

export {
  REFRESH_SKEW_SEC,
  needsRefresh,
  ensureFreshToken,
  withFreshToken,
  hasRotatedTokens,
  type FreshTokens,
  type FreshTokenOptions,
  type WithFreshTokenResult,
  type RotatedTokenCarrier,
} from "./tokens";

export {
  STREAM_KEYS,
  listActivities,
  getActivity,
  getStreams,
  type StreamKey,
  type StravaActivity,
  type StravaStream,
  type StravaStreamSet,
  type ListActivitiesOptions,
} from "./client";

export { toRawTrack, toActivitySummary, zipLength } from "./normalize";

export {
  MIN_DISTANCE_M,
  MIN_TRACK_POINTS,
  checkEligibility,
  checkStreamEligibility,
  hasStartLocation,
} from "./eligibility";
