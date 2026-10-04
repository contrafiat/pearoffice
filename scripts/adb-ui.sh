#!/usr/bin/env bash
# Tiny helpers for driving an Android device or emulator by its UI text
# (suite rule 16: read the screen as text, not screenshots).
#   scripts/adb-ui.sh <serial> texts              list visible texts
#   scripts/adb-ui.sh <serial> tap "<text>" [n]    tap the n-th node with that text (default 1)
#   scripts/adb-ui.sh <serial> bounds "<text>"     print its bounds
#   scripts/adb-ui.sh <serial> all "<text>"        bounds of every node with that text
set -euo pipefail
S="$1"; CMD="$2"; shift 2
dump () { adb -s "$S" shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb -s "$S" shell cat /sdcard/ui.xml; }
case "$CMD" in
  texts) dump | grep -oE 'text="[^"]+"' | sed 's/text=//' | sort -u ;;
  all) dump | grep -oE "text=\"$1\"[^>]*bounds=\"\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]\"" | grep -oE '\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]' | sed 's/\]\[/,/; s/[][]//g' | tr ',' ' ' ;;
  bounds|tap)
    N="${2:-1}"
    B=$(dump | grep -oE "text=\"$1\"[^>]*bounds=\"\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]\"" | sed -n "${N}p" | grep -oE '\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]' || true)
    [ -z "$B" ] && { echo "not found: $1" >&2; exit 1; }
    read -r X1 Y1 X2 Y2 <<<"$(echo "$B" | sed 's/\]\[/,/; s/[][]//g' | tr ',' ' ')"
    if [ "$CMD" = bounds ]; then echo "$X1 $Y1 $X2 $Y2"; else adb -s "$S" shell input tap $(( (X1 + X2) / 2 )) $(( (Y1 + Y2) / 2 )); fi ;;
esac
