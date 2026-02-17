#!/usr/bin/env bash
# Usage:
#   tools/resolve/open_project.sh --project_root /renders/workspace --project_id demo --otio_path /tmp/timeline.otio
# Example:
#   RESOLVE_BIN="/c/Program Files/Blackmagic Design/DaVinci Resolve/Resolve.exe" tools/resolve/open_project.sh --project_root /mnt/b/.../workspace --project_id intro --manifest_path /mnt/b/.../manifest.json
set -euo pipefail

if [[ -n "${RESOLVE_BIN:-}" && -x "${RESOLVE_BIN}" ]]; then
  "${RESOLVE_BIN}" >/dev/null 2>&1 &
  sleep 3
else
  echo "Resolve binary not launched (set RESOLVE_BIN to enable auto-launch)." >&2
fi

python tools/resolve/import_otio.py "$@"
