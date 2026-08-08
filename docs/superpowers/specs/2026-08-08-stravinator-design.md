# Stravinator — Design Spec

**Date:** 2026-08-08
**Status:** Approved for planning

## 1. What it is

Stravinator turns a Strava activity into a cinematic 3D flyover video, ready to post to
Instagram Reels or Stories. The athlete connects Strava, picks one of their own activities,
and gets back a vertical MP4 of a camera flying the route over 3D terrain with a data HUD.

**Beta shape:** invite-only, hosted, multi-user, server-rendered. No payments, no quotas.

**Success criteria:** invited athletes render a run and post the result somewhere public.
Shares are the signal — not sign-ups, not render count.

## 2. Constraints and risks

### 2.1 Strava API terms and rate limits (go/no-go gate)

Default API access is 100 requests per 15 minutes and 1,000 per day **across the whole
application**, not per user. Each render costs roughly two calls (activity detail + streams),
which is adequate for an invite-only beta but caps growth without a rate-limit increase
request to Strava.

Strava's developer agreement additionally restricts derivative use of activity data and
requires "Powered by Strava" branding wherever their data is displayed.

**Decisions:**
- v1 renders **only the authenticated athlete's own activities**. No other-athlete data,
  ever. This is the defensible reading of the terms.
- The video outro card carries "Powered by Strava" branding.
- Read the current Strava API terms before implementation begins, not after.

### 2.2 Mapbox terms and cost

Exporting Mapbox-rendered frames to video is permitted but requires visible Mapbox and
OpenStreetMap attribution in the output. Terrain and satellite tiles bill per request, and a
headless render of a 30-second flyover pulls a meaningful tile load per video.

**Decisions:**
- Attribution is baked into the HUD, present on every frame.
- The render worker keeps an on-disk tile cache to avoid re-fetching tiles across renders and
  across frames within a render.

### 2.3 GPS noise is the product

Raw GPS tracks are noisy. Naive point-to-point bearing produces a jittery, unwatchable camera.
Smoothing is not a polish step — it is the core intellectual property and the thing that
separates "cinematic" from "amateur". The design isolates it accordingly (see §4.2).

## 3. Architecture

A Next.js app for everything user-facing, plus a separate long-running render worker. They
communicate through a Postgres-backed job queue.

```
Next.js (Vercel)                    Render worker (Fly.io / Railway, 1-2 containers)
├─ Strava OAuth (own data only)     ├─ claims job from queue
├─ Activity picker                  ├─ headless Chromium (Playwright)
├─ Job submit -> queue              ├─ loads /render?job=<id> (internal route)
└─ Job status poll -> download      ├─ Mapbox GL scene + HUD, frame-stepped
                                    ├─ ffmpeg -> MP4 (H.264, 1080x1920, 30fps)
                                    └─ uploads to object storage -> signed URL
```

**Why split:** headless Chromium and ffmpeg cannot run in a serverless function. The worker is
a plain container with local disk for the tile cache.

**Why Postgres for the queue:** `SELECT ... FOR UPDATE SKIP LOCKED` is sufficient at beta
scale. Introducing Redis buys nothing here.

**Key design choice:** the render scene is a single web page (`/render`) driven by a **frame
index**, not wall-clock time. Rendering is deterministic and reproducible — the same job
always produces the same frames. This also leaves the door open for a future in-browser
preview sharing the same scene code, though v1 does not build one.

## 4. Components

Five units, each with one purpose and a well-defined interface.

### 4.1 `strava/`

OAuth authorization code flow, token storage, refresh-on-expiry. Fetches activity detail and
the `latlng`, `altitude`, `time`, `distance`, and `velocity_smooth` streams.

- **Input:** athlete token, activity ID
- **Output:** raw track JSON (points + stats)
- **Depends on:** Strava HTTP API
- **Tested against:** recorded response fixtures, no network in tests

### 4.2 `track/` — the smoothing engine

Converts a noisy raw track into a cinematic camera path. **Pure function, no I/O, no
dependencies on the rest of the system.** This is the unit that will be rewritten repeatedly
as the output is tuned, so it must be trivially swappable and exhaustively unit-tested.

Stages:
1. Resample the route to a fixed **spatial** interval (not temporal — a runner slowing down
   should not slow the camera proportionally).
2. Fit a Catmull-Rom spline through the resampled points.
3. Smooth the altitude series independently (barometric/GPS altitude is noisier than position).
4. Compute per-frame bearing from the spline tangent, then apply a low-pass filter so the
   camera turns lazily rather than snapping.
5. Emit per-frame camera state: center, bearing, pitch, zoom, and the route-progress fraction.

- **Input:** raw track JSON, target frame count
- **Output:** array of N camera keyframes
- **Depends on:** nothing

### 4.3 `scene/`

The `/render` page. Given camera keyframes and activity stats, paints the Mapbox 3D terrain
scene, draws the route line progressively behind the moving camera, and overlays the HUD
(distance, pace, elevation, plus Strava/Mapbox/OSM attribution).

Exposes `window.seekToFrame(i)` and resolves only once tiles for that frame have settled, so
the capture layer can step deterministically without racing tile loads.

- **Input:** job ID (fetches keyframes + stats server-side)
- **Output:** a rendered DOM/canvas at a given frame
- **Depends on:** Mapbox GL JS

