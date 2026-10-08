#!/usr/bin/env bash
# Desktop screenshots for GitHub and the website: five scenes of the
# community garden files, 1440x900, light. Needs scripts/store-shots/demo.js
# running. Drives the real app offscreen (desktop/smoke/store-shots.js).
#
#   scripts/store-shots/desktop.sh
#
# Output: metadata/store/desktop/0N-<scene>.png (OUT to change it).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
OUT="$(realpath -m "${OUT:-metadata/store/desktop}")"
npm run build:ui >/dev/null
PEAROFFICE_SMOKE_TIMEOUT=300000 PEAROFFICE_SHOTS_OUT="$OUT" node desktop/smoke.js --part store-shots
