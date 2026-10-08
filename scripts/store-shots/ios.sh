#!/usr/bin/env bash
# App Store screenshots: five scenes of the community garden files on an
# iPhone or iPad Simulator on the Mac Mini, light, with Apple's 9:41 status
# bar. Runs from this machine. Needs scripts/store-shots/demo.js running here,
# the Simulator app built (scripts/build-ios-sim.sh) and
# ../pearlist/scripts/sim-drive.sh (WebDriverAgent).
#
#   SIM_NAME=PearOfficeShotsPhone OUT=metadata/store/ios scripts/store-shots/ios.sh
#   SIM_NAME=PearOfficeShotsPad OUT=metadata/store/ios-ipad scripts/store-shots/ios.sh
#
# PearOfficeShotsPhone is an iPhone 17 Pro Max (6.9 inch, 1320x2868) and
# PearOfficeShotsPad an iPad Pro 13-inch (M5) (2064x2752), the sizes App
# Store Connect asks for.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
MAC="${MAC_MINI:-Tims-Mac-mini.local}"
SIM_NAME="${SIM_NAME:-PearOfficeShotsPhone}"
OUT="${OUT:-metadata/store/ios}"
LINK_URL="${LINK_URL:-http://127.0.0.1:8799/link}"
APP='~/peerloomllc/pearoffice-build/pearoffice/build/ios-sim/Build/Products/Release-iphonesimulator/PearOffice.app'
export SIM_NAME BUNDLE_ID=com.pearoffice
D=../pearlist/scripts/sim-drive.sh
mkdir -p "$OUT"

UDID=$(ssh -o BatchMode=yes "$MAC" "xcrun simctl list devices | grep '$SIM_NAME (' | grep -oE '[0-9A-F-]{36}' | head -1")
[ -n "$UDID" ] || { echo "no Simulator named $SIM_NAME" >&2; exit 1; }
mac () { ssh -o BatchMode=yes "$MAC" "$@"; }

# Label -> "x y" from the WebDriverAgent dump: the first element whose label
# starts with $1 (is exactly what follows a leading =), of type $2 if given
# (Button, StaticText, ...). Off-screen places are skipped.
find_label () {
  "$D" dump 2>/dev/null | python3 -c '
import re, sys
want, kind = sys.argv[1], sys.argv[2]
for line in sys.stdin:
    m = re.match(r"\s*(\S+)\s+(.*?)\s+@\s+(-?\d+),\s*(-?\d+)\s*$", line)
    if not m or int(m.group(3)) < 0 or int(m.group(4)) < 0: continue
    if kind and m.group(1) != kind: continue
    label = m.group(2).strip()
    if (label == want[1:]) if want.startswith("=") else label.startswith(want):
        print(m.group(3), m.group(4)); break
' "$1" "${2:-}"
}
wait_for () { for _ in $(seq 1 "${3:-40}"); do [ -n "$(find_label "$1" "${2:-}")" ] && return 0; sleep 2; done; echo "timed out waiting for $1" >&2; exit 1; }
tap () { local p; wait_for "$1" "${2:-}"; p=$(find_label "$1" "${2:-}"); "$D" tap $p >/dev/null; sleep 1; }
shot () {
  sleep 2
  mac "xcrun simctl io $UDID screenshot /tmp/pearoffice-shot.png >/dev/null 2>&1"
  scp -q "$MAC:/tmp/pearoffice-shot.png" "$OUT/$1.png"
  magick "$OUT/$1.png" -alpha off "PNG24:$OUT/$1.png"
  echo "saved $OUT/$1.png"
}

# A fresh install, light, with the 9:41 status bar.
# Erased first: an uninstall and install in a row fails on a fresh device
# ("Failed to create IXPlaceholder").
"$D" stop >/dev/null 2>&1 || true
mac "for i in \$(seq 1 30); do xcrun simctl shutdown $UDID 2>/dev/null; xcrun simctl erase $UDID 2>/dev/null && break; sleep 2; done; xcrun simctl boot $UDID && xcrun simctl bootstatus $UDID -b >/dev/null
  xcrun simctl ui $UDID appearance light
  xcrun simctl spawn $UDID defaults write com.apple.keyboard.preferences DidShowContinuousPathIntroduction -bool true
  xcrun simctl spawn $UDID defaults write com.apple.Preferences DidShowContinuousPathIntroduction -bool true
  xcrun simctl status_bar $UDID override --time 9:41 --dataNetwork wifi --wifiMode active --wifiBars 3 --cellularMode notSupported --batteryState charged --batteryLevel 100
  xcrun simctl install $UDID $APP && xcrun simctl launch $UDID com.pearoffice >/dev/null"
"$D" stop >/dev/null 2>&1 || true
"$D" start >/dev/null

# Through the welcome, then link to Nick.
tap "Get started"
# The name field opens the keyboard over the buttons: close it first.
wait_for "Skip for now"
for _ in $(seq 1 8); do [ -n "$(find_label '=Done')" ] && { tap "=Done"; break; }; sleep 1; done
tap "Skip for now"
tap "=Skip"
LINK=$(curl -fsS "$LINK_URL")
mac "xcrun simctl openurl $UDID '$LINK'"
# iOS asks "Open in PearOffice?" (a system alert the dump does not show).
sleep 3
mac 'curl -s -X POST "http://127.0.0.1:${APPIUM_PORT:-4723}/session/$(cat /tmp/pearlist-sim-session)/alert/accept" -H "Content-Type: application/json" -d "{}" >/dev/null'
tap "=Link"
wait_for "October meeting" "" 60
# Edit access follows once one of Nick's other devices admits this one.
sleep 20
for _ in $(seq 1 40); do [ -z "$(find_label 'Getting edit access')" ] && break; sleep 3; done

# The sidebar is always there on an iPad; on a phone the menu button
# (labelled "Your files") opens it.
menu () { case "$SIM_NAME" in *Phone*) tap "=Your files" Button; sleep 1 ;; esac; }
open_file () { menu; tap "$1" Button; sleep 2; }
menu; tap "=All files" Button
shot 01-files
open_file "Garden budget 2026"; wait_for "=Sheet title"; sleep 3; shot 02-sheet
open_file "Planting plan"; wait_for "=Document title"; sleep 3; shot 03-document
open_file "October meeting"; wait_for "=Deck title"; sleep 3
# The chart slide: the third thumbnail, the only one with a chart.
tap "=Chart" Image; sleep 3; shot 04-slides
tap "People in this" Button; tap "Invite to edit" Button; wait_for "Send this link"; shot 05-sharing
"$D" stop >/dev/null 2>&1 || true
mac "xcrun simctl status_bar $UDID clear"
