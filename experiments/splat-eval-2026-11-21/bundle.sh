#!/usr/bin/env bash
# Package the experiment for sharing: reports, ledgers, source photos, Quest-ready SOGs,
# renders, contact sheets, scripts and a self-contained viewer. Skips raw/intermediate
# PLY, zip and npy files and the tool caches the runs left in outputs/.
# Usage: ./bundle.sh [output-dir]
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
NAME=$(basename "$HERE")
OUT_DIR=$(cd "${1:-$HERE/..}" && pwd)
ARCHIVE="$OUT_DIR/$NAME-results-$(date +%Y%m%d-%H%M).tar.gz"
PLAYCANVAS="$HERE/../../web/node_modules/playcanvas/build/playcanvas.mjs"

STAGE_ROOT=$(mktemp -d)
trap 'rm -rf "$STAGE_ROOT"' EXIT
STAGE="$STAGE_ROOT/$NAME"

rsync -a --prune-empty-dirs \
  --exclude '__pycache__/' --exclude '*.pyc' --exclude '.DS_Store' --exclude '*.log' --exclude '*.lock' \
  --exclude 'node_modules/' --exclude 'npm-cache/' --exclude 'venv/' --exclude '.venv/' \
  --exclude 'cache/' --exclude 'validator/' \
  --exclude '*.ply' --exclude '*.zip' --exclude '*.npy' \
  --exclude 'BUNDLE_README.md' --exclude 'bundle.sh' \
  "$HERE/" "$STAGE/"
cp "$HERE/BUNDLE_README.md" "$STAGE/README.md"
mkdir -p "$STAGE/viewer/vendor"
cp "$PLAYCANVAS" "$STAGE/viewer/vendor/playcanvas.mjs"

tar -C "$STAGE_ROOT" -czf "$ARCHIVE" "$NAME"
echo "$ARCHIVE"
