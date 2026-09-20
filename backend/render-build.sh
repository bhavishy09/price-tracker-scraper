#!/usr/bin/env bash
# render-build.sh
# --------------------------------------------------------------------------
# Build script for Render. Installs OS-level shared libraries Chromium
# needs (Playwright bundles its own Chromium binary, but that binary still
# links against system libs like libnss3, libatk, etc.).
#
# Configure this as the Build Command on Render:
#   bash render-build.sh
# And set the Start Command to:
#   npm start
# --------------------------------------------------------------------------
set -euo pipefail

echo "[render-build] installing npm dependencies"
npm ci --omit=dev || npm install

echo "[render-build] installing Playwright Chromium into project node_modules"
export PLAYWRIGHT_BROWSERS_PATH=0
npx playwright install chromium

echo "[render-build] done."
