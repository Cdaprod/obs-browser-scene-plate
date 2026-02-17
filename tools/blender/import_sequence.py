#!/usr/bin/env python3
"""
Import OTIO/manifest media references into Blender collections.

Usage (inside Blender):
  blender --background --python tools/blender/import_sequence.py -- --project_root /renders/workspace --project_id demo --otio_path /tmp/timeline.otio

Example:
  blender --python tools/blender/import_sequence.py -- --project_root B:/Video/.../workspace --project_id intro --manifest_path B:/.../manifest.json
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from tools.artifact_import import build_import_plan


def _get_bpy():
    try:
        return __import__("bpy")
    except ModuleNotFoundError:
        return None


def _ensure_collection(bpy, parent, name):
    existing = parent.children.get(name)
    if existing:
        return existing
    coll = bpy.data.collections.new(name)
    parent.children.link(coll)
    return coll


def _ensure_tree(bpy, project_id):
    scene_root = bpy.context.scene.collection
    projects = _ensure_collection(bpy, scene_root, "Projects")
    project = _ensure_collection(bpy, projects, project_id)
    plates = _ensure_collection(bpy, project, "Plates")
    originals = _ensure_collection(bpy, project, "Originals")
    exports = _ensure_collection(bpy, project, "Exports")
    return {"plates": plates, "originals": originals, "exports": exports}


def _existing_import_paths(collection):
    paths = set()
    for obj in collection.objects:
        value = obj.get("source_path")
        if value:
            paths.add(str(Path(value).resolve()))
    return paths


def _import_paths_as_empties(bpy, collection, paths):
    existing = _existing_import_paths(collection)
    imported = 0
    skipped = 0
    missing = 0
    for item in paths:
        p = str(Path(item).resolve())
        if not Path(p).exists():
            missing += 1
            continue
        if p in existing:
            skipped += 1
            continue
        obj_name = f"src_{Path(p).stem}"[:60]
        obj = bpy.data.objects.new(obj_name, None)
        obj.empty_display_type = 'PLAIN_AXES'
        obj["source_path"] = p
        collection.objects.link(obj)
        existing.add(p)
        imported += 1
    return {"imported": imported, "skipped": skipped, "missing": missing}


def main(argv=None):
    raw_argv = argv if argv is not None else sys.argv
    if "--" in raw_argv:
        raw_argv = raw_argv[raw_argv.index("--") + 1:]
    else:
        raw_argv = raw_argv[1:]

    parser = argparse.ArgumentParser(description="Import artifact references into Blender collections")
    parser.add_argument("--project_root", required=True)
    parser.add_argument("--project_id", required=True)
    parser.add_argument("--otio_path")
    parser.add_argument("--manifest_path")
    args = parser.parse_args(raw_argv)

    if not args.otio_path and not args.manifest_path:
        print("error: provide --otio_path or --manifest_path", file=sys.stderr)
        return 2

    plan = build_import_plan(
        project_root=args.project_root,
        project_id=args.project_id,
        otio_path=args.otio_path,
        manifest_path=args.manifest_path,
    )

    bpy = _get_bpy()
    if not bpy:
        print("This importer must run inside Blender (bpy unavailable).")
        return 3

    scene = bpy.context.scene
    if plan.get("fps"):
        scene.render.fps = int(plan["fps"])
    if plan.get("width") and plan.get("height"):
        scene.render.resolution_x = int(plan["width"])
        scene.render.resolution_y = int(plan["height"])
    if plan.get("total_duration_sec") and plan.get("fps"):
        scene.frame_start = 1
        scene.frame_end = max(1, int(float(plan["total_duration_sec"]) * float(plan["fps"])))

    collections = _ensure_tree(bpy, args.project_id)
    report = {
        "plates": _import_paths_as_empties(bpy, collections["plates"], plan["buckets"]["plates"]),
        "originals": _import_paths_as_empties(bpy, collections["originals"], plan["buckets"]["originals"]),
        "exports": _import_paths_as_empties(bpy, collections["exports"], plan["buckets"]["exports"]),
    }

    print("Blender import report")
    for bucket in ("plates", "originals", "exports"):
        row = report[bucket]
        print(f"- {bucket}: imported={row['imported']} skipped={row['skipped']} missing={row['missing']}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
