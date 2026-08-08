# Stravinator — project status

_Last updated: 2026-08-08_

## Where we are

Design phase complete and approved. **No application code written yet.** Next step is the
implementation plan (`superpowers:writing-plans`), then build.

## Decisions locked

| Question | Decision |
|---|---|
| Product shape | Hosted web app, multi-user, **invite-only beta**, no quotas, no payments |
| Rendering | **Server-side headless render queue** (Playwright + ffmpeg on a worker container) |
| Output | **One preset, zero knobs** — 9:16 vertical, 1080×1920, chase camera, data HUD |
| Scope guard | Athlete can render **only their own activities** (Strava terms) |
| Platform | **Mobile-first**, 390×844, scaling up to desktop |
| Visual theme | **"Nocturnal"** — OLED black, gradient cards, dot-matrix numerals, lime accent |

## Artifacts

- **Spec (approved):** `docs/superpowers/specs/2026-08-08-stravinator-design.md`
- **Approved UI, all 6 screens:** `docs/superpowers/design/stravinator-ui.html`
  (open in a browser; canvas-rendered dot-matrix numerals)
  Published: https://claude.ai/code/artifact/170058e6-3f45-4648-b7b5-043c53bc0f3c
- **Visual reference the theme derives from:** `docs/superpowers/design/reference.jpg`
- **Paper file (INCOMPLETE — see below):** https://app.paper.design/file/01KZFQ5RFBEN98YDMS960EWVG2

## Open items

1. **Paper file is incomplete.** Weekly MCP limit hit on 2026-08-08, resets ~2026-08-15. Tokens are
   updated to the nocturnal theme and `01 Landing` is partially built; screens 02–06 were deleted
   during the theme change and not rebuilt. The HTML file above is the source of truth for the
   design, not Paper.
2. **Strava API terms must be read before implementation.** Rate limit is 1,000 req/day across the
   whole app, and the developer agreement restricts derivative use of activity data. This is a
   go/no-go gate, not a formality.
3. **Mapbox video-export terms + tile cost** need confirming; attribution is already baked into the
   HUD design.
4. **Email/notification path is implied but unscoped.** The render screen says "we'll notify you
   when it's ready" — either build that or change the copy.
5. **Not yet designed:** empty state for an athlete with zero eligible activities.

## Build order (proposed, not yet approved)

The spec spans several subsystems and needs decomposing into sequential plans:

1. App foundation + Strava OAuth + activity list (screens 01–02 on real data)
2. `track/` smoothing engine — pure functions, the core IP, heaviest test target
3. `scene/` + `capture/` — Mapbox scene driven by frame index, Playwright + ffmpeg
4. `jobs/` queue + worker container, then screens 03–05 wired to real jobs

**Risk note:** steps 2–3 carry the real technical risk (cinematic camera quality, render cost).
Worth a throwaway spike on Mapbox render quality before committing to the full build.
