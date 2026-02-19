# OBS Browser Scene Plate Agent Notes

## Scope
- This file applies to the entire repository unless overridden by a more specific `AGENTS.md`.

## Architecture & Services
- `site/` contains the browser-facing UI and plates/overlays.
- `render-api/` provides rendering services for exporting MOV assets.
- `nginx/` serves static assets and proxies render outputs.
- `render-api` now also exposes `GET /api/renders` for recent render listings (used by the UI).
- `wall-api/` provides local stats for `plate-wall.html` without exposing API keys to the browser.
- `wall-api/` supports a yt-dlp fallback for YouTube metadata when API keys are absent; configure `YOUTUBE_CHANNEL_URL` and `YTDLP_BIN` for reliability.
- `wall-api/` falls back to scraping GitHub profile HTML when API calls fail (rate limits, no keys).

## URL Parameters as Interface
- The primary interface for plates/overlays is the URL itself.
- Preserve query parameters and hash fragments when generating or sharing URLs.
- Avoid dropping existing parameters when composing preview or copy URLs.
- Overlay source files must include a single-line `Default URL (full params):` entry that matches the file name so the UI can preload query params.
- Procedural overlays that need deterministic renders should implement the render clock contract (`window.__SET_RENDER_TIME(ms)` and `window.__RENDER_READY`) so render-api can drive frame-locked capture.
- Render-api sets `window.__RENDER_CAPTURE=true` during headless export init scripts; overlays with delayed/autospin startup should gate wall-clock autoplay on this flag and rely on render-clock seeking in capture mode.
- Render exports should use a deterministic frame-stepped virtual time clock so headless captures match Program Monitor preview timing for HTML overlays.
- Program Monitor exports should keep inferred/measured duration authoritative (no implicit padding unless explicitly requested).
- `site/index.html` and `program-monitor/index.html` should remain independent front-end clients (separate local state keys/timers) while using the same render-api contracts.

## UI/UX Expectations
- Ensure the UI is responsive on mobile and desktop, with no overflow in header, actions, or preview areas.
- Prefer flex wrapping and safe text overflow behaviors for long URLs.
- Stage/timeline popup pages must remain vertically scrollable on small mobile viewports so transport and export controls are reachable.
- For iframe-heavy scenes (e.g. `lan_app_stack_scene.html`), gate animations until initial iframe loads finish and show a lightweight loading overlay to avoid dropped frames.
- Use `overlays/compression_artifact_glitch.html` for glitching analogue static; keep `analogue_static_loop.html` as the steady, non-burst static layer.

## Testing Expectations
- Add minimal automated tests for logic changes when possible.
- Tests should be idempotent and safe to run repeatedly.

## Latest Implementation Notes
- Program Monitor now supports sha256-first media references (`asset_id: sha256:<hash>` and `sha256:<hash>|<fallback>`), resolved against `MEDIA_SYNC_REGISTRY_BASE_URL` with a 500ms timeout and fallback-safe behavior.
- OTIO exports should preserve registry identity under `metadata["cdaprod.registry"]` when available so downstream consumers can re-resolve by SHA.

- Program Monitor save now verifies project persistence after transient 502 gateway responses before surfacing failure, reducing false-negative save errors.
- Program Monitor OTIO import now supports Timeline.1 ingestion into backward-compatible nodes plus clip metadata for round-trip workflows.

- Program Monitor now supports selected-assets timeline assembly (Sequence/Multicam) from media-sync payloads via Projects panel JSON paste or postMessage (`CDAPROD_PROGRAM_MONITOR_ASSET_SELECTION`).
- Project payloads now persist `assembly_spec` metadata and clip-derived nodes for reproducible asset-set timeline builds.

- Program Monitor now surfaces an explicit `Export OTIO JSON` action and derive-from-current-project assembly helper for legacy node upgrades.
- Projects index status messaging now prefers actionable fallback text for tiny/empty `_index.json` payloads and avoids misleading `0 projects` displays when discovered projects exist.

- Program Monitor now includes a `Repair Index` action that rebuilds project index state from discovered project files via render-api.
- Legacy node-only projects now auto-attempt derive on load, reporting `Derived clips: X/Y resolved` with a retry control.
