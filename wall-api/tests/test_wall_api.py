"""Tests for the wall-api service.

Example:
  python -m unittest discover -s tests
"""
from unittest import TestCase
import asyncio
import json
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app import main


class WallApiTests(TestCase):
    def setUp(self) -> None:
        main._cache["ts"] = 0.0
        main._cache["payload"] = None
        main._last_good_youtube = {}
        self.client = TestClient(main.app)

    def test_wall_returns_payload(self) -> None:
        github_payload = {
            "handle": "@octocat",
            "public_repos": 1,
            "followers": 2,
            "following": 3,
            "stars_estimate": 4,
        }
        youtube_payload = {
            "handle": "@octo",
            "subscribers": 5,
            "views": 6,
            "videos": 7,
            "live": False,
        }
        with patch("app.main.fetch_github", new=AsyncMock(return_value=github_payload)):
            with patch("app.main.fetch_youtube", new=AsyncMock(return_value=youtube_payload)):
                response = self.client.get("/api/wall")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["source"], "wall-api")
        self.assertEqual(body["github"], github_payload)
        self.assertEqual(body["youtube"], youtube_payload)

    def test_fetch_youtube_fallback_uses_ytdlp(self) -> None:
        fallback_payload = {
            "channel": "octochannel",
            "channel_follower_count": 123,
            "view_count": 456,
            "channel_video_count": 7,
        }
        with patch.object(main, "YOUTUBE_API_KEY", ""):
            with patch.object(main, "YOUTUBE_CHANNEL_ID", ""):
                with patch("app.main.subprocess.check_output", return_value=json.dumps(fallback_payload).encode()):
                    youtube = asyncio.run(main.fetch_youtube())

        self.assertEqual(
            youtube,
            {
                "handle": "@octochannel",
                "subscribers": 123,
                "views": 456,
                "videos": 7,
                "live": False,
            },
        )

    def test_fetch_youtube_fallback_uses_last_good_on_error(self) -> None:
        last_good = {
            "handle": "@cached",
            "subscribers": 10,
            "views": 20,
            "videos": 30,
            "live": False,
        }
        main._last_good_youtube = last_good
        with patch.object(main, "YOUTUBE_API_KEY", ""):
            with patch.object(main, "YOUTUBE_CHANNEL_ID", ""):
                with patch("app.main.subprocess.check_output", side_effect=OSError("missing")):
                    youtube = asyncio.run(main.fetch_youtube())

        self.assertEqual(youtube, last_good)
