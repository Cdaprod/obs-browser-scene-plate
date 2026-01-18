"""Tests for the wall-api service.

Example:
  python -m unittest discover -s tests
"""
from unittest import TestCase
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app import main


class WallApiTests(TestCase):
    def setUp(self) -> None:
        main._cache["ts"] = 0.0
        main._cache["payload"] = None
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

