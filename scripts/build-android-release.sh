#!/usr/bin/env bash
# Build the signed Android release: an arm64 APK (Zapstore, GitHub) and an
# app bundle (Google Play), into dist/android/. Signed with the 'pearoffice'
# key in the shared keystore; the credentials come from scripts/.env
# (KEYSTORE_FILE, KEYSTORE_PASSWORD, KEY_ALIAS, KEY_PASSWORD; gitignored),
# read by plugins/with-android-release-signing.js.
#
# Usage: scripts/build-android-release.sh
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
[ -f scripts/.env ] || { echo "no scripts/.env with the signing credentials" >&2; exit 1; }
set -a; . scripts/.env; set +a
VERSION=$(node -p "require('./app.json').expo.version")
CODE=$(node -p "require('./app.json').expo.android.versionCode")

npm run build:bare:mobile
npm run build:ui:mobile
# Every time: the signing config lives in the generated build.gradle.
npx expo prebuild --platform android --no-install
(cd android && ./gradlew assembleRelease bundleRelease -PreactNativeArchitectures=arm64-v8a)

OUT=dist/android
mkdir -p "$OUT"
cp android/app/build/outputs/apk/release/app-release.apk "$OUT/pearoffice-$VERSION.apk"
cp android/app/build/outputs/bundle/release/app-release.aab "$OUT/pearoffice-$VERSION.aab"

# Refuse a build signed with anything but the PearOffice key (the plugin
# falls back to the debug key when the credentials are missing).
APKSIGNER=$(ls -d "${ANDROID_HOME:-$HOME/Android/Sdk}"/build-tools/*/apksigner | sort -V | tail -1)
"$APKSIGNER" verify --print-certs "$OUT/pearoffice-$VERSION.apk" | grep -q "CN=PearOffice, O=PeerLoom LLC" \
  || { echo "the APK is not signed with the PearOffice key" >&2; exit 1; }
jarsigner -verify "$OUT/pearoffice-$VERSION.aab" >/dev/null || { echo "the bundle is not signed" >&2; exit 1; }
keytool -printcert -jarfile "$OUT/pearoffice-$VERSION.aab" | grep -q "CN=PearOffice" || { echo "the bundle is not signed with the PearOffice key" >&2; exit 1; }
ls -la "$OUT"/pearoffice-"$VERSION".*
echo "built $VERSION ($CODE), signed with the PearOffice key"
