"""
Artifact parsing helpers for Resolve/Blender import scripts.

Usage:
  from tools.artifact_import import build_import_plan
  plan = build_import_plan(project_root="/renders/workspace", project_id="demo", otio_path="/tmp/timeline.otio")

Example:
  python -c "from tools.artifact_import import build_import_plan; print(build_import_plan('/renders/workspace','demo',otio_path='/tmp/timeline.otio'))"
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Dict, List, Optional

MEDIA_EXTENSIONS = {".mov", ".mp4", ".m4v", ".webm", ".mkv", ".avi", ".png", ".jpg", ".jpeg", ".webp", ".wav", ".mp3", ".aac", ".m4a", ".ogg"}


def _is_local_media_path(value: str) -> bool:
    if not value:
        return False
    lowered = value.lower()
    if lowered.startswith("http://") or lowered.startswith("https://"):
        return False
    return Path(value).suffix.lower() in MEDIA_EXTENSIONS


def _normalize_media_path(value: str, base_dir: Path) -> str:
    candidate = Path(value)
    if candidate.is_absolute():
        return str(candidate)
    return str((base_dir / candidate).resolve())


def _collect_otio_references(otio: Dict, base_dir: Path) -> List[Dict]:
    refs: List[Dict] = []
    tracks = (((otio or {}).get("tracks") or {}).get("children") or [])
    for track in tracks:
        for child in (track or {}).get("children") or []:
            if (child or {}).get("OTIO_SCHEMA") != "Clip.1":
                continue
            media_ref = (child or {}).get("media_reference") or {}
            target_url = str(media_ref.get("target_url") or "").strip()
            if not _is_local_media_path(target_url):
                continue
            source_meta = ((child.get("metadata") or {}).get("source")
                           or (media_ref.get("metadata") or {}).get("source")
                           or {})
            source_type = source_meta.get("type") or "url"
            refs.append({
                "path": _normalize_media_path(target_url, base_dir),
                "source_type": source_type,
                "origin": "otio"
            })
    return refs


def _collect_manifest_references(manifest: Dict, base_dir: Path) -> List[Dict]:
    refs: List[Dict] = []
    for asset in (manifest or {}).get("resolved_assets") or []:
        source_type = str(asset.get("type") or "url")
        for key in ("path", "output_path", "resolved_path", "url"):
            value = str(asset.get(key) or "").strip()
            if not _is_local_media_path(value):
                continue
            refs.append({
                "path": _normalize_media_path(value, base_dir),
                "source_type": "plate" if source_type == "plate" else "url",
                "origin": "manifest"
            })
            break
    return refs


def _collect_export_paths(project_root: Path, project_id: str) -> List[Dict]:
    exports_dir = project_root / "projects" / project_id / "_exports"
    if not exports_dir.exists():
        return []
    refs: List[Dict] = []
    for path in exports_dir.rglob("*"):
        if not path.is_file():
            continue
        if path.suffix.lower() not in MEDIA_EXTENSIONS:
            continue
        refs.append({"path": str(path.resolve()), "source_type": "export", "origin": "exports_dir"})
    return refs


def build_import_plan(project_root: str, project_id: str, otio_path: Optional[str] = None, manifest_path: Optional[str] = None) -> Dict:
    if not project_root:
        raise ValueError("missing_project_root")
    if not project_id:
        raise ValueError("missing_project_id")
    if not otio_path and not manifest_path:
        raise ValueError("missing_otio_or_manifest")

    root = Path(project_root)
    refs: List[Dict] = []
    fps = None
    width = None
    height = None
    total_duration_sec = None

    if otio_path:
        otio_file = Path(otio_path)
        otio = json.loads(otio_file.read_text(encoding="utf-8"))
        refs.extend(_collect_otio_references(otio, otio_file.parent))
        global_start = (otio.get("global_start_time") or {})
        fps = global_start.get("rate") if isinstance(global_start, dict) else fps

    if manifest_path:
        manifest_file = Path(manifest_path)
        manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
        refs.extend(_collect_manifest_references(manifest, manifest_file.parent))
        plan = (manifest.get("render_plan") or {})
        fps = fps or plan.get("fps")
        width = plan.get("width")
        height = plan.get("height")
        timing = manifest.get("timing") or {}
        total_duration_sec = timing.get("total_duration_sec") or timing.get("duration_seconds")

    refs.extend(_collect_export_paths(root, project_id))

    dedup = {}
    for item in refs:
        dedup[item["path"]] = item

    buckets = {"originals": [], "plates": [], "exports": []}
    for item in dedup.values():
        if item["source_type"] == "plate":
            buckets["plates"].append(item["path"])
        elif item["source_type"] == "export":
            buckets["exports"].append(item["path"])
        else:
            buckets["originals"].append(item["path"])

    for key in buckets:
        buckets[key].sort()

    return {
        "project_root": str(root.resolve()),
        "project_id": project_id,
        "fps": fps,
        "width": width,
        "height": height,
        "total_duration_sec": total_duration_sec,
        "buckets": buckets,
    }
