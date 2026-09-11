# Deploying Stravinator

Two deployables, one database.

| Piece | Where | Why |
|---|---|---|
| Next.js app | Vercel | Everything the athlete touches. Serverless is fine. |
| Render worker | Fly.io or Railway (container) | Headless Chromium + ffmpeg cannot run in a serverless function. |
| MongoDB 7 | Atlas (free tier is fine) | Job queue *and* app data. Both sides connect to it. |

The app and the worker never call each other directly except for one thing: the worker loads
`$APP_URL/render?job=<id>` in Chromium, authenticating with the `x-worker-token` header. Everything
else flows through the `jobs` table.

---

## Read this before you plan the topology

**Finished videos are served from the worker's local disk.** `publish()` in `worker/index.ts`
returns `/api/jobs/<id>/video`, and that route (`src/app/api/jobs/[id]/video/route.ts`) reads
`$WORK_DIR/out/<id>.mp4` off the filesystem. So **the app and the worker must share a filesystem**
until object storage replaces `publish()`.

In practice that means one of:

- **Run the app on the same host as the worker** (e.g. both processes in one Fly app / Railway
  service, sharing the mounted volume). This is the only configuration that works out of the box,
  and it means *not* using Vercel for the app yet.
- **Ship object storage first** — change `publish()` to upload the MP4 to S3/R2/Tigris and return a
  signed URL, and turn the video route into a redirect. Both are one-function changes and both are
  already commented as such in the source. After that, Vercel + a separate worker container works.

Deploying the app to Vercel and the worker to Fly *today*, with no shared disk, produces jobs that
reach `done` and then 404 on download. Don't.

---

## Environment variables

Every variable in `.env.example`, and who needs it.

| Variable | App | Worker | What it is |
|---|:--:|:--:|---|
| `STRAVA_CLIENT_ID` | ✅ | — | Strava API application ID. |
| `STRAVA_CLIENT_SECRET` | ✅ | — | Strava API secret. Secret. |
| `STRAVA_REDIRECT_URI` | ✅ | — | Must exactly match the callback registered in the Strava app settings, e.g. `https://your-domain/api/auth/strava/callback`. |
| `NEXT_PUBLIC_CESIUM_ION_TOKEN` | ✅ | ✅ | Cesium ion access token. Public by nature — scope it to the Stravinator asset set and restrict its allowed URLs in the ion dashboard. Without it `/render` draws placeholder wireframe terrain. The worker needs it too, since it renders the same page. |
| `MONGODB_URI` | ✅ | ✅ | MongoDB connection string. Put the database name in the path (`.../stravinator`); it defaults to `stravinator` otherwise. |
| `SESSION_SECRET` | ✅ | — | Signing key for the athlete session cookie. Generate with `openssl rand -hex 32`. Rotating it logs everyone out. |
| `WORKER_TOKEN` | ✅ | ✅ | **Shared secret — the value must be identical on both sides.** The worker sends it as `x-worker-token` when loading `/render`; the app rejects the request without it. Generate with `openssl rand -hex 32`. A mismatch shows up as every job failing during the `rendering` stage. |
| `APP_URL` | ✅ | ✅ | Public base URL of the app. The worker uses it to build the `/render` URL, so it must be reachable *from the worker container*. |

Worker-only knobs, not in `.env.example` (all optional):

| Variable | Default | What it is |
|---|---|---|
| `WORK_DIR` | `/data` in the image | Root for `tile-cache/` and `out/`. Must point at the persistent volume. The app reads `$WORK_DIR/out` too. |
| `WORKER_ID` | random `worker-xxxxxxxx` | Identifies the worker in queue leases and logs. Set it per instance when running more than one. |
| `MONGO_POOL_MAX` | 10 | MongoDB connection pool size. |

---

## Database and indexes

There is no schema to migrate — documents are created with the shape the code expects. The one
thing that must exist is the pair of indexes the claim query relies on. `pnpm migrate` creates
them and is idempotent; run it once against a new deployment:

```bash
MONGODB_URI='mongodb+srv://user:pass@cluster.mongodb.net/stravinator' pnpm migrate
```

