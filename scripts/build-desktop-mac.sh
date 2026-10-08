#!/usr/bin/env bash
# Build and smoke-test the macOS desktop app on the Mac Mini over SSH.
#
# Syncs this repo and ../peerloom-core to an isolated folder on the Mac
# (~/peerloomllc/pearoffice-build, so other apps' copies are untouched),
# installs, stages the resources for darwin-<arch>, runs electron-builder,
# runs the packaged smoke test there and copies the dmg and zip back to
# desktop/dist/.
#
# Usage: scripts/build-desktop-mac.sh [arm64|x64]     (default arm64)
#
# Unsigned unless SIGN=1. With SIGN=1 it signs with the Developer ID
# Application certificate and notarizes with a notarytool profile, both kept
# in the Mac's build keychain (empty password, so it works over SSH; the same
# keychain PearCircle's seeder build uses). NOTARY_PROFILE picks the profile.
set -euo pipefail

ARCH="${1:-arm64}"
MAC="${MAC_MINI_HOST:-Tims-Mac-mini.local}"
REMOTE="peerloomllc/pearoffice-build"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RSYNC_PATH="/opt/homebrew/bin/rsync"

ssh -o BatchMode=yes -o ConnectTimeout=6 "$MAC" exit || { echo "cannot reach $MAC" >&2; exit 1; }

EXCLUDES=(--exclude node_modules --exclude dist --exclude 'desktop/dist' --exclude 'desktop/build/resources' --exclude '.git' --exclude 'spikes/*/tmp' --exclude 'spikes/*/pack')
EXCLUDES+=(--exclude '/*.apk' --exclude '/*.aab' --exclude '/*.AppImage' --exclude '/*.deb' --exclude '/*.exe' --exclude '/*.dmg' --exclude '/*.ipa' --exclude '/*.sha256' --exclude '/*.blockmap' --exclude '/latest*.yml')
echo "==> sync source"
ssh -o BatchMode=yes "$MAC" "mkdir -p ~/$REMOTE/pearoffice ~/$REMOTE/peerloom-core"
rsync -a --delete --rsync-path="$RSYNC_PATH" "${EXCLUDES[@]}" "$ROOT/" "$MAC:$REMOTE/pearoffice/"
rsync -a --delete --rsync-path="$RSYNC_PATH" --exclude node_modules --exclude .git "$ROOT/../peerloom-core/" "$MAC:$REMOTE/peerloom-core/"

echo "==> install, stage, build on the Mac ($ARCH, SIGN=${SIGN:-0})"
ssh -o BatchMode=yes "$MAC" "zsh -lc 'cd ~/$REMOTE/pearoffice && ARCH=$ARCH BUILD_VERSION=${BUILD_VERSION:-} SIGN=${SIGN:-0} NOTARY_PROFILE=${NOTARY_PROFILE:-pearcircle-seeder-notary} ./scripts/mac-build-desktop.sh'"

echo "==> packaged smoke on the Mac"
APP_DIR=$([ "$ARCH" = "arm64" ] && echo mac-arm64 || echo mac)
ssh -o BatchMode=yes "$MAC" "zsh -lc 'cd ~/$REMOTE/pearoffice && node scripts/smoke-packaged.js desktop/dist/$APP_DIR/PearOffice.app/Contents/MacOS/PearOffice /tmp/pearoffice-mac-smoke.png'"

echo "==> copy installers back"
mkdir -p "$ROOT/desktop/dist"
scp -q "$MAC:$REMOTE/pearoffice/desktop/dist/*.dmg" "$MAC:$REMOTE/pearoffice/desktop/dist/*.zip" "$ROOT/desktop/dist/"
scp -q "$MAC:/tmp/pearoffice-mac-smoke.png" "$ROOT/desktop/dist/mac-smoke-$ARCH.png" || true
ls -la "$ROOT/desktop/dist/" | grep -E 'mac|dmg'
