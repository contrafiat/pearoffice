#!/usr/bin/env bash
# Publish the Android release to Zapstore, as PearPetal's release.sh does:
# link the 'pearoffice' signing key to PeerLoom's Nostr identity, add the
# release notes and the local APK to zapstore.yaml for this run, then
# `zsp publish`. Needs scripts/build-android-release.sh run first and
# scripts/.env with SIGN_WITH (the Zapstore nsec) and the keystore entries.
#
# Usage: scripts/publish-zapstore.sh <notes-file>     DRY_RUN=1 stops before publishing
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
NOTES="${1:?usage: scripts/publish-zapstore.sh <notes-file>}"
set -a; . scripts/.env; set +a
: "${SIGN_WITH:?SIGN_WITH (Zapstore nsec) missing from scripts/.env}"
VERSION=$(node -p "require('./app.json').expo.version")
APK="$PWD/dist/android/pearoffice-$VERSION.apk"
[ -f "$APK" ] || { echo "no $APK: run scripts/build-android-release.sh" >&2; exit 1; }

BAK=$(mktemp)
cp zapstore.yaml "$BAK"
P12="$(mktemp -d)/pearoffice.p12"
trap 'cp "$BAK" zapstore.yaml; rm -rf "$BAK" "$(dirname "$P12")"' EXIT
{ echo "release_notes: $(realpath "$NOTES")"; echo "release_source: $APK"; cat "$BAK"; } > zapstore.yaml
if [ "${DRY_RUN:-0}" = 1 ]; then echo "dry run: would publish PearOffice $VERSION to Zapstore"; head -3 zapstore.yaml; exit 0; fi

keytool -importkeystore -srckeystore "$KEYSTORE_FILE" -srcalias "$KEY_ALIAS" -srcstorepass "$KEYSTORE_PASSWORD" -srckeypass "$KEY_PASSWORD" \
  -destkeystore "$P12" -deststoretype PKCS12 -deststorepass "$KEYSTORE_PASSWORD" -noprompt 2>/dev/null
SIGN_WITH="$SIGN_WITH" KEYSTORE_PASSWORD="$KEYSTORE_PASSWORD" zsp identity --link-key "$P12" || echo "identity link returned non-zero (may already be linked)"
APP_VERSION="$VERSION" GITHUB_TOKEN="$(gh auth token)" SIGN_WITH="$SIGN_WITH" zsp publish -y zapstore.yaml
echo "published PearOffice $VERSION to Zapstore"
