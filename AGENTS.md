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

## URL Parameters as Interface
- The primary interface for plates/overlays is the URL itself.
- Preserve query parameters and hash fragments when generating or sharing URLs.
- Avoid dropping existing parameters when composing preview or copy URLs.

## UI/UX Expectations
- Ensure the UI is responsive on mobile and desktop, with no overflow in header, actions, or preview areas.
- Prefer flex wrapping and safe text overflow behaviors for long URLs.

## Testing Expectations
- Add minimal automated tests for logic changes when possible.
- Tests should be idempotent and safe to run repeatedly.
