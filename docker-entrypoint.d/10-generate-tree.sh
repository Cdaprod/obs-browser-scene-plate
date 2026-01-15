#!/bin/sh
set -eu

ROOT="/usr/share/nginx/html"
OUT="${ROOT}/tree.json"

FILES="$(find "$ROOT" -type f \
  ! -name "tree.json" \
  ! -path "*/.*/*" \
  ! -name ".*" \
  \( -iname "*.html" -o -iname "*.css" -o -iname "*.js" -o -iname "*.json" \
     -o -iname "*.mp4" -o -iname "*.webm" -o -iname "*.png" -o -iname "*.jpg" -o -iname "*.jpeg" -o -iname "*.svg" \) \
  | sort)"

{
  echo '{'
  echo '  "files": ['

  first=1
  echo "$FILES" | while IFS= read -r f; do
    [ -z "$f" ] && continue
    rel="${f#$ROOT}"
    path="/${rel#/}"

    if [ $first -eq 1 ]; then
      first=0
      printf '    "%s"' "$path"
    else
      printf ',\n    "%s"' "$path"
    fi
  done

  echo
  echo '  ]'
  echo '}'
} > "$OUT"

echo "[tree] generated $OUT"