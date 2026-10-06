#!/usr/bin/env bash
# Publish a PearOffice release on peerloomllc/pearoffice-releases, where the
# desktop app and the seeder download look for updates
# (proposals/2026-10-05-update-checker.md).
#
# Builds nothing. Run the dist scripts for this version first:
#   npm run dist:linux && npm run dist:mac && npm run dist:mac:intel && npm run dist:windows && npm run dist:seeder
# This checks every file is there and carries the version, writes a .sha256
# next to each (the apps install nothing that does not match it) and creates
# the release.
#
# Usage: scripts/release.sh <notes-file> [version]     DRY_RUN=1 stops before publishing
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
REPO="${RELEASE_REPO:-peerloomllc/pearoffice-releases}"
NOTES="${1:?usage: scripts/release.sh <notes-file> [version]}"
VERSION="${2:-$(node -p "require('./package.json').version")}"
DESKTOP_VERSION="$(node -p "require('./desktop/package.json').version")"
[ -f "$NOTES" ] || { echo "no notes file at $NOTES" >&2; exit 1; }
[ "$VERSION" = "$DESKTOP_VERSION" ] || { echo "package.json is $VERSION but desktop/package.json is $DESKTOP_VERSION" >&2; exit 1; }

FILES=(
  "desktop/dist/pearoffice-$VERSION-linux-x86_64.AppImage"
  "desktop/dist/pearoffice-$VERSION-linux-amd64.deb"
  "desktop/dist/PearOffice-$VERSION-mac-arm64.dmg"
  "desktop/dist/PearOffice-$VERSION-mac-arm64.zip"
  "desktop/dist/PearOffice-$VERSION-mac-x64.dmg"
  "desktop/dist/PearOffice-$VERSION-mac-x64.zip"
  "desktop/dist/PearOffice-Setup-$VERSION.exe"
  "dist/seeder-pkg/pearoffice-seeder-$VERSION-linux-x64.tar.gz"
  "dist/seeder-pkg/pearoffice-seeder-$VERSION-linux-arm64.tar.gz"
)
missing=0
for f in "${FILES[@]}"; do
  [ -f "$f" ] || { echo "missing $f" >&2; missing=1; }
done
[ "$missing" = 0 ] || { echo "build the missing files first (see the top of this script)" >&2; exit 1; }

ASSETS=()
for f in "${FILES[@]}"; do
  (cd "$(dirname "$f")" && sha256sum "$(basename "$f")" > "$(basename "$f").sha256")
  ASSETS+=("$f" "$f.sha256")
  echo "$(cut -c1-16 "$f.sha256")...  $(basename "$f")"
done

if [ "${DRY_RUN:-0}" = 1 ]; then
  echo "dry run: would publish v$VERSION on $REPO with ${#ASSETS[@]} files"
  exit 0
fi
gh release create "v$VERSION" -R "$REPO" --title "PearOffice $VERSION" --notes-file "$NOTES" "${ASSETS[@]}"
echo "published https://github.com/$REPO/releases/tag/v$VERSION"
