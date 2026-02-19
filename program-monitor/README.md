# Program Monitor

A browser-only **Program + Monitor** UI for stacking URL-based media nodes into a timeline. Each node is a multiline textbox:

- **Line 1**: base video URL (duration source). Alternatively, prefix any line with `base:` to mark it as the base.
- **Lines 2+**: overlay videos/images/audio that loop and are clipped to the base duration

## Usage

1. Start the stack:
   ```sh
   docker-compose up -d --build
   ```
2. Open the Program Monitor UI:
   ```
   http://<HOST_IP>:8789/program-monitor/
   ```

## Controls

- **Add Node / Delete Node**: manage the timeline (single-node delete clears the node; long-press delete clears all).
- **Transport**: preview the timeline in sequence.
- **Save**: persists the active project timeline to render-api via same-origin `/api/projects*` routes.
- **Projects**: save/load named timelines from canonical `project.json` state in render-api workspace storage; loading hydrates both the project name input and node timeline.
- **Duration hints**: inferred durations are stored in node metadata for exports and do not rewrite the original node URL text.
- **Open Stage**: open a standalone timeline preview tab from the current nodes (uses the render-api stage cache to avoid oversized URLs).
- **Timeline Player**: `/program-monitor/timeline_player.html?id=...` plays the full timeline headlessly (for OBS browser sources). Legacy payloads only load via explicit `?import=1&debug=1`.
- **Export / Import JSON**: move timelines between machines.
- **Validate**: basic checks for missing base URLs and non-http(s) entries.
- **SHA256 registry media references**: base/layer lines can use `asset_id: sha256:<64hex>` (or bare `sha256:<64hex>`) and are resolved via media-sync-api at runtime. Optional fallback can be appended as `|https://legacy/path.mp4`.
- **Open Base**: open the active node base URL in a new tab.
- **Export Node/Timeline**: send jobs to the render-api service for MOV output.
- **Recents**: export history now surfaces `queued`, `rendering`, `encoding`, and `failed` states immediately so stalled/failed jobs are visible before final artifacts are ready.
- **OBS Control**: send the compiled timeline player URL to OBS `ASSET_MEDIA` via WebSocket (panel is collapsible). Auth works on LAN HTTP origins via a JS SHA-256 fallback.
- **PostMessage import**: append nodes by sending a `CDAPROD_PROGRAM_MONITOR_IMPORT` payload to the Program Monitor tab.
- **Image bases**: default to 5 seconds unless a duration override is provided.

### PostMessage import payload

Send a message shaped like:

```js
{
  type: "CDAPROD_PROGRAM_MONITOR_IMPORT",
  version: 1,
  messageId: "hand-off-123",
  nodes: [
    { lines: ["http://example.com/base.mp4"], durationOverride: "auto" }
  ]
}
```

### OBS Control

Use **Send Timeline → OBS** to push a single compiled player URL into the reusable `ASSET_MEDIA` browser source. Defaults assume:

- WebSocket URL: `ws://<HOST_IP>:4455`
- Scene: `ASSET_SCENE`
- Input: `ASSET_MEDIA`

Optionally enable **Take scene after send** to cut to the asset scene once the URL is updated.


### Projects index/source-of-truth path

Program Monitor reads the stage index from `/program-monitor/projects/_index.json` in nginx. In `docker-compose.yaml`, this folder is mounted as:

```yaml
- ${PROGRAM_MONITOR_PROJECTS_PATH:-./program-monitor/projects}:/usr/share/nginx/html/program-monitor/projects:rw
```

Set `PROGRAM_MONITOR_PROJECTS_PATH` in your shell or `.env` if your editable projects live somewhere else (for example, an SMB/shared path used by iOS Files/Textastic).

Examples:

```sh
# Windows host path
PROGRAM_MONITOR_PROJECTS_PATH=B:/Video/Projects/P7-SHARED-Procedurally-Generated/ingest/originals/workspace/projects
docker compose up -d --force-recreate
```

```sh
# Linux/WSL host path
PROGRAM_MONITOR_PROJECTS_PATH=/mnt/b/Video/Projects/P7-SHARED-Procedurally-Generated/ingest/originals/workspace/projects
docker compose up -d --force-recreate
```

Then verify nginx is serving the same file you are editing:

```sh
curl -i "http://127.0.0.1:8789/program-monitor/projects/_index.json"
```



### Media registry integration (sha256 identity)

Set the registry base URL for sha256-first media resolution:

```sh
export MEDIA_SYNC_REGISTRY_BASE_URL=http://192.168.0.25:8787
```

Example node lines:

```
asset_id: sha256:<64hex>
sha256:<64hex>|https://legacy.local/fallback.mp4
```

When present, Program Monitor resolves these identities through `POST /api/registry/resolve` (500ms timeout, no retries) and uses `urls.stream`. If the registry is unavailable, playback falls back to the provided legacy URL/path when available.

### OTIO export helper (artifact generation)

Convert a compiled RenderPlan JSON into an `.otio` timeline file:

```sh
node -e "const fs=require('node:fs'); const { exportToOtio }=require('./program-monitor/timeline/otio_export'); const plan=JSON.parse(fs.readFileSync('./render-plan.json','utf8')); console.log(exportToOtio(plan,{ outputPath:'./timeline.otio', name:'Program Monitor Export' }));"
```

The exporter only consumes fields on the provided RenderPlan object (`nodes`, layer roles, durations, and metadata), with Track 0 reserved for bases and additional tracks for overlays.

## Tests

Run the minimal utility tests:

```sh
node --test program-monitor/timeline-utils.test.mjs
```

Run the Program Monitor import listener tests:

```sh
node --test program-monitor/import_listener.test.mjs
```

Run the staged preview markup tests:

```sh
node --test program-monitor/staged-preview.test.mjs
```

Run the preview playback wiring tests:

```sh
node --test program-monitor/app-preview.test.mjs
```

Run the timeline core determinism + all-nodes mapping tests:

```sh
node --test program-monitor/timeline-core.test.mjs
```

Run the OTIO RenderPlan exporter tests:

```sh
node --test program-monitor/timeline/otio_export.test.mjs
```

Run media registry resolution tests:

```sh
node --test program-monitor/media-registry.test.mjs
```

Optional render-api tests (from repo root):

```sh
node --test render-api/server.test.js
```
