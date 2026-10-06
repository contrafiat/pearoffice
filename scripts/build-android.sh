#!/usr/bin/env bash
# Build the Android debug APK (standalone, com.pearoffice.debug).
#
# Usage: scripts/build-android.sh [x86_64|arm64-v8a]   (default x86_64, the emulator)
# Output: android/app/build/outputs/apk/debug/app-debug.apk
#
# Rebuilds the worklet bundle and the WebView UI first, and clears Gradle's
# copy of the JS assets: it once kept a stale bare-universal.bundle in the APK
# after the bundle changed.
set -euo pipefail
ARCH="${1:-x86_64}"
cd "$(dirname "${BASH_SOURCE[0]}")/.."
npm run build:bare:mobile
npm run build:ui:mobile
# Regenerate android/ when it is missing or app.json, the icons or the
# config plugins changed since (icons are only copied in at prebuild).
if [ ! -d android ] || [ -n "$(find app.json assets/images plugins -newer android/app/build.gradle 2>/dev/null | head -1)" ]; then
  npx expo prebuild --platform android --no-install
  touch android/app/build.gradle
fi
rm -rf android/app/build/generated/res/createBundle* android/app/build/generated/assets/createBundle* android/app/build/intermediates/assets
(cd android && ./gradlew assembleDebug -PreactNativeArchitectures="$ARCH")
unzip -p android/app/build/outputs/apk/debug/app-debug.apk res/raw/assets_bareuniversal.bundle | cmp -s - assets/bare-universal.bundle \
  || { echo "APK carries a stale worklet bundle; delete android/app/build and rebuild" >&2; exit 1; }
ls -la android/app/build/outputs/apk/debug/app-debug.apk
