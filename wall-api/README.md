# Wall API

A small FastAPI service that supplies wall stats to `plate-wall.html` without exposing API keys to the browser.

## Requirements

- Python 3.12+ (or Docker)

## Setup

1. Copy the example environment file and fill in your secrets:

   ```bash
   cp .env.example .env
   ```

2. Run with Docker:

   ```bash
   docker compose up --build wall_api
   ```

3. Load the plate:

   ```text
   http://<HOST_IP>:8789/plate-wall.html?dock=bottom&height=0.34&poll=5000&data=http://<HOST_IP>:8795/api/wall
   ```

## Local development

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8795
```

Example API call:

```bash
curl http://localhost:8795/api/wall
```

## Tests

```bash
python -m unittest discover -s tests
```

## Notes

- The service caches responses using `CACHE_TTL_SEC` to reduce rate limiting.
- If YouTube API keys are omitted, the service falls back to `yt-dlp` for metadata
  extraction. Configure `YOUTUBE_CHANNEL_URL` (defaults to
  `https://youtube.com/@cdaprod`) for the most reliable fallback target and
  `YTDLP_BIN` if the binary is not on the PATH.
- If GitHub API calls fail (rate limits, network), the service scrapes the public
  profile HTML to populate repos/followers/following/stars without keys.
