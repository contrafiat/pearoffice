#!/usr/bin/env bash
# Build and smoke-test the macOS desktop app on the Mac Mini over SSH.
#
# Syncs this repo and ../peerloom-core to an isolated folder on the Mac
# (~/peerloomllc/pearsheet-build, so other apps' copies are untouched),
# installs, stages the resources for darwin-<arch>, runs electron-builder,
# runs the packaged smoke test there and copies the dmg and zip back to
# desktop/dist/.
#
# Usage: scripts/build-desktop-mac.sh [arm64|x64]     (default arm64)
#
# Unsigned unless SIGN=1. Signing and notarizing need the Mac's login keychain
# unlocked, which cannot be done from here.
set -euo pipefail

ARCH="${1:-arm64}"
MAC="${MAC_MINI_HOST:-Tims-Mac-mini.local}"
REMOTE="peerloomllc/pearsheet-build"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RSYNC_PATH="/opt/homebrew/bin/rsync"

ssh -o BatchMode=yes -o ConnectTimeout=6 "$MAC" exit || { echo "cannot reach $MAC" >&2; exit 1; }

EXCLUDES=(--exclude node_modules --exclude dist --exclude 'desktop/dist' --exclude 'desktop/build/resources' --exclude '.git' --exclude 'spikes/*/tmp' --exclude 'spikes/*/pack')
echo "==> sync source"
ssh -o BatchMode=yes "$MAC" "mkdir -p ~/$REMOTE/pearsheet ~/$REMOTE/peerloom-core"
rsync -a --delete --rsync-path="$RSYNC_PATH" "${EXCLUDES[@]}" "$ROOT/" "$MAC:$REMOTE/pearsheet/"
rsync -a --delete --rsync-path="$RSYNC_PATH" --exclude node_modules --exclude .git "$ROOT/../peerloom-core/" "$MAC:$REMOTE/peerloom-core/"

SIGN_ENV="CSC_IDENTITY_AUTO_DISCOVERY=false"
[ "${SIGN:-0}" = "1" ] && SIGN_ENV=""

echo "==> install, stage, build on the Mac ($ARCH)"
ssh -o BatchMode=yes "$MAC" "zsh -lc 'set -e
  cd ~/$REMOTE/peerloom-core && npm install --no-audit --no-fund --silent
  cd ~/$REMOTE/pearsheet && npm install --no-audit --no-fund --silent
  npm install --prefix desktop --no-audit --no-fund --silent
  node scripts/stage-desktop.js --platform darwin --arch $ARCH
  cd desktop && rm -rf dist && $SIGN_ENV npx electron-builder --mac --$ARCH --publish never
'"

echo "==> packaged smoke on the Mac"
APP_DIR=$([ "$ARCH" = "arm64" ] && echo mac-arm64 || echo mac)
ssh -o BatchMode=yes "$MAC" "zsh -lc 'cd ~/$REMOTE/pearsheet && node scripts/smoke-packaged.js desktop/dist/$APP_DIR/PearSheet.app/Contents/MacOS/PearSheet /tmp/pearsheet-mac-smoke.png'"

echo "==> copy installers back"
mkdir -p "$ROOT/desktop/dist"
scp -q "$MAC:$REMOTE/pearsheet/desktop/dist/*.dmg" "$MAC:$REMOTE/pearsheet/desktop/dist/*.zip" "$ROOT/desktop/dist/"
scp -q "$MAC:/tmp/pearsheet-mac-smoke.png" "$ROOT/desktop/dist/mac-smoke-$ARCH.png" || true
ls -la "$ROOT/desktop/dist/" | grep -E 'mac|dmg'
