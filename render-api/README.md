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

The response includes a `/renders/<file>.mov` path that Nginx can serve for download.

## Tests

```shell
node --test render-api/server.test.js
```
