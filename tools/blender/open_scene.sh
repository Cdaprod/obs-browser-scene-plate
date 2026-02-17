#!/usr/bin/env bash
# Usage:
#   tools/blender/open_scene.sh --project_root /renders/workspace --project_id demo --otio_path /tmp/timeline.otio
# Example:
#   BLENDER_BIN="/c/Program Files/Blender Foundation/Blender 4.2/blender.exe" tools/blender/open_scene.sh --project_root /mnt/b/.../workspace --project_id intro --manifest_path /mnt/b/.../manifest.json
set -euo pipefail

if [[ -z "${BLENDER_BIN:-}" ]]; then
  echo "Set BLENDER_BIN to your Blender executable path." >&2
  exit 2
fi

"${BLENDER_BIN}" --python tools/blender/import_sequence.py -- "$@"
