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
- **Save**: persist to localStorage.
- **Projects**: save/load named timelines (stored in localStorage) with structured base/overlay/ambient metadata for reuse without the UI.
- **Open Stage**: open a standalone timeline preview tab from the current nodes.
- **Timeline Player**: `/program-monitor/timeline_player.html?data=...` plays the full timeline headlessly (for OBS browser sources).
- **Export / Import JSON**: move timelines between machines.
- **Validate**: basic checks for missing base URLs and non-http(s) entries.
- **Open Base**: open the active node base URL in a new tab.
- **Export Node/Timeline**: send jobs to the render-api service for MOV output.
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

Optional render-api tests (from repo root):

```sh
node --test render-api/server.test.js
```
