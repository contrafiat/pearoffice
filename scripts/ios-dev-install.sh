#!/usr/bin/env bash
# Build, sign and install PearSheet on the iPhone SE.
#
# The Mac Mini builds and signs (development, automatic signing through the
# build keychain, the same setup as pearlist/scripts/ios-dev-install.sh); the
# install runs here, because the iPhone is USB-cabled to this Linux machine.
#
# Usage: scripts/ios-dev-install.sh        SKIP_BUILD=1 reinstalls the last IPA
set -euo pipefail

MAC="${MAC_MINI_HOST:-Tims-Mac-mini.local}"
REMOTE="peerloomllc/pearsheet-build"
TEAM_ID="${TEAM_ID:-G79ALD29NA}"
KEYCHAIN="${KEYCHAIN_PATH:-~/Library/Keychains/buildkey.keychain}"
ARCHIVE=/tmp/PearSheet.xcarchive
EXPORT=/tmp/PearSheet-dev
LOCAL_IPA=/tmp/PearSheet-dev/PearSheet.ipa
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RSYNC_PATH="/opt/homebrew/bin/rsync"

if [ "${SKIP_BUILD:-0}" != "1" ]; then
  ssh -o BatchMode=yes -o ConnectTimeout=6 "$MAC" exit || { echo "cannot reach $MAC (locked?)" >&2; exit 1; }
  echo "==> sync"
  ssh -o BatchMode=yes "$MAC" "mkdir -p ~/$REMOTE/pearsheet ~/$REMOTE/peerloom-core"
  rsync -a --delete --rsync-path="$RSYNC_PATH" --exclude node_modules --exclude dist --exclude 'desktop/dist' --exclude 'desktop/build/resources' --exclude .git --exclude 'spikes/*/tmp' --exclude 'spikes/*/pack' --exclude '/ios' --exclude '/android' --exclude '/build' "$ROOT/" "$MAC:$REMOTE/pearsheet/"
  rsync -a --delete --rsync-path="$RSYNC_PATH" --exclude node_modules --exclude .git "$ROOT/../peerloom-core/" "$MAC:$REMOTE/peerloom-core/"

  echo "==> install, bundle, prebuild, pods"
  ssh -o BatchMode=yes "$MAC" "zsh -lc 'set -e
    export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8
    cd ~/$REMOTE/peerloom-core && npm install --no-audit --no-fund --silent
    cd ~/$REMOTE/pearsheet && npm install --no-audit --no-fund --silent
    npm run build:bare:ios >/dev/null && npm run build:ui:mobile >/dev/null
    CI=1 npx expo prebuild -p ios --no-install >/dev/null
    (cd ios && pod install >/dev/null)
  '"

  echo "==> archive and export (development signing)"
  ssh -o BatchMode=yes "$MAC" "bash -lc '
    set -euo pipefail
    cd ~/$REMOTE/pearsheet/ios
    security unlock-keychain -p \"\" $KEYCHAIN
    security list-keychains -s $KEYCHAIN ~/Library/Keychains/login.keychain-db /Library/Keychains/System.keychain
    security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k \"\" $KEYCHAIN >/dev/null 2>&1 || true
    XCODE_PATH=\$(printf %s \"\$PATH\" | sed \"s|/opt/homebrew/bin:||g; s|:/opt/homebrew/bin||g\")
    rm -rf $ARCHIVE $EXPORT
    PATH=\"\$XCODE_PATH\" xcodebuild -workspace PearSheet.xcworkspace -scheme PearSheet -configuration Release \
      -destination generic/platform=iOS -archivePath $ARCHIVE DEVELOPMENT_TEAM=$TEAM_ID CODE_SIGN_STYLE=Automatic \
      -allowProvisioningUpdates archive 2>&1 | grep -E \"error:|ARCHIVE FAILED|ARCHIVE SUCCEEDED\" || true
    printf \"%s\" \"<?xml version=\\\"1.0\\\" encoding=\\\"UTF-8\\\"?><!DOCTYPE plist PUBLIC \\\"-//Apple//DTD PLIST 1.0//EN\\\" \\\"http://www.apple.com/DTDs/PropertyList-1.0.dtd\\\"><plist version=\\\"1.0\\\"><dict><key>method</key><string>development</string><key>teamID</key><string>$TEAM_ID</string><key>signingStyle</key><string>automatic</string></dict></plist>\" > /tmp/PearSheetExportDev.plist
    PATH=\"\$XCODE_PATH\" xcodebuild -exportArchive -archivePath $ARCHIVE -exportPath $EXPORT \
      -exportOptionsPlist /tmp/PearSheetExportDev.plist OTHER_CODE_SIGN_FLAGS=\"--keychain $KEYCHAIN\" 2>&1 | tail -2
    ls $EXPORT/PearSheet.ipa
  '"
  mkdir -p "$(dirname "$LOCAL_IPA")"
  scp -q "$MAC:$EXPORT/PearSheet.ipa" "$LOCAL_IPA"
fi

echo "==> install on the iPhone over USB"
if ! idevicepair validate >/dev/null 2>&1; then
  echo "The iPhone is not paired with this machine: unlock it, tap Trust, then rerun with SKIP_BUILD=1." >&2
  exit 1
fi
ideviceinstaller install "$LOCAL_IPA" | tail -2
idevicedebug -d run com.pearsheet >/dev/null 2>&1 &
DBG=$!; sleep 4; kill "$DBG" 2>/dev/null || true; wait "$DBG" 2>/dev/null || true
echo "done (tap the PearSheet icon if it did not open)"
