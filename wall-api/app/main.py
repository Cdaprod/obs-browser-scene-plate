"""Wall stats API for OBS plate overlays.

Usage:
  uvicorn app.main:app --host 0.0.0.0 --port 8795

Example:
  curl http://localhost:8795/api/wall
"""
from __future__ import annotations

import logging
import os
import time
from typing import Any, Dict

import httpx
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

LOGGER = logging.getLogger("wall_api")

GITHUB_USER = os.getenv("GITHUB_USER", "Cdaprod")
YOUTUBE_CHANNEL_ID = os.getenv("YOUTUBE_CHANNEL_ID", "")
YOUTUBE_API_KEY = os.getenv("YOUTUBE_API_KEY", "")
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN", "")

CACHE_TTL_SEC = int(os.getenv("CACHE_TTL_SEC", "30"))

app = FastAPI(title="wall-api")

_cache: Dict[str, Any] = {"ts": 0.0, "payload": None}


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


async def fetch_youtube() -> Dict[str, Any]:
    """Fetch YouTube stats for the configured channel.

    Example:
      await fetch_youtube()
    """
    if not (YOUTUBE_API_KEY and YOUTUBE_CHANNEL_ID):
        return _default_youtube("@Cdaprod")

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
