#!/usr/bin/env bash
# Every store screenshot in one go: starts scripts/store-shots/demo.js, then
# takes the desktop, Android, iPhone and iPad sets into metadata/store/.
# Needs the debug APK (npm run build:android), the Simulator app
# (scripts/build-ios-sim.sh), the emulator on adb (SERIAL, default
# emulator-5572) and the PearOfficeShotsPhone and PearOfficeShotsPad
# Simulators on the Mac Mini. See scripts/store-shots/*.sh for each.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
DATA="$(mktemp -d)"
node scripts/store-shots/demo.js --data "$DATA" > "$DATA/demo.log" 2>&1 &
DEMO=$!
trap 'kill $DEMO 2>/dev/null || true' EXIT
until grep -q '^ready' "$DATA/demo.log"; do kill -0 $DEMO 2>/dev/null || { cat "$DATA/demo.log"; exit 1; }; sleep 2; done
scripts/store-shots/desktop.sh
scripts/store-shots/android.sh
SIM_NAME=PearOfficeShotsPhone OUT=metadata/store/ios scripts/store-shots/ios.sh
SIM_NAME=PearOfficeShotsPad OUT=metadata/store/ios-ipad scripts/store-shots/ios.sh
echo "done: metadata/store"
