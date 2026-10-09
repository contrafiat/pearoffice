#!/usr/bin/env bash
# Build, sign and upload PearOffice to App Store Connect.
#
# Same build as scripts/ios-dev-install.sh on the Mac Mini (sync, bundles,
# prebuild, pods, Release archive), exported for the App Store with the
# "PearOffice Distribution" profile (IOS_APP_STORE, created 2026-10-08 with
# asc and installed on the Mac), then uploaded from here with asc (API key
# in ~/.appstoreconnect). The build number is App Store Connect's next one.
#
# Usage: scripts/ios-appstore.sh        SKIP_BUILD=1 uploads the last IPA
set -euo pipefail

MAC="${MAC_MINI_HOST:-Tims-Mac-mini.local}"
REMOTE="peerloomllc/pearoffice-build"
TEAM_ID="${TEAM_ID:-G79ALD29NA}"
ASC_APP_ID="${ASC_APP_ID:-6820799007}"
KEYCHAIN="${KEYCHAIN_PATH:-~/Library/Keychains/buildkey.keychain}"
ARCHIVE=/tmp/PearOffice-store.xcarchive
EXPORT=/tmp/PearOffice-store
LOCAL_IPA=/tmp/PearOffice-store/PearOffice.ipa
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RSYNC_PATH="/opt/homebrew/bin/rsync"
BUILD=$(asc builds next-build-number --app "$ASC_APP_ID" --platform IOS 2>/dev/null | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('nextBuildNumber') or d.get('data',{}).get('nextBuildNumber') or '')" 2>/dev/null || true)
BUILD="${BUILD:-$(node -p "require('$ROOT/app.json').expo.ios.buildNumber")}"
echo "==> build number $BUILD"

if [ "${SKIP_BUILD:-0}" != "1" ]; then
  ssh -o BatchMode=yes -o ConnectTimeout=6 "$MAC" exit || { echo "cannot reach $MAC (locked?)" >&2; exit 1; }
  echo "==> sync"
  ssh -o BatchMode=yes "$MAC" "mkdir -p ~/$REMOTE/pearoffice ~/$REMOTE/peerloom-core"
  rsync -a --delete --rsync-path="$RSYNC_PATH" --exclude node_modules --exclude dist --exclude 'desktop/dist' --exclude 'desktop/build/resources' --exclude .git --exclude 'spikes/*/tmp' --exclude 'spikes/*/pack' --exclude '/ios' --exclude '/android' --exclude '/build' --exclude '/*.apk' --exclude '/*.aab' --exclude '/*.AppImage' --exclude '/*.deb' --exclude '/*.exe' --exclude '/*.dmg' --exclude '/*.ipa' --exclude '/*.sha256' --exclude '/*.blockmap' --exclude '/latest*.yml' "$ROOT/" "$MAC:$REMOTE/pearoffice/"
  rsync -a --delete --rsync-path="$RSYNC_PATH" --exclude node_modules --exclude .git "$ROOT/../peerloom-core/" "$MAC:$REMOTE/peerloom-core/"

  echo "==> install, bundle, prebuild, pods"
  ssh -o BatchMode=yes "$MAC" "zsh -lc 'set -e
    export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8
    cd ~/$REMOTE/peerloom-core && npm install --no-audit --no-fund --silent
    cd ~/$REMOTE/pearoffice && npm install --no-audit --no-fund --silent
    npm run build:bare:ios >/dev/null && npm run build:ui:mobile >/dev/null
    CI=1 npx expo prebuild -p ios --no-install >/dev/null
    (cd ios && pod install >/dev/null)
  '"

  echo "==> archive and export (App Store signing)"
  ssh -o BatchMode=yes "$MAC" "bash -lc '
    set -euo pipefail
    cd ~/$REMOTE/pearoffice/ios
    security unlock-keychain -p \"\" $KEYCHAIN
    security list-keychains -s $KEYCHAIN ~/Library/Keychains/login.keychain-db /Library/Keychains/System.keychain
    security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k \"\" $KEYCHAIN >/dev/null 2>&1 || true
    XCODE_PATH=\$(printf %s \"\$PATH\" | sed \"s|/opt/homebrew/bin:||g; s|:/opt/homebrew/bin||g\")
    rm -rf $ARCHIVE $EXPORT
    PATH=\"\$XCODE_PATH\" xcodebuild -workspace PearOffice.xcworkspace -scheme PearOffice -configuration Release \
      -destination generic/platform=iOS -archivePath $ARCHIVE DEVELOPMENT_TEAM=$TEAM_ID CODE_SIGN_STYLE=Automatic CURRENT_PROJECT_VERSION=$BUILD \
      -allowProvisioningUpdates archive 2>&1 | grep -E \"error:|ARCHIVE FAILED|ARCHIVE SUCCEEDED\" || true
    printf \"%s\" \"<?xml version=\\\"1.0\\\" encoding=\\\"UTF-8\\\"?><!DOCTYPE plist PUBLIC \\\"-//Apple//DTD PLIST 1.0//EN\\\" \\\"http://www.apple.com/DTDs/PropertyList-1.0.dtd\\\"><plist version=\\\"1.0\\\"><dict><key>method</key><string>app-store-connect</string><key>teamID</key><string>$TEAM_ID</string><key>provisioningProfiles</key><dict><key>com.pearoffice</key><string>PearOffice Distribution</string></dict><key>signingCertificate</key><string>Apple Distribution</string><key>signingStyle</key><string>manual</string></dict></plist>\" > /tmp/PearOfficeExportStore.plist
    PATH=\"\$XCODE_PATH\" xcodebuild -exportArchive -archivePath $ARCHIVE -exportPath $EXPORT \
      -exportOptionsPlist /tmp/PearOfficeExportStore.plist OTHER_CODE_SIGN_FLAGS=\"--keychain $KEYCHAIN\" 2>&1 | tail -2
    ls $EXPORT/PearOffice.ipa
  '"
  mkdir -p "$(dirname "$LOCAL_IPA")"
  scp -q "$MAC:$EXPORT/PearOffice.ipa" "$LOCAL_IPA"
fi

echo "==> upload to App Store Connect"
ASC_UPLOAD_TIMEOUT="${ASC_UPLOAD_TIMEOUT:-1200s}" asc builds upload --app "$ASC_APP_ID" --ipa "$LOCAL_IPA" | python3 -c "import json,sys;print(json.dumps(json.load(sys.stdin))[:300])"
echo "uploaded; App Store Connect processes the build in a few minutes"
