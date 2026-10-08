#!/usr/bin/env bash
# Android store screenshots (Google Play and Zapstore): five scenes of the
# community garden files, 1080x2160, light, no alpha, with a clean status bar.
# Needs scripts/store-shots/demo.js running, the debug APK built
# (npm run build:android) and an emulator or phone on adb.
#
#   SERIAL=emulator-5572 scripts/store-shots/android.sh
#
# Output: metadata/store/android/0N-<scene>.png (OUT to change it).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
SERIAL="${SERIAL:-emulator-5572}"
OUT="${OUT:-metadata/store/android}"
LINK_URL="${LINK_URL:-http://127.0.0.1:8799/link}"
APK="${APK:-android/app/build/outputs/apk/debug/app-debug.apk}"
PKG=com.pearoffice.debug
A=(adb -s "$SERIAL")
mkdir -p "$OUT"

dump () { "${A[@]}" shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; "${A[@]}" shell cat /sdcard/ui.xml; }
has () { dump | grep -q "$1"; }
# Waits until the screen shows text matching $1 (a grep pattern).
wait_for () { for _ in $(seq 1 "${2:-40}"); do has "$1" && return 0; sleep 2; done; echo "timed out waiting for $1" >&2; exit 1; }
# Taps the centre of the first visible node whose text starts with $1 (or
# is exactly what follows a leading =), moved down by $2 pixels (default 0).
tap () {
  local b=''
  for _ in 1 2 3 4 5; do
  b=$(dump | python3 -c '
import re, sys
want = sys.argv[1]
for node in re.findall(r"<node [^>]*>", sys.stdin.read()):
    b = re.search(r"bounds=\"\[(\d+),(\d+)\]\[(\d+),(\d+)\]\"", node)
    if not b: continue
    x1, y1, x2, y2 = map(int, b.groups())
    labels = re.findall(r"(?:text|content-desc)=\"([^\"]*)\"", node)
    hit = any((t == want[1:]) if want.startswith("=") else (t != "" and t.startswith(want)) for t in labels)
    if hit and x2 > x1 and y2 > y1:
        print((x1 + x2) // 2, (y1 + y2) // 2 + int(sys.argv[2])); break
' "$1" "${2:-0}")
  [ -n "$b" ] && break
  sleep 2
  done
  [ -n "$b" ] || { echo "not on screen: $1" >&2; exit 1; }
  "${A[@]}" shell input tap $b
}
shot () {
  sleep 2
  "${A[@]}" exec-out screencap -p > "$OUT/$1.png"
  # Play refuses PNGs with an alpha channel; screencap always writes one.
  magick "$OUT/$1.png" -alpha off "PNG24:$OUT/$1.png"
  echo "saved $OUT/$1.png"
}
demo () { "${A[@]}" shell am broadcast -a com.android.systemui.demo -e command "$@" >/dev/null; }

"${A[@]}" install -r "$APK" >/dev/null
# 18:9 at 1080 wide: within Play's 2:1 limit with no padding.
"${A[@]}" shell wm size 1080x2160
"${A[@]}" shell settings put global sysui_demo_allowed 1
demo enter
demo clock -e hhmm 0900
demo battery -e level 100 -e plugged false
demo network -e wifi show -e level 4 -e fully true -e mobile hide
demo notifications -e visible false
trap '"${A[@]}" shell am broadcast -a com.android.systemui.demo -e command exit >/dev/null; "${A[@]}" shell wm size reset' EXIT

# A fresh install: through the welcome, then link to Nick.
"${A[@]}" shell pm clear "$PKG" >/dev/null
"${A[@]}" shell am start -n "$PKG/com.pearoffice.MainActivity" >/dev/null
wait_for 'text="Get started"'
tap "Get started"; wait_for 'Skip for now'
tap "Skip for now"; wait_for 'text="Skip"'
tap "Skip"; sleep 2
LINK=$(curl -fsS "$LINK_URL")
"${A[@]}" shell "am start -a android.intent.action.VIEW -d '$LINK' $PKG" >/dev/null 2>&1
wait_for 'text="Link"'
tap "Link"
wait_for 'October meeting' 60
# Edit access follows once one of Nick's other devices admits this one.
sleep 20
for _ in $(seq 1 40); do has 'Getting edit access' || break; sleep 3; done
while ! has 'text="Your files"'; do "${A[@]}" shell input keyevent KEYCODE_BACK; sleep 2; done

shot 01-files
tap "Garden budget 2026"; wait_for 'Raised bed lumber'; shot 02-sheet
"${A[@]}" shell input keyevent KEYCODE_BACK; wait_for 'text="Your files"'
tap "Planting plan"; wait_for 'Who looks after which bed'; shot 03-document
"${A[@]}" shell input keyevent KEYCODE_BACK; wait_for 'text="Your files"'
tap "October meeting"; wait_for 'Speaker notes\|speaker notes'
# The third thumbnail, the chart slide, under its number.
tap "=3" 110; sleep 2; shot 04-slides
tap "People in this"; wait_for 'Invite to edit'
tap "Invite to edit"; wait_for 'Send this link'; shot 05-sharing
