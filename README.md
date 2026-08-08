# Stravinator

Turns a Strava activity into a cinematic 3D flyover video, ready to post to Instagram Reels or
Stories. Connect Strava, pick one of your own runs, get back a 1080×1920 MP4 of a camera flying the
route over 3D terrain with a data HUD.

Invite-only beta. One preset, zero knobs.

- **Spec:** `docs/superpowers/specs/2026-08-08-stravinator-design.md`
- **Plan:** `docs/superpowers/plans/2026-08-08-stravinator-build.md`
- **Approved design:** `docs/superpowers/design/stravinator-ui.html`

## How it fits together

A Next.js app handles everything the athlete touches. A separate long-running worker does the
rendering, because headless Chromium and ffmpeg cannot run in a serverless function. They
communicate through a Postgres job queue.

```
Next.js                          Worker
├─ Strava OAuth (own data only)  ├─ claims a job (FOR UPDATE SKIP LOCKED)
├─ Activity picker               ├─ fetches track, smooths it into a camera path
├─ Job submit → queue            ├─ steps /render frame by frame (Playwright)
└─ Status poll → download        └─ pipes PNGs to ffmpeg → MP4
```

| Module | Responsibility |
|---|---|
| `src/lib/track/` | The smoothing engine. Pure, zero I/O. Turns noisy GPS into a camera that doesn't jitter. This is the core IP. |
| `src/lib/strava/` | OAuth, token refresh, activity and stream fetch. Fixture-tested; no network in tests. |
| `src/lib/jobs/` | Queue: claim, lease, heartbeat, capped retries, status transitions. |
| `src/app/render/` | The scene the worker screenshots. Driven by frame index, never wall-clock, so renders are reproducible. |
| `worker/` | Frame-stepper and encoder. Knows nothing about running, maps, or Strava. |

## Running it

```bash
npm install
npx playwright install chromium
cp .env.example .env.local     # then fill it in

# Postgres (any instance works; this is the quickest)
docker run -d --name stravinator-pg -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=stravinator -p 55432:5432 postgres:16-alpine
DATABASE_URL=postgres://postgres:postgres@localhost:55432/stravinator npm run migrate

npm run dev      # app on :3000
npm run worker   # render worker, in a second terminal
```

`INVITE_CODES` is a comma-separated list; without it, nobody can sign in.

## Testing

```bash
npm test                                  # unit + queue integration
npx tsx worker/smoke.ts 60                # scene → ffmpeg, using the built-in fixture payload
npx tsx worker/smoke-job.ts 45            # the full path: Postgres job → API route → capture
```

The queue tests need Postgres and skip with a printed message if none is reachable. Both smoke
tests need a dev server running; `smoke-job.ts` additionally needs `DATABASE_URL` and a
`WORKER_TOKEN` matching the server's.

## Known gaps

- **No Mapbox token yet.** `/render` falls back to wireframe placeholder terrain behind a loud
  banner, and `captureVideo` refuses to encode it unless explicitly told to. Terrain, sky, and the
  real tile-settling timing are unverified until a token exists.
- **Strava fixtures are synthetic**, plausible but not recorded from a live account. Several API
  behaviours are assumed rather than observed — see the notes in `src/lib/strava/`.
- **Videos are served from the worker's local disk**, so the app and worker must share a filesystem.
  Moving to object storage means changing `publish()` in `worker/index.ts` and one route.
- The camera lags slightly through tight switchbacks, and GPS dropouts are bridged with a straight
  line. Both are documented in `src/lib/track/`.
