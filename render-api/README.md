# Render API Service

Small HTTP service that runs `render.js` to produce downloadable `.mov` files in `/renders`
and project exports under `/exports/<project>/<job>/...`.

## Usage

```shell
# Build + run alongside obs_plate
# (from repo root)
docker compose up -d --build render_api
```

Health check:

```shell
curl http://localhost:8791/api/health
```

Render a clip:

```shell
curl -X POST http://localhost:8791/api/render \
  -H "Content-Type: application/json" \
  -d '{"url":"http://nginx/plate-default.html","name":"plate","seconds":4,"fps":60,"width":1080,"height":1920}'
```

Program Monitor exports (node + timeline):

```shell
curl -X POST http://localhost:8791/api/program-monitor/export-node \
  -H "Content-Type: application/json" \
  -d '{"node":{"text":"http://nginx/plate-default.html"},"options":{"fps":60,"width":1080,"height":1920}}'

curl -X POST http://localhost:8791/api/program-monitor/export-timeline \
  -H "Content-Type: application/json" \
  -d '{"timeline":{"version":1,"nodes":[{"text":"http://nginx/plate-default.html"}]}}'
```

Program Monitor stage cache (short URLs for stage + timeline player):

```shell
curl -X POST http://localhost:8791/api/program-monitor/stage \
  -H "Content-Type: application/json" \
  -d '{"timeline":{"version":1,"nodes":[{"text":"http://nginx/plate-default.html"}]},"name":"Show Open"}'

curl http://localhost:8791/api/program-monitor/stage/<stage_id>
```

Project state APIs (canonical editor persistence):

```shell
# list projects
curl http://localhost:8791/api/projects

# resolve a project id from a human name (creates if missing)
curl -X POST http://localhost:8791/api/projects:resolve \
  -H "Content-Type: application/json" \
  -d '{"name":"Typewriter-1"}'

# fetch canonical project state
curl http://localhost:8791/api/projects/typewriter-1

# upsert canonical project state (timeline + nodesStructured)
curl -X PUT http://localhost:8791/api/projects/typewriter-1 \
  -H "Content-Type: application/json" \
  -d '{"name":"Typewriter-1","payload":{"timeline":{"version":1,"activeIndex":0,"nodes":[{"text":"http://nginx/plate-default.html"}],"nodesStructured":[]}}}'
```

Legacy draft timeline endpoint (still supported for compatibility):

```shell
curl http://localhost:8791/api/projects/demo/timeline

curl -X PUT http://localhost:8791/api/projects/demo/timeline \
  -H "Content-Type: application/json" \
  -d '{"version":1,"nodes":[{"text":"http://nginx/plate-default.html"}],"activeIndex":0}'
```

Project exports:

```shell
curl -X POST http://localhost:8791/api/exports \
  -H "Content-Type: application/json" \
  -d '{"project_id":"demo","stage_id":"<stage_id>","format":"mov"}'

curl http://localhost:8791/api/exports/<job_id>

curl http://localhost:8791/api/projects/demo/exports

# Download artifacts
curl http://localhost:8791/exports/demo/<job_id>/render.mov
curl http://localhost:8791/exports/demo/<job_id>/manifest.json
curl http://localhost:8791/exports/demo/<job_id>/render.log
```

If you send a `localhost` URL (or a relative path like `/overlays/...`), the API rewrites
it to the render origin so the container can resolve it. Configure the origin via
`RENDER_ORIGIN` (defaults to `http://obs_plate`):

```shell
RENDER_ORIGIN=http://obs_plate docker compose up -d --build render_api
```

If Program Monitor generates URLs using a LAN origin, you can set `PUBLIC_ORIGIN` to
rewrite those links for headless rendering:

```shell
PUBLIC_ORIGIN=http://192.168.0.25:8789
```

The response includes a job ID and status URL:

```json
{"ok":true,"job_id":"...","status_url":"/api/render/<job_id>"}
```

Check job status:

```shell
curl http://localhost:8791/api/render/<job_id>
```

When ready, the response includes a `/renders/<file>.mov` path that Nginx can serve for download.
Project exports include job-scoped paths like `/exports/<project>/<job>/render.mov` plus a
`render_preview.mp4` for web playback.

Encoding behavior:
- `render.mov` is encoded as ProRes 4444 (`prores_ks`, `yuva444p10le`) so alpha is preserved for compositing workflows.
- `render_preview.mp4` is encoded as H.264 (`yuv420p`) with explicit black-background compositing.

Project drafts and exports are stored under the workspace directory (defaults to `/renders/workspace`).
Render capture uses a deterministic frame-stepped render clock. It first attempts CDP virtual time, and when unavailable it falls back to deterministic per-frame seek (`document.getAnimations()` + render clock hooks).

Set `RENDER_REQUIRE_DETERMINISTIC_TIME=1` to fail jobs when deterministic timing cannot be established.
Manifest and job status payloads include timing diagnostics (`timing_mode`, `timing_degraded`, `timing_animations`, `timing_hooks`).

Program Monitor exports default `padSeconds` to `0` so UI-measured node durations are rendered as-is unless an explicit pad is provided.

Override with `WORKSPACE_DIR` if you need a different location.

Stage cache entries are stored under `${WORKSPACE_DIR}/stage` and survive restarts until TTL cleanup.

Cache and memory hygiene defaults for export UI backends:
- `PROGRAM_MONITOR_TMP_TTL_MS` (default `1800000`) prunes stale Program Monitor temp html/list files.
- `PROGRAM_MONITOR_CACHE_TTL_MS` (default `21600000`) bounds Program Monitor node/timeline cache age.
- `PROGRAM_MONITOR_CACHE_MAX_FILES` (default `120`) caps retained Program Monitor node/timeline cached files per directory.
- `JOB_RETENTION_MS` (default `3600000`) trims completed in-memory job/status entries and stale job json files.
- `JOB_MEMORY_LIMIT` (default `400`) limits retained in-memory jobs after pruning.

## Delivery to /renders

Exports are written to the workspace and (by default) delivered into the renders mount at:
`/renders/${DELIVERY_SUBDIR}/<project>/exports/<job>/...`.

Configure delivery behavior:

```shell
# Disable delivery
DELIVER_EXPORTS=0

# Override delivery subdir (defaults to _exports)
DELIVERY_SUBDIR=_exports
```

Debug the /renders mount:

```shell
curl http://localhost:8791/api/debug/renders

curl -X POST http://localhost:8791/api/debug/renders/touch \
  -H "Content-Type: application/json" \
  -d '{"relpath":"probe.txt","content":"hello"}'
```

## Tests

```shell
node --test render-api/server.test.js render-api/render.test.js
```
