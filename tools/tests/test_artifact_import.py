"""
Tests for artifact import planning helpers.

Usage:
  python -m unittest tools.tests.test_artifact_import
"""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from tools.artifact_import import build_import_plan


class ArtifactImportPlanTests(unittest.TestCase):
    def test_classifies_plate_url_and_exports(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            project_id = "demo"
            exports_dir = root / "projects" / project_id / "_exports"
            exports_dir.mkdir(parents=True)
            (exports_dir / "render.mov").write_bytes(b"x")

            plate = root / "plate.mov"
            orig = root / "clip.mp4"
            plate.write_bytes(b"x")
            orig.write_bytes(b"x")

            otio_path = root / "timeline.otio"
            otio_payload = {
                "OTIO_SCHEMA": "Timeline.1",
                "global_start_time": {"OTIO_SCHEMA": "RationalTime.1", "value": 0, "rate": 60},
                "tracks": {
                    "OTIO_SCHEMA": "Stack.1",
                    "children": [
                        {
                            "OTIO_SCHEMA": "Track.1",
                            "children": [
                                {
                                    "OTIO_SCHEMA": "Clip.1",
                                    "media_reference": {
                                        "OTIO_SCHEMA": "ExternalReference.1",
                                        "target_url": str(plate),
                                        "metadata": {"source": {"type": "plate", "value": str(plate)}}
                                    },
                                    "metadata": {"source": {"type": "plate", "value": str(plate)}}
                                },
                                {
                                    "OTIO_SCHEMA": "Clip.1",
                                    "media_reference": {
                                        "OTIO_SCHEMA": "ExternalReference.1",
                                        "target_url": str(orig),
                                        "metadata": {"source": {"type": "url", "value": str(orig)}}
                                    },
                                    "metadata": {"source": {"type": "url", "value": str(orig)}}
                                }
                            ]
                        }
                    ]
                }
            }
            otio_path.write_text(json.dumps(otio_payload), encoding="utf-8")

            plan = build_import_plan(
                project_root=str(root),
                project_id=project_id,
                otio_path=str(otio_path),
            )

            self.assertEqual(plan["fps"], 60)
            self.assertIn(str(plate.resolve()), plan["buckets"]["plates"])
            self.assertIn(str(orig.resolve()), plan["buckets"]["originals"])
            self.assertIn(str((exports_dir / "render.mov").resolve()), plan["buckets"]["exports"])


if __name__ == "__main__":
    unittest.main()
