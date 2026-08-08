# Stravinator Implementation Plan

> **For agentic workers:** implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Turn a Strava activity into a 1080×1920 cinematic 3D flyover MP4.

**Architecture:** Next.js App Router app (auth, activity picker, job submit, status, result) plus a
long-running worker process that claims jobs from a Postgres queue, drives a headless Chromium
`/render` page frame-by-frame with Playwright, and encodes with ffmpeg.

**Tech Stack:** Next.js 15 (App Router, TS, `src/`), plain CSS (no Tailwind), Vitest, `pg` +
raw SQL migrations, Mapbox GL JS, Playwright, ffmpeg.

## Global Constraints

- **Node 22.** TypeScript strict. ESM.
- **No Tailwind.** All styling is plain CSS driven by the token set in
  `docs/superpowers/specs/2026-08-08-stravinator-design.md` §8.1. The approved reference
  implementation of all six screens is `docs/superpowers/design/stravinator-ui.html` — treat its
  markup, CSS, and the canvas dot-matrix numeral renderer as the source of truth.
- **Mobile-first, 390×844**, scaling up to desktop.
- **Own activities only.** Never fetch another athlete's data.
- Output is fixed: 1080×1920, 30fps, H.264, duration clamped 20–40s.
- Attribution strings, verbatim, visible on every rendered frame:
  `Powered by Strava` · `© Mapbox` · `© OpenStreetMap`
- Tests never hit the network. Strava responses come from fixtures.
- Path alias `@/*` → `src/*`.

## File structure

| Path | Responsibility |
|---|---|
| `src/lib/track/` | Smoothing engine. Pure functions, zero I/O. The core IP. |
| `src/lib/strava/` | OAuth, token refresh, activity + stream fetch. Fixture-tested. |
| `src/lib/jobs/` | Postgres queue: claim/complete/fail, leases, retries, status. |
| `src/lib/db/` | Pool + migration runner. |
| `src/app/render/` | The `/render` scene page. Mapbox + route line + HUD. `window.seekToFrame`. |
| `src/app/(app)/` | Screens 01–06. |
| `src/styles/` | Token + component CSS lifted from the approved mockup. |
| `worker/` | Worker loop, Playwright capture driver, ffmpeg encoder. |
| `fixtures/` | Recorded Strava responses + reference tracks. |

---

### Task 1 — `track/` smoothing engine

Pure, dependency-free. `buildCameraPath(track, frameCount) => CameraKeyframe[]`.
Stages: spatial resample → Catmull-Rom spline → independent altitude smoothing → tangent bearing →
low-pass bearing filter → emit keyframes.
Tests assert bearing continuity (no frame-to-frame jump > threshold, correct 359°→1° wrapping),
monotonic progress, exact output length, and survival of dropouts/tunnels/switchbacks.

### Task 2 — `strava/` client

OAuth authorization-code flow, refresh-on-expiry, `getActivity`, `getStreams`, normalize into
`RawTrack`. Eligibility check (`hasGps`, minimum distance) used by the picker to disable rows.
Fixture-driven tests, no network.

### Task 3 — Design system + screens 01–06

Port `stravinator-ui.html` into React components and CSS. Static/mock data at this stage.

### Task 4 — `db/` + `jobs/` queue

Migrations, `SELECT … FOR UPDATE SKIP LOCKED` claim with lease expiry, capped retries, status
transitions `queued → fetching → smoothing → rendering → encoding → done | failed`.
Tests run against a real Postgres and assert no double-claim under concurrent workers.

### Task 5 — `scene/` render page

Mapbox 3D terrain, progressive route line, HUD, intro/outro cards. `window.seekToFrame(i)` resolves
only after tiles settle. Deterministic: frame index only, never wall-clock.

### Task 6 — `capture/` + worker

Playwright frame-stepper piping PNGs to ffmpeg. Worker loop claiming jobs and walking the pipeline.
On-disk tile cache.

### Task 7 — Wire-up

Screens onto real OAuth, real activity list, real job submit and status polling, signed download URL.
