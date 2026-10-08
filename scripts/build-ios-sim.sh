#!/usr/bin/env bash
# Build PearOffice for the iOS Simulator on the Mac Mini and launch it.
# Suite rule 7: iOS testing starts on a Simulator.
#
# Syncs this repo and ../peerloom-core to ~/peerloomllc/pearoffice-build on the
# Mac (the folder the desktop build uses), installs, builds the iOS worklet
# bundle and the WebView UI, runs expo prebuild and CocoaPods, builds a
# Release Simulator app without signing, then boots the PearOfficeBench
# simulator, installs and launches it.
#
# Usage: scripts/build-ios-sim.sh            Drive it with ../pearlist/scripts/sim-drive.sh
#        SIM_NAME=PearOfficeBench BUNDLE_ID=com.pearoffice ../pearlist/scripts/sim-drive.sh dump
set -euo pipefail

MAC="${MAC_MINI_HOST:-Tims-Mac-mini.local}"
REMOTE="peerloomllc/pearoffice-build"
SIM="${SIM_NAME:-PearOfficeBench}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RSYNC_PATH="/opt/homebrew/bin/rsync"

ssh -o BatchMode=yes -o ConnectTimeout=6 "$MAC" exit || { echo "cannot reach $MAC" >&2; exit 1; }
ssh -o BatchMode=yes "$MAC" "mkdir -p ~/$REMOTE/pearoffice ~/$REMOTE/peerloom-core"
EXCLUDES=(--exclude node_modules --exclude dist --exclude 'desktop/dist' --exclude 'desktop/build/resources' --exclude '.git' --exclude 'spikes/*/tmp' --exclude 'spikes/*/pack' --exclude '/ios' --exclude '/android')
EXCLUDES+=(--exclude '/*.apk' --exclude '/*.aab' --exclude '/*.AppImage' --exclude '/*.deb' --exclude '/*.exe' --exclude '/*.dmg' --exclude '/*.ipa' --exclude '/*.sha256' --exclude '/*.blockmap' --exclude '/latest*.yml')
echo "==> sync source"
rsync -a --delete --rsync-path="$RSYNC_PATH" "${EXCLUDES[@]}" "$ROOT/" "$MAC:$REMOTE/pearoffice/"
rsync -a --delete --rsync-path="$RSYNC_PATH" --exclude node_modules --exclude .git "$ROOT/../peerloom-core/" "$MAC:$REMOTE/peerloom-core/"

echo "==> install, bundle, prebuild, pods, build (Simulator)"
ssh -o BatchMode=yes "$MAC" "zsh -lc 'set -e
  export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8
  cd ~/$REMOTE/peerloom-core && npm install --no-audit --no-fund --silent
  cd ~/$REMOTE/pearoffice && npm install --no-audit --no-fund --silent
  npm run build:bare:ios >/dev/null
  npm run build:ui:mobile >/dev/null
  # Every time, so app.json changes (Info.plist strings, plugins) reach the build.
  npx expo prebuild --platform ios --no-install >/dev/null
  (cd ios && pod install >/dev/null)
  xcodebuild -workspace ios/PearOffice.xcworkspace -scheme PearOffice -configuration Release \\
    -destination \"generic/platform=iOS Simulator\" -sdk iphonesimulator -derivedDataPath build/ios-sim \\
    CODE_SIGNING_ALLOWED=NO 2>&1 | tail -3
'"

echo "==> boot $SIM, install, launch"
ssh -o BatchMode=yes "$MAC" "zsh -lc 'set -e
  APP=\$(ls -d ~/$REMOTE/pearoffice/build/ios-sim/Build/Products/Release-iphonesimulator/PearOffice.app)
  UDID=\$(xcrun simctl list devices available | grep -E \"^ *$SIM \\\\(\" | head -1 | sed -E \"s/.*\\\\(([0-9A-Fa-f-]{36})\\\\).*/\\\\1/\" || true)
  if [ -z \"\$UDID\" ]; then
    RUNTIME=\$(xcrun simctl list runtimes | awk \"/^iOS /{print \\\$NF}\" | tail -1)
    UDID=\$(xcrun simctl create $SIM com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro \"\$RUNTIME\")
  fi
  xcrun simctl boot \"\$UDID\" 2>/dev/null || true
  xcrun simctl bootstatus \"\$UDID\" -b >/dev/null
  xcrun simctl install \"\$UDID\" \"\$APP\"
  xcrun simctl launch \"\$UDID\" com.pearoffice
  echo \"launched on \$UDID\"
'"
