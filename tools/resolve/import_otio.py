#!/usr/bin/env python3
"""
Import OTIO/manifest-referenced media into DaVinci Resolve bins.

Usage:
  python tools/resolve/import_otio.py --project_root /renders/workspace --project_id demo --otio_path /tmp/timeline.otio

Example:
  python tools/resolve/import_otio.py --project_root B:/Video/.../workspace --project_id intro-a7914d7c --manifest_path B:/.../manifest.json
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from tools.artifact_import import build_import_plan


def _load_resolve_api():
    try:
        module = __import__("DaVinciResolveScript")
    except ModuleNotFoundError:
        return None
    return module.scriptapp("Resolve")


def _find_or_create_folder(media_pool, parent_folder, name):
    for folder in media_pool.GetSubFolderList(parent_folder) or []:
        if folder.GetName() == name:
            return folder
    created = media_pool.AddSubFolder(parent_folder, name)
    return created


def _ensure_bin_tree(media_pool, project_id):
    root = media_pool.GetRootFolder()
    projects_folder = _find_or_create_folder(media_pool, root, "Projects")
    project_folder = _find_or_create_folder(media_pool, projects_folder, project_id)
    ingest_folder = _find_or_create_folder(media_pool, project_folder, "Ingest")
    originals = _find_or_create_folder(media_pool, ingest_folder, "Originals")
    plates = _find_or_create_folder(media_pool, project_folder, "Plates")
    exports = _find_or_create_folder(media_pool, project_folder, "Exports")
    return {
        "originals": originals,
        "plates": plates,
        "exports": exports,
    }


def _existing_paths_in_folder(folder):
    existing = set()
    for clip in folder.GetClipList() or []:
        props = clip.GetClipProperty() or {}
        file_path = props.get("File Path") or props.get("Filepath") or ""
        if file_path:
            existing.add(str(Path(file_path).resolve()))
    return existing


def _import_paths(media_pool, folder, paths):
    media_pool.SetCurrentFolder(folder)
    existing = _existing_paths_in_folder(folder)
    imported = 0
    missing = 0
    skipped = 0
    for p in paths:
        resolved = str(Path(p).resolve())
        if not Path(resolved).exists():
            missing += 1
            continue
        if resolved in existing:
            skipped += 1
            continue
        ok = media_pool.ImportMedia([resolved])
        if ok:
            imported += 1
            existing.add(resolved)
        else:
            missing += 1
    return {"imported": imported, "skipped": skipped, "missing": missing}


def main(argv=None):
    parser = argparse.ArgumentParser(description="Import OTIO/manifest artifacts into Resolve bins")
    parser.add_argument("--project_root", required=True)
    parser.add_argument("--project_id", required=True)
    parser.add_argument("--otio_path")
    parser.add_argument("--manifest_path")
    args = parser.parse_args(argv)

    if not args.otio_path and not args.manifest_path:
        print("error: provide --otio_path or --manifest_path", file=sys.stderr)
        return 2

    plan = build_import_plan(
        project_root=args.project_root,
        project_id=args.project_id,
        otio_path=args.otio_path,
        manifest_path=args.manifest_path,
    )

    resolve = _load_resolve_api()
    if not resolve:
        print("Unable to attach Resolve scripting API. Enable scripting in Resolve preferences and set scripting environment paths.")
        print(f"Planned imports: originals={len(plan['buckets']['originals'])} plates={len(plan['buckets']['plates'])} exports={len(plan['buckets']['exports'])}")
        return 3

    project_manager = resolve.GetProjectManager()
    project = project_manager.GetCurrentProject()
    if not project:
        print("No current Resolve project is open.", file=sys.stderr)
        return 4

    media_pool = project.GetMediaPool()
    bins = _ensure_bin_tree(media_pool, args.project_id)

    report = {
        "originals": _import_paths(media_pool, bins["originals"], plan["buckets"]["originals"]),
        "plates": _import_paths(media_pool, bins["plates"], plan["buckets"]["plates"]),
        "exports": _import_paths(media_pool, bins["exports"], plan["buckets"]["exports"]),
    }

    print("Resolve import report")
    for bucket in ("originals", "plates", "exports"):
        row = report[bucket]
        print(f"- {bucket}: imported={row['imported']} skipped={row['skipped']} missing={row['missing']}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