# fly.toml
[deploy]
  release_command = "pnpm migrate"
```

---

## The app on Vercel

1. Import the repo. Framework preset: Next.js. Build `next build`, no overrides needed.
2. Set every app-column variable above in Project → Settings → Environment Variables.
3. Update `STRAVA_REDIRECT_URI` **and** the Strava app's registered callback to the production
   domain, and set `APP_URL` to the same origin.
4. Deploy, then run `pnpm migrate` against the production database (above).

Remember the shared-filesystem constraint: on Vercel, `/api/jobs/[id]/video` cannot see the worker's
disk. Vercel is only a real option once `publish()` uploads to object storage.

---

## The worker as a container

Build the image from `Dockerfile.worker` (Playwright's Chromium — the full build, not the headless
shell — plus ffmpeg, Node 22, entrypoint `pnpm worker`).

```bash
docker build -f Dockerfile.worker -t stravinator-worker .
```

Requirements wherever you run it:

- **A persistent volume mounted at `/data`.** Ion terrain and imagery tiles count against the account's streaming quota and the Chromium disk
  cache lives here; losing it on every restart costs real money. Finished MP4s live in `/data/out`.
- **Memory.** Chromium rendering 1080×1920 WebGL frames wants ~2 GB. 1 GB will OOM mid-render.
- **One instance to start.** The queue is safe under concurrency (atomic `findOneAndUpdate` claims, leases,
  heartbeats), so scaling out is fine — but each instance needs its own `WORKER_ID` and, while
  videos are local, its own disk becomes a problem the moment the app talks to the wrong instance.
- No inbound ports. The worker only makes outbound connections.

### Fly.io

```bash
fly launch --no-deploy --dockerfile Dockerfile.worker
fly volumes create stravinator_data --size 20   # GB
fly secrets set MONGODB_URI=... WORKER_TOKEN=... NEXT_PUBLIC_CESIUM_ION_TOKEN=... APP_URL=...
fly deploy
```

In `fly.toml`:

```toml
[build]
  dockerfile = "Dockerfile.worker"

[env]
  WORK_DIR = "/data"

[[mounts]]
  source      = "stravinator_data"
  destination = "/data"

[[vm]]
  memory = "2gb"
  cpus   = 2
```

Do not add an `[http_service]` block — there is nothing to serve, and Fly will otherwise stop the
machine for idleness while a render is in flight.

### Railway

- New service → Deploy from repo → set the Dockerfile path to `Dockerfile.worker`.
- Add a volume mounted at `/data`.
- Add the variables from the worker column, plus `WORK_DIR=/data`.
- No public networking; no healthcheck path.

---

## Local end-to-end

`docker-compose.yml` brings up MongoDB (host port **27017**, which is what the queue tests expect)
and the worker. Secrets come from your environment or a gitignored `.env`; none are baked into the
file.

```bash
cp .env.example .env && $EDITOR .env     # WORKER_TOKEN is required
docker compose up --build
pnpm dev                              # the app still runs on the host, :3000
```

The worker container reaches the host app through `host.docker.internal:3000`.

---

## Verifying a deploy

1. `pnpm migrate` reports the indexes ensured.
2. Worker logs show `[worker-xxxx] up. app=<APP_URL> work=/data`.
3. Connect Strava, submit a render, and watch the job walk
   `queued → fetching → smoothing → rendering → encoding → done`.
4. Download the MP4. If the job reaches `done` but the download 404s, the app cannot see
   `$WORK_DIR/out` — see the shared-filesystem constraint at the top.
5. A render that fails during `rendering` with an auth error is almost always a `WORKER_TOKEN`
   mismatch between the two deployments.

## CI

- `.github/workflows/ci.yml` — every push and PR: typecheck, lint, tests against a real MongoDB 7
  service container (the run fails if the queue integration tests skip), and `next build`.
- `.github/workflows/nightly.yml` — nightly end-to-end render, asserted with ffprobe to be H.264
  1080×1920 @ 30fps. There is no Cesium ion token in CI, so it renders **placeholder terrain**: it
  proves the capture and encode path, not the map. A green nightly is not verified terrain.