### 4.4 `capture/`

Playwright driver: opens `/render`, steps frame indices, screenshots each frame, pipes the
stream to ffmpeg. Knows nothing about running, maps, or Strava.

- **Input:** job ID, frame count, output path
- **Output:** MP4 file
- **Depends on:** Playwright, ffmpeg

### 4.5 `jobs/`

Queue claim/complete/fail, retry policy, status transitions, object storage upload, signed URL
issuance.

- **Status states:** `queued`, `fetching`, `smoothing`, `rendering`, `encoding`, `done`, `failed`
- These are real stages reported to the UI — the progress bar reflects actual work, not a timer.

## 5. Data flow

1. Athlete signs in with Strava (invite code required first).
2. App lists the athlete's recent activities.
3. Athlete picks one and confirms. A job row is created with status `queued`.
4. Worker claims the job, walks the pipeline, updating status at each stage.
5. `strava/` fetches the track. `track/` produces keyframes, persisted with the job.
6. `capture/` drives `scene/` frame by frame; ffmpeg encodes.
7. MP4 uploads to object storage; job goes `done` with a signed URL.
8. UI, polling status, swaps the progress view for a player with download and share.

## 6. Output format (v1: one preset, zero knobs)

- 1080x1920, 30fps, H.264 MP4
- Duration scales with route length, clamped to 20-40 seconds
- Fixed chase camera: behind and above, fixed pitch and follow distance
- HUD: distance, average pace, elevation gain, activity name and date
- Attribution: Strava, Mapbox, OpenStreetMap — visible on every frame
- Intro title card and outro card

## 7. Error handling

| Case | Handling |
|---|---|
| Activity has no GPS stream (treadmill, indoor) | Detected at pick time, before job creation. Activity is shown disabled with an inline reason. **Expect this to be the most common failure — indoor runs are frequent.** |
| Track too short to be watchable | Rejected at pick time with a minimum-distance message |
| Strava token expired | Silent refresh; on refresh failure, prompt re-auth and preserve the intended activity |
| Strava rate limit hit (429) | Job returns to `queued` with backoff; UI shows an honest "busy, retrying" state |
| Mapbox tiles fail for a frame | Retry that frame; after N attempts, fail the job rather than ship a video with holes |
| Render worker crashes mid-job | Job lease expires and is reclaimed; capped retries, then `failed` with a user-visible reason |
| Render exceeds time budget | Hard timeout, job `failed`, no partial video delivered |

## 8. Screens

**Mobile-first.** All screens are designed at 390 × 844 and scale up to desktop. The output is a
vertical video destined for a phone, and the athlete is most likely holding one when they use this.
Desktop is a widened version of the mobile layout, not a separate design.

1. **Landing / invite gate** — hero card showing the athlete's last flyover, invite-code entry,
   "Connect Strava"
2. **Activity list** — recent activities as rows; GPS-less ones visibly inert with the reason attached
3. **Activity detail / confirm** — route preview card, stats, "Create flyover", estimated wait
4. **Render in progress** — real staged progress (fetching / smoothing / rendering frames / encoding)
5. **Result** — video player, save, share, "make another"
6. **Error states** — no GPS data, render failed, session expired

### 8.1 Visual direction

Committed dark theme ("nocturnal"): OLED black ground, oversized gradient cards at 32px radius,
dot-matrix numerals for hero figures, light-weight geometric UI type, a single lime accent reserved
for primary actions.

| Token | Value | Role |
|---|---|---|
| `--ground` | `#050505` | page ground |
| `--raised` | `#0E0E11` | card surface |
| `--text` / `--text-mid` / `--text-dim` | `#FFFFFF` / `rgba(255,255,255,.62)` / `rgba(255,255,255,.42)` | type |
| `--grad-magenta` | `#EE4FA6 → #140512` | primary hero card |
| `--grad-blue` | `#4A5EDC → #10143C` | secondary card |
| `--grad-fire` | `#FF8A3D → #5C0D14` | recoverable failure only |
| `--lime` | `#C8F135` | primary action, active progress |

Semantic color stays separate from decoration: only the recoverable failure state uses the fire
gradient, so the color retains meaning.

Approved reference implementation of all six screens (static HTML, canvas-rendered dot-matrix
numerals): `docs/superpowers/design/stravinator-ui.html`.

## 9. Testing

- **`track/`** — the heavy test target. Unit tests over recorded real tracks (including
  deliberately terrible ones: tunnels, GPS dropouts, switchbacks, treadmill artifacts).
  Assertions on bearing continuity, absence of discontinuities, and monotonic progress.
- **`strava/`** — fixture-driven; no network in tests.
- **`capture/` + `scene/`** — one golden-frame integration test on a known track: render frame
  N, compare against a committed reference image within a perceptual tolerance.
- **`jobs/`** — queue semantics under concurrent workers: no double-claim, leases expire
  correctly, retries are capped.
- **End-to-end** — one full run from fixture activity to playable MP4, in CI, nightly.

## 10. Out of scope for v1

Editor controls, multiple camera presets, music, 16:9 or square output, other athletes'
activities, payments and quotas, mobile app, segment and split overlays, publishing back to
Strava.
