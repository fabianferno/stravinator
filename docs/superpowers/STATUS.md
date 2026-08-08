# Stravinator — project status

_Last updated: 2026-08-08_

## Where we are

**Built.** All six subsystems implemented, 186 tests passing, production build clean, and the
capture pipeline verified end to end: a real `/render` page stepped by real Playwright through real
ffmpeg produced a valid 1080×1920 / 30fps / H.264 MP4.

## Decisions locked

| Question | Decision |
|---|---|
| Product shape | Hosted web app, multi-user, **invite-only beta**, no quotas, no payments |
| Rendering | **Server-side render queue** (Playwright + ffmpeg on a worker container) |
| Output | **One preset, zero knobs** — 9:16 vertical, 1080×1920, chase camera, data HUD |
| Scope guard | Athlete can render **only their own activities** (Strava terms) |
| Platform | **Mobile-first**, 390×844, scaling up to desktop |
| Visual theme | **"Nocturnal"** — OLED black, gradient cards, dot-matrix numerals, lime accent |
| Stack | Next.js 16, React 19, plain CSS, `pg` + raw SQL migrations, Vitest |

## Artifacts

- **Spec:** `docs/superpowers/specs/2026-08-08-stravinator-design.md`
- **Plan:** `docs/superpowers/plans/2026-08-08-stravinator-build.md`
- **Approved UI, all 6 screens:** `docs/superpowers/design/stravinator-ui.html`
  Published: https://claude.ai/code/artifact/170058e6-3f45-4648-b7b5-043c53bc0f3c
- **Visual reference:** `docs/superpowers/design/reference.jpg`
- **Paper file (incomplete, superseded by the HTML):**
  https://app.paper.design/file/01KZFQ5RFBEN98YDMS960EWVG2

## Blocking before a real render

1. **Strava API terms — still unread.** Rate limit is 1,000 req/day app-wide and the developer
   agreement restricts derivative use. This remains a go/no-go gate, and the code is written but
   unvalidated against it.
2. **Strava app credentials.** OAuth is implemented against synthetic fixtures; nothing has ever
   talked to the live API.
3. **Mapbox token.** `/render` currently draws placeholder wireframe terrain. Unverified until a
   token exists: `mapbox-dem` + `setTerrain`, the satellite style, sky layer, whether the trail
   drapes correctly, and the real timing of the tile-settling gate — which is the piece most likely
   to need tuning under genuine tile fetches.
4. **Mapbox video-export terms + tile cost.** Attribution is already burned into every frame.

## Open items

- Email/notification path is implied by the render screen copy but not built.
- Empty state for an athlete with zero eligible activities is not designed.
- Videos are served from the worker's local disk; object storage is a one-function change.
- Camera lags through tight switchbacks; GPS dropouts bridge as straight lines. Both documented in
  `src/lib/track/` and worth revisiting once real footage exists.
- Port the design back into Paper when the weekly MCP limit resets (~2026-08-15).

## Verified

- 186 tests green, including queue semantics against a real Postgres (no double-claim under
  concurrent workers, lease expiry, heartbeat, capped retries, rate-limit requeue not burning an
  attempt).
- `next build` clean, 16 routes.
- `npx tsx worker/smoke.ts` produces a playable MP4 with the HUD, lime trail, and all three
  attribution strings burned into every frame.
