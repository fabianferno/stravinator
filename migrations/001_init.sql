-- 001_init: athletes, jobs queue, invites.
-- Requires Postgres 13+ for the built-in gen_random_uuid().

CREATE TABLE IF NOT EXISTS athletes (
  -- Strava's numeric athlete id, kept as text so it never overflows a JS number.
  id             TEXT PRIMARY KEY,
  name           TEXT        NOT NULL,
  avatar_url     TEXT,
  access_token   TEXT        NOT NULL,
  -- Strava ROTATES the refresh token on every refresh: the new one must be persisted.
  refresh_token  TEXT        NOT NULL,
  token_expires_at TIMESTAMPTZ NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS jobs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id   TEXT NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  activity_id  TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'queued'
                 CHECK (status IN ('queued','fetching','smoothing','rendering','encoding','done','failed')),
  progress     DOUBLE PRECISION NOT NULL DEFAULT 0,
  frames_done  INTEGER NOT NULL DEFAULT 0,
  frame_count  INTEGER NOT NULL DEFAULT 0,
  error        TEXT,
  video_url    TEXT,

  -- queue bookkeeping
  attempts        INTEGER NOT NULL DEFAULT 0,
  worker_id       TEXT,
  lease_expires_at TIMESTAMPTZ,
  -- earliest time this job may be claimed; used for rate-limit backoff
  run_after       TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- pipeline artifacts, persisted with the job (spec §5.5)
  keyframes    JSONB,
  stats        JSONB,
  route        JSONB,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The claim query orders by created_at within claimable statuses.
CREATE INDEX IF NOT EXISTS jobs_status_created_at_idx ON jobs (status, created_at);
CREATE INDEX IF NOT EXISTS jobs_athlete_created_at_idx ON jobs (athlete_id, created_at DESC);

CREATE TABLE IF NOT EXISTS invites (
  code      TEXT PRIMARY KEY,
  used_by   TEXT REFERENCES athletes(id) ON DELETE SET NULL,
  used_at   TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invites_used_by_idx ON invites (used_by);
