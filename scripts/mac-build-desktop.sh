#!/usr/bin/env zsh
# Runs ON the Mac Mini (called by scripts/build-desktop-mac.sh): install,
# stage, build the desktop app with electron-builder, and with SIGN=1 sign
# and notarize it from the build keychain.
#   ARCH=arm64|x64  SIGN=0|1  NOTARY_PROFILE=<notarytool profile>
#   BUILD_VERSION=<x.y.z> labels the build as another version (testing updates)
set -e
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ARCH="${ARCH:-arm64}"
KC="$HOME/Library/Keychains/buildkey.keychain-db"

cd "$ROOT/../peerloom-core" && npm install --no-audit --no-fund --silent
cd "$ROOT" && npm install --no-audit --no-fund --silent
npm install --prefix desktop --no-audit --no-fund --silent
node scripts/stage-desktop.js --platform darwin --arch "$ARCH"

cd desktop && rm -rf dist
VERSION_ARGS=()
[ -n "${BUILD_VERSION:-}" ] && VERSION_ARGS=("-c.extraMetadata.version=$BUILD_VERSION")
if [ "${SIGN:-0}" = "1" ]; then
  security unlock-keychain -p "" "$KC"
  security list-keychains -s "$KC" "$HOME/Library/Keychains/login.keychain-db" /Library/Keychains/System.keychain
  security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "" "$KC" >/dev/null 2>&1 || true
  CSC_KEYCHAIN="$KC" CSC_NAME="Timothy Hudgins (G79ALD29NA)" \
  APPLE_KEYCHAIN_PROFILE="${NOTARY_PROFILE:-pearcircle-seeder-notary}" APPLE_KEYCHAIN="$KC" \
    npx electron-builder --mac "--$ARCH" --publish never "${VERSION_ARGS[@]}"
  APPDIR=$([ "$ARCH" = "arm64" ] && echo mac-arm64 || echo mac)
  codesign --verify --deep --strict "dist/$APPDIR/PearOffice.app" && echo "codesign ok"
  xcrun stapler validate "dist/$APPDIR/PearOffice.app"
  spctl -a -vv "dist/$APPDIR/PearOffice.app" 2>&1 | head -3
else
  CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac "--$ARCH" --publish never "${VERSION_ARGS[@]}"
fi
