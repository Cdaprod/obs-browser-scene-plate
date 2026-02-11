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
