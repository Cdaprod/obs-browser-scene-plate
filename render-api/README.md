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

Project draft timelines (disk-backed):

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

Project drafts and exports are stored under the workspace directory (defaults to `/renders/workspace`).
Override with `WORKSPACE_DIR` if you need a different location.

Stage cache entries are stored under `${WORKSPACE_DIR}/stage` and survive restarts until TTL cleanup.

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
