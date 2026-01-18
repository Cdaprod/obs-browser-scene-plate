"""Wall stats API for OBS plate overlays.

Usage:
  uvicorn app.main:app --host 0.0.0.0 --port 8795

Example:
  curl http://localhost:8795/api/wall
"""
from __future__ import annotations

import json
import logging
import os
import subprocess
import time
from typing import Any, Dict

import httpx
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

LOGGER = logging.getLogger("wall_api")

GITHUB_USER = os.getenv("GITHUB_USER", "Cdaprod")
YOUTUBE_CHANNEL_ID = os.getenv("YOUTUBE_CHANNEL_ID", "")
YOUTUBE_CHANNEL_URL = os.getenv("YOUTUBE_CHANNEL_URL", "")
YOUTUBE_API_KEY = os.getenv("YOUTUBE_API_KEY", "")
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN", "")
YTDLP_BIN = os.getenv("YTDLP_BIN", "yt-dlp")

CACHE_TTL_SEC = int(os.getenv("CACHE_TTL_SEC", "30"))

app = FastAPI(title="wall-api")

_cache: Dict[str, Any] = {"ts": 0.0, "payload": None}
_last_good_youtube: Dict[str, Any] = {}


def _default_github(handle: str) -> Dict[str, Any]:
    return {
        "handle": handle,
        "public_repos": 0,
        "followers": 0,
        "following": 0,
        "stars_estimate": 0,
    }


def _default_youtube(handle: str) -> Dict[str, Any]:
    return {
        "handle": handle,
        "subscribers": 0,
        "views": 0,
        "videos": 0,
        "live": False,
    }


def _yt_target_url() -> str:
    """Return the best YouTube URL target for metadata extraction."""
    if YOUTUBE_CHANNEL_URL:
        return YOUTUBE_CHANNEL_URL
    if YOUTUBE_CHANNEL_ID:
        return f"https://www.youtube.com/channel/{YOUTUBE_CHANNEL_ID}"
    return "https://www.youtube.com/@Cdaprod"


async def fetch_github(user: str) -> Dict[str, Any]:
    """Fetch GitHub stats for the given user.

    Example:
      await fetch_github("Cdaprod")
    """
    headers: Dict[str, str] = {}
    if GITHUB_TOKEN:
        headers["Authorization"] = f"Bearer {GITHUB_TOKEN}"
        headers["X-GitHub-Api-Version"] = "2022-11-28"

    async with httpx.AsyncClient(timeout=10.0, headers=headers) as client:
        u = await client.get(f"https://api.github.com/users/{user}")
        u.raise_for_status()
        udata = u.json()

        stars = 0
        page = 1
        per_page = 100
        max_pages = 10

        while page <= max_pages:
            r = await client.get(
                f"https://api.github.com/users/{user}/repos",
                params={"per_page": per_page, "page": page, "sort": "updated"},
            )
            r.raise_for_status()
            repos = r.json()
            if not repos:
                break
            for repo in repos:
                stars += int(repo.get("stargazers_count") or 0)
            if len(repos) < per_page:
                break
            page += 1

        return {
            "handle": f"@{udata.get('login', user)}",
            "public_repos": int(udata.get("public_repos") or 0),
            "followers": int(udata.get("followers") or 0),
            "following": int(udata.get("following") or 0),
            "stars_estimate": int(stars),
        }


async def fetch_youtube_official() -> Dict[str, Any]:
    """Fetch YouTube stats with the official API."""
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.get(
            "https://www.googleapis.com/youtube/v3/channels",
            params={
                "part": "statistics,snippet",
                "id": YOUTUBE_CHANNEL_ID,
                "key": YOUTUBE_API_KEY,
            },
        )
        r.raise_for_status()
        data = r.json()
        items = data.get("items") or []
        if not items:
            return _default_youtube("@Cdaprod")

        item = items[0]
        stats = item.get("statistics") or {}
        snippet = item.get("snippet") or {}
        title = snippet.get("customUrl") or snippet.get("title") or "Cdaprod"

        return {
            "handle": f"@{title}".replace("@@", "@"),
            "subscribers": int(stats.get("subscriberCount") or 0),
            "views": int(stats.get("viewCount") or 0),
            "videos": int(stats.get("videoCount") or 0),
            "live": False,
        }


def fetch_youtube_fallback_ytdlp() -> Dict[str, Any]:
    """Fetch YouTube stats with yt-dlp metadata extraction.

    Example:
      yt-dlp -J --skip-download https://www.youtube.com/@Cdaprod
    """
    url = _yt_target_url()
    cmd = [YTDLP_BIN, "-J", "--skip-download", "--no-warnings", url]

    out = subprocess.check_output(cmd, stderr=subprocess.STDOUT, timeout=15)
    info = json.loads(out.decode("utf-8", errors="replace"))

    subscribers = int(info.get("channel_follower_count") or 0)
    views = int(info.get("view_count") or 0)
    videos = int(info.get("channel_video_count") or 0)
    if not videos:
        entries = info.get("entries")
        if isinstance(entries, list):
            videos = len(entries)

    handle = info.get("channel") or info.get("uploader") or "Cdaprod"
    handle = handle if handle.startswith("@") else f"@{handle}"

    return {
        "handle": handle.replace("@@", "@"),
        "subscribers": subscribers,
        "views": views,
        "videos": videos,
        "live": False,
    }


async def fetch_youtube() -> Dict[str, Any]:
    """Fetch YouTube stats for the configured channel.

    Example:
      await fetch_youtube()
    """
    global _last_good_youtube
    if not _last_good_youtube:
        _last_good_youtube = _default_youtube("@Cdaprod")

    try:
        if YOUTUBE_API_KEY and YOUTUBE_CHANNEL_ID:
            try:
                youtube = await fetch_youtube_official()
            except (httpx.HTTPError, ValueError) as exc:
                LOGGER.warning("YouTube official fetch failed, falling back: %s", exc)
                youtube = fetch_youtube_fallback_ytdlp()
        else:
            youtube = fetch_youtube_fallback_ytdlp()
    except (subprocess.SubprocessError, json.JSONDecodeError, OSError, ValueError) as exc:
        LOGGER.warning("YouTube fetch failed, using last good data: %s", exc)
        return _last_good_youtube

    _last_good_youtube = youtube
    return youtube


@app.get("/api/wall")
async def wall() -> JSONResponse:
    """Return aggregated wall stats.

    Example:
      curl http://localhost:8795/api/wall
    """
    now = time.monotonic()
    cached = _cache.get("payload")
    if cached and (now - float(_cache.get("ts", 0.0))) < CACHE_TTL_SEC:
        return JSONResponse(cached)

    try:
        github = await fetch_github(GITHUB_USER)
        youtube = await fetch_youtube()
    except (httpx.HTTPError, ValueError) as exc:
        LOGGER.exception("wall-api fetch failed")
        payload = {
            "source": "wall-api",
            "github": _default_github(f"@{GITHUB_USER}"),
            "youtube": _default_youtube("@Cdaprod"),
            "error": str(exc),
        }
        return JSONResponse(payload, status_code=502)

    payload = {
        "source": "wall-api",
        "github": github,
        "youtube": youtube,
    }

    _cache["ts"] = now
    _cache["payload"] = payload
    return JSONResponse(payload)


app.mount("/", StaticFiles(directory="public", html=True), name="public")
