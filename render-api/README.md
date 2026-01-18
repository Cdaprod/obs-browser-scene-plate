# Render API Service

Small HTTP service that runs `render.js` to produce downloadable `.mov` files in `/renders`.

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

## Tests

```shell
node --test render-api/server.test.js render-api/render.test.js
```
