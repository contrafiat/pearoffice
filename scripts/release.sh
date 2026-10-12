#!/usr/bin/env bash
# Local release script (app-specific config in scripts/app.conf)
# Usage: ./scripts/release.sh [vX.Y.Z] [--retag] [--check-versions]
#
# Canonical shape: /home/tim/peerloomllc/RELEASE-PIPELINE.md, enforced by
# ./check-release-pipeline.sh pearoffice. Step numbers are the contract: a
# capability PearOffice does not have leaves its number UNUSED rather than
# renumbering what follows. PearOffice has no step 4 (the Android build names
# its files inline in step 3) and no 5b2 (one desktop/ project builds every
# desktop target in step 5b).
#
# Every platform in one run: Android (APK and app bundle), iOS, the desktop
# app for Mac (Apple silicon and Intel, signed and notarized), Linux and
# Windows, the Linux seeder download, the Umbrel image and the StartOS .s9pk.
# The downloads go on the public peerloomllc/pearoffice-releases repo; the tag
# goes on this (private) one.
#
# Flags:
#   vX.Y.Z             Override the auto-detected version
#   --retag            Delete and recreate a stranded local tag from a failed run
#   --check-versions   Query every published channel and exit (no build)
#   --skip-github      Skip the GitHub release
#   --skip-zapstore    Skip Zapstore publish
#   --skip-play        Skip Google Play upload even if credentials are configured
#   --skip-appstore    Skip iOS App Store build (alias: --skip-ios)
#   --skip-nostr       Skip Nostr announcement even if selected
#   --skip-desktop     Skip building all desktop installers
#   --skip-linux       Skip Linux desktop build (.AppImage + .deb)
#   --skip-windows     Skip Windows desktop build (.exe)
#   --skip-macos       Skip macOS desktop builds (.dmg + .zip, both chips)
#   --skip-seeder      Skip the Linux seeder download
#   --skip-seeder-store Skip the Umbrel image and the StartOS .s9pk
#                      (aliases: --skip-umbrel, --skip-start9)
#   --skip-android     Skip Android APK/AAB build (auto-disables Play + Zapstore;
#                      the GitHub release re-attaches the previous APK)
#   --skip-mobile      Skip both Android and iOS builds (shorthand)
#
# Required env vars (or set in scripts/.env):
#   KEYSTORE_PASSWORD            - release keystore password
#   KEY_PASSWORD                 - release key password
#   KEYSTORE_FILE                - path to the keystore
#   KEY_ALIAS                    - key alias (pearoffice)
#   SIGN_WITH                    - Zapstore NSEC for signing
#
# Optional env vars:
#   GITHUB_TOKEN                 - GitHub PAT (falls back to gh auth token)
#   GITHUB_REMOTE                - git remote name (default: github, then origin)
#   PLAY_SERVICE_ACCOUNT_JSON    - path to GCP service account JSON for Play upload
#   PLAY_TRACK                   - Play track: internal / alpha / beta / production
#                                  (default: alpha, the closed test)
#   PLAY_QUOTA_PROJECT           - GCP project ID for Play API quota when using ADC
#   ASC_KEY_ID                   - App Store Connect API key ID
#   ASC_ISSUER_ID                - App Store Connect API issuer ID
#   ASC_PRIVATE_KEY_PATH         - Path to .p8 private key file
#   WINDOWS_VM_HOST              - ssh target of the win11-pearguard VM
#   NOSTR_NOTE_BUDGET            - characters of notes in the Nostr note (900)
#
# Needs: gh, asc, podman and skopeo (ghcr login), start-cli-1.1.0, the Mac
# Mini, and clones of the sibling repos ../website, ../peerloom-umbrel-app-store
# and ../umbrel-apps (PeerLoom's fork).

set -euo pipefail

# Abort cleanly on Ctrl-C. Several best-effort build steps run as the
# condition of an `if` (so a failed build never blocks the release), which
# also means a SIGINT during one of them is otherwise swallowed and the
# script marches on past the interrupted build.
trap 'echo; echo "Interrupted (SIGINT) - aborting release."; exit 130' INT

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PEERLOOM="$(dirname "$REPO_ROOT")"

# Shared release helpers, one copy for every PeerLoom app, in the sibling repo
# peerloomllc/peerloom-release (proposals/2026-09-17-shared-release-library.md).
RELEASE_LIB="$REPO_ROOT/../peerloom-release/release-lib.sh"
if [ ! -f "$RELEASE_LIB" ]; then
  echo "error: $RELEASE_LIB not found - clone peerloomllc/peerloom-release beside this repo" >&2
  exit 1
fi
# shellcheck source=/dev/null
source "$RELEASE_LIB"

# Pin JDK 21 for the Android build, as the other apps do. RN's Gradle plugin
# does not support JDK 25 (Fedora 44's default). Export JAVA_HOME to override.
if [ -z "${JAVA_HOME:-}" ] && [ -x "$HOME/.jdks/jdk-21.0.11+10/bin/java" ]; then
  export JAVA_HOME="$HOME/.jdks/jdk-21.0.11+10"
  export PATH="$JAVA_HOME/bin:$PATH"
fi

# Load app config and env
if [ -f "$SCRIPT_DIR/app.conf" ]; then
  set -a; source "$SCRIPT_DIR/app.conf"; set +a
fi
if [ -f "$SCRIPT_DIR/.env" ]; then
  set -a; source "$SCRIPT_DIR/.env"; set +a
fi

# Required app.conf keys, checked once, up front. No hard-coded defaults: a
# copied default is how PearGuard once announced itself as PearCal.
for _k in APP_NAME ARTIFACT_PREFIX BUNDLE_ID RELEASES_REPO ASC_APP_ID UMBREL_IMAGE; do
  if [ -z "${!_k:-}" ]; then
    echo "error: $_k is not set — check $SCRIPT_DIR/app.conf" >&2
    exit 1
  fi
done

# ---------------------------------------------------------------------------
# Helper: the version the App Store has, including TestFlight and in review
# (asc), else the live one (iTunes lookup). Returns bare X.Y.Z or "".
# ---------------------------------------------------------------------------
_appstore_latest_version() {
  local ver=""
  if command -v asc &>/dev/null; then
    ver=$(asc versions list --app "$ASC_APP_ID" --output json 2>/dev/null \
      | python3 -c "
import sys, json
d = json.load(sys.stdin)
items = d.get('data', d) if isinstance(d, dict) else d
vs = [x.get('attributes', x).get('versionString', '') for x in items or []]
vs = [v for v in vs if v]
vs.sort(key=lambda v: tuple(int(x) for x in v.split('.') if x.isdigit()), reverse=True)
print(vs[0] if vs else '')
" 2>/dev/null || echo "")
  fi
  if [ -z "$ver" ]; then
    ver=$(curl -sf --max-time 8 "https://itunes.apple.com/lookup?bundleId=${BUNDLE_ID}" 2>/dev/null \
      | python3 -c "import sys,json; r=json.load(sys.stdin).get('results',[]); print(r[0].get('version','') if r else '')" \
      2>/dev/null || echo "")
  fi
  printf '%s' "$ver"
}

# ---------------------------------------------------------------------------
# Helper: the highest X.Y.Z tag of the seeder image on ghcr (public, so an
# anonymous pull token is enough). Returns "" when unknown.
# ---------------------------------------------------------------------------
_umbrel_latest_version() {
  local host="${UMBREL_IMAGE%%/*}" repo="${UMBREL_IMAGE#*/}" token
  token=$(curl -s --max-time 8 "https://${host}/token?scope=repository:${repo}:pull" 2>/dev/null \
    | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null || echo "")
  [ -z "$token" ] && return 0
  curl -s --max-time 8 -H "Authorization: Bearer $token" "https://${host}/v2/${repo}/tags/list" 2>/dev/null \
    | python3 -c "
import sys, json
best = ()
for t in json.load(sys.stdin).get('tags', []) or []:
    p = tuple(int(x) for x in t.lstrip('v').split('.') if x.isdigit())
    if len(p) == 3 and p > best: best = p
print('.'.join(map(str, best)) if best else '')
" 2>/dev/null || echo ""
}

# ---------------------------------------------------------------------------
# Helper: a fresh checkout of <repo>'s <remote>/<base> on <branch>, in a
# temporary folder removed on exit. Sets WT to the folder.
# ---------------------------------------------------------------------------
WORKTREES=()
_worktree_cleanup() {
  local w
  for w in "${WORKTREES[@]:-}"; do
    [ -n "$w" ] && git -C "${w%%|*}" worktree remove --force "${w#*|}" 2>/dev/null
  done
  return 0
}
trap _worktree_cleanup EXIT
_worktree() {
  local repo="$1" remote="$2" base="$3" branch="$4"
  WT="$(mktemp -d)/wt"
  git -C "$repo" fetch -q "$remote"
  git -C "$repo" worktree add -q -B "$branch" "$WT" "$remote/$base"
  WORKTREES+=("$repo|$WT")
}

# ---------------------------------------------------------------------------
# Helper: version, release notes and image digest in an Umbrel app's files.
# Usage: _umbrel_bump <app-dir> <version> <digest> <notes>
# ---------------------------------------------------------------------------
_umbrel_bump() {
  node - "$@" <<'EOF'
const fs = require('fs')
const [dir, v, digest, notes] = process.argv.slice(2)
let app = fs.readFileSync(dir + '/umbrel-app.yml', 'utf8')
app = app.replace(/^version: .*$/m, `version: "${v}"`)
app = app.replace(/^releaseNotes: [\s\S]*?(?=^\S)/m, 'releaseNotes: >-\n' + notes.split('\n').map((l) => (l ? '  ' + l : '')).join('\n') + '\n')
fs.writeFileSync(dir + '/umbrel-app.yml', app)
let compose = fs.readFileSync(dir + '/docker-compose.yml', 'utf8')
compose = compose.replace(/pearoffice-seeder:[\w.]+@sha256:[0-9a-f]+/, `pearoffice-seeder:${v}@${digest}`)
fs.writeFileSync(dir + '/docker-compose.yml', compose)
EOF
}

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------
RELEASE_TAG=""
EXPLICIT_TAG=""
RETAG=false
CHECK_VERSIONS_ONLY=false
SKIP_GITHUB=false
SKIP_ZAPSTORE=false
SKIP_PLAY=false
SKIP_IOS=false
SKIP_NOSTR=false
SKIP_DESKTOP=false
SKIP_LINUX=false
SKIP_WINDOWS=false
SKIP_MACOS=false
SKIP_SEEDER=false
SKIP_SEEDER_STORE=false
SKIP_ANDROID=false

for arg in "$@"; do
  case "$arg" in
    --retag) RETAG=true ;;
    --check-versions) CHECK_VERSIONS_ONLY=true ;;
    --skip-github) SKIP_GITHUB=true ;;
    --skip-zapstore) SKIP_ZAPSTORE=true ;;
    --skip-play) SKIP_PLAY=true ;;
    --skip-appstore|--skip-ios) SKIP_IOS=true ;;
    --skip-nostr) SKIP_NOSTR=true ;;
    --skip-desktop) SKIP_DESKTOP=true ;;
    --skip-linux) SKIP_LINUX=true ;;
    --skip-windows) SKIP_WINDOWS=true ;;
    --skip-macos) SKIP_MACOS=true ;;
    --skip-seeder) SKIP_SEEDER=true ;;
    --skip-seeder-store|--skip-umbrel|--skip-start9) SKIP_SEEDER_STORE=true ;;
    --skip-android) SKIP_ANDROID=true ;;
    --skip-mobile) SKIP_ANDROID=true; SKIP_IOS=true ;;
    v[0-9]*.[0-9]*.[0-9]*)
      if [[ ! "$arg" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        echo "Error: tag must be in format vX.Y.Z (got: $arg)"
        exit 1
      fi
      RELEASE_TAG="$arg"
      EXPLICIT_TAG="$arg"
      ;;
    -h|--help) sed -n '2,57p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown argument: $arg (see --help)"; exit 1 ;;
  esac
done

# A real release must run the reviewed, current shared library (release-lib.sh).
if ! $CHECK_VERSIONS_ONLY; then release_lib_require_current; fi

cd "$REPO_ROOT"

# ---------------------------------------------------------------------------
# Determine release tag — entirely local via git tags
# ---------------------------------------------------------------------------
if [ -z "$RELEASE_TAG" ]; then
  LATEST=$(git tag --sort=-version:refname \
    | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -1 || echo "")
  if [ -z "$LATEST" ]; then
    LATEST="v$(node -p "require('./package.json').version")"
    echo "==> No prior tags found, counting from package.json ($LATEST)"
  fi
  IFS='.' read -r MAJOR MINOR PATCH <<< "${LATEST#v}"
  RELEASE_TAG="v${MAJOR}.${MINOR}.$((PATCH + 1))"
  echo "==> Auto-detected next version: $RELEASE_TAG  (latest tag was $LATEST)"
fi
APP_VERSION="${RELEASE_TAG#v}"

# ---------------------------------------------------------------------------
# Handle --retag: clean up a stranded local tag from a failed previous run
# ---------------------------------------------------------------------------
if $RETAG; then
  if git tag | grep -q "^${RELEASE_TAG}$"; then
    echo "==> --retag: deleting stranded local tag $RELEASE_TAG..."
    git tag -d "$RELEASE_TAG"
    echo "    Done. Proceeding with fresh run for $RELEASE_TAG."
  else
    echo "==> --retag: local tag $RELEASE_TAG not found, nothing to clean up."
  fi
fi

if ! $CHECK_VERSIONS_ONLY; then
  _confirm "Release tag will be $RELEASE_TAG — proceed with build?"
fi

# ---------------------------------------------------------------------------
# Required credentials (skipped for --check-versions)
# ---------------------------------------------------------------------------
if ! $CHECK_VERSIONS_ONLY; then
  : "${KEYSTORE_PASSWORD:?Set KEYSTORE_PASSWORD or add it to scripts/.env}"
  : "${KEY_PASSWORD:?Set KEY_PASSWORD or add it to scripts/.env}"
  : "${KEYSTORE_FILE:?Set KEYSTORE_FILE or add it to scripts/.env}"
  : "${KEY_ALIAS:?Set KEY_ALIAS or add it to scripts/.env}"
  : "${SIGN_WITH:?Set SIGN_WITH (Zapstore NSEC) or add it to scripts/.env}"
  if [ ! -f "$KEYSTORE_FILE" ]; then
    echo "Error: keystore not found at $KEYSTORE_FILE"
    exit 1
  fi
fi

# ---------------------------------------------------------------------------
# Pre-flight: what each channel has published
#
# Outcomes:
#   ZAPSTORE_ONLY=true   GitHub is ahead — skip build, publish existing release
#   ZAPSTORE_ONLY=false  Versions match (or both unknown) — full build + publish
#   exit 1               GitHub is behind Zapstore — something is wrong
# ---------------------------------------------------------------------------
ZAPSTORE_ONLY=false
REPO_SLUG=$(_remote_slug)
GH_TOKEN=$(_github_token)
ZSP_IDENTIFIER="$BUNDLE_ID"

echo "==> Checking published versions..."
GH_VERSION=$(_github_latest_version "$GH_TOKEN" "$RELEASES_REPO")
ZSP_VERSION_CURRENT=$(_zapstore_latest_version "$ZSP_IDENTIFIER")
PLAY_VERSION_CURRENT=$(_play_latest_version "$ZSP_IDENTIFIER" "${PLAY_SERVICE_ACCOUNT_JSON:-}" "${PLAY_TRACK:-alpha}")
ASC_VERSION_CURRENT=$(_appstore_latest_version)
UMBREL_VERSION_CURRENT=$(_umbrel_latest_version)

echo "    GitHub       : ${GH_VERSION:-unknown} ($RELEASES_REPO)"
echo "    Zapstore     : ${ZSP_VERSION_CURRENT:-unknown}"
if _play_configured; then
  echo "    Google Play  : ${PLAY_VERSION_CURRENT:-unknown} (${PLAY_TRACK:-alpha} track)"
else
  echo "    Google Play  : (not configured — uploaded by hand, step 10 prints how)"
fi
echo "    App Store    : ${ASC_VERSION_CURRENT:-unknown}"
echo "    Umbrel (ghcr): ${UMBREL_VERSION_CURRENT:-unknown} ($UMBREL_IMAGE)"

if $CHECK_VERSIONS_ONLY; then
  echo ""
  [ -z "$ZSP_VERSION_CURRENT" ] && echo "    Zapstore returned nothing for $ZSP_IDENTIFIER (not listed yet, relay unreachable or websocat missing)."
  exit 0
fi

if [ -n "$EXPLICIT_TAG" ]; then
  if [ "$GH_VERSION" = "$APP_VERSION" ] && [ "$ZSP_VERSION_CURRENT" != "$APP_VERSION" ]; then
    echo ""
    echo "    $RELEASE_TAG exists on GitHub but not on Zapstore — Zapstore can publish it without a fresh build."
    ZAPSTORE_ONLY=true
  elif [ "$GH_VERSION" != "$APP_VERSION" ]; then
    echo ""
    echo "    $RELEASE_TAG does not exist on GitHub yet — a build will be required."
  fi
elif [ -n "$GH_VERSION" ] && [ -n "$ZSP_VERSION_CURRENT" ]; then
  case "$(_ver_cmp "$GH_VERSION" "$ZSP_VERSION_CURRENT")" in
    gt)
      echo ""
      echo "==> GitHub ($GH_VERSION) is ahead of Zapstore ($ZSP_VERSION_CURRENT)."
      echo "    Skipping build — will publish existing GitHub release to Zapstore only."
      RELEASE_TAG="v${GH_VERSION}"
      APP_VERSION="$GH_VERSION"
      ZAPSTORE_ONLY=true
      ;;
    lt)
      echo ""
      echo "ERROR: Zapstore ($ZSP_VERSION_CURRENT) is ahead of GitHub ($GH_VERSION)."
      echo "       This should not happen. Check both platforms before proceeding."
      echo "       To override, pass the version explicitly: ./scripts/release.sh v${ZSP_VERSION_CURRENT}"
      exit 1
      ;;
    eq) echo "    Versions match ($GH_VERSION) — proceeding with full build for next version." ;;
  esac
else
  echo "    Could not determine one or both versions — proceeding with normal flow."
fi
echo ""

# ---------------------------------------------------------------------------
# Destination selection — ask which targets to publish to before any build
# work starts.
# ---------------------------------------------------------------------------
PUBLISH_GITHUB=true
PUBLISH_ZAPSTORE=true
PUBLISH_NOSTR=true
PUBLISH_PLAY=false
PUBLISH_APP_STORE=false
PUBLISH_FAILED=false   # set to true if any selected publish step fails
APP_STORE_DEFERRED=false
NEEDS_BUILD=false
WINDOWS_ON_VM=false
# Artifacts, declared before the build fences (set -u, read later).
APK_NAME=""
APK_SIZE=""
AAB_NAME=""
AAB_SIZE=""
DESKTOP_ARTIFACTS=()
SEEDER_ARTIFACTS=()
START9_S9PK=""
UMBREL_BUILT=false
STORE_PR_URL=""

_ask() { # _ask <question> <default y|n> -> 0 for yes
  local _r
  while true; do
    # No answer at all (input closed) stops the release, never a default yes.
    read -rp "    $1 $([ "$2" = y ] && echo '[Y/n]' || echo '[y/N]') " _r || { echo; echo "Aborted."; exit 0; }
    _r="${_r:-$2}"
    case "$_r" in [Yy]) return 0 ;; [Nn]) return 1 ;; *) echo "    Please enter y or n." ;; esac
  done
}

$SKIP_GITHUB && PUBLISH_GITHUB=false
$SKIP_ZAPSTORE && PUBLISH_ZAPSTORE=false
$SKIP_NOSTR && PUBLISH_NOSTR=false
if $SKIP_ANDROID; then PUBLISH_ZAPSTORE=false; fi

echo "==> Select publish destinations for $RELEASE_TAG:"
$ZAPSTORE_ONLY && echo "    (FYI: GitHub release for $RELEASE_TAG already exists -- Zapstore can publish from that without a fresh build.)"
echo ""

if $SKIP_GITHUB; then echo "    - GitHub (skipped via --skip-github)"
elif _ask "Publish to GitHub Releases ($RELEASES_REPO)?" y; then PUBLISH_GITHUB=true; echo "    ✓ GitHub"
else PUBLISH_GITHUB=false; echo "    ✗ GitHub (skipped)"; fi

if $SKIP_ANDROID; then echo "    - Zapstore (skipped via --skip-android)"
elif $SKIP_ZAPSTORE; then echo "    - Zapstore (skipped via --skip-zapstore)"
elif _ask "Publish to Zapstore?" y; then PUBLISH_ZAPSTORE=true; echo "    ✓ Zapstore"
else PUBLISH_ZAPSTORE=false; echo "    ✗ Zapstore (skipped)"; fi

if $SKIP_ANDROID || $SKIP_PLAY; then echo "    - Google Play (skipped via flag)"
elif _play_configured; then
  if _ask "Publish to Google Play (${PLAY_TRACK:-alpha} track)?" y; then PUBLISH_PLAY=true; echo "    ✓ Google Play"
  else echo "    ✗ Google Play (skipped)"; fi
else
  echo "    - Google Play (not configured — the app bundle is still built; step 10 prints the Console steps)"
fi

if $SKIP_IOS; then echo "    - Apple App Store (skipped via --skip-appstore)"
elif _appstore_configured; then
  if _ask "Publish to Apple App Store?" y; then PUBLISH_APP_STORE=true; echo "    ✓ Apple App Store"
  else echo "    ✗ Apple App Store (skipped)"; fi
else
  echo "    - Apple App Store (not configured - set ASC_KEY_ID + ASC_ISSUER_ID in scripts/.env; ensure ${MAC_MINI_HOST:-Tims-Mac-mini.local} is reachable)"
fi

if $SKIP_DESKTOP; then echo "    - Desktop apps (skipped via --skip-desktop)"
elif _ask "Build the desktop apps (Mac, Linux, Windows)?" y; then
  echo "    ✓ Desktop apps"
  if ! $SKIP_WINDOWS; then
    if _ask "Build and test Windows on the win11-pearguard VM (8 GB of RAM)? (No: Wine, untested)" y; then WINDOWS_ON_VM=true; fi
  fi
else SKIP_DESKTOP=true; echo "    ✗ Desktop apps (skipped)"; fi

if $SKIP_SEEDER; then echo "    - Seeder download (skipped via --skip-seeder)"
elif _ask "Build the Linux seeder download?" y; then echo "    ✓ Seeder download"
else SKIP_SEEDER=true; echo "    ✗ Seeder download (skipped)"; fi

if $SKIP_SEEDER_STORE; then echo "    - Seeder stores (skipped via --skip-seeder-store)"
elif ! command -v start-cli-1.1.0 >/dev/null || ! command -v podman >/dev/null; then
  SKIP_SEEDER_STORE=true
  echo "    - Seeder stores (skipped — needs podman and start-cli-1.1.0)"
elif _ask "Build the seeder for Umbrel and StartOS, and update their stores?" y; then echo "    ✓ Seeder stores"
else SKIP_SEEDER_STORE=true; echo "    ✗ Seeder stores (skipped)"; fi

if $SKIP_NOSTR; then echo "    - Nostr (skipped via --skip-nostr)"
elif _ask "Post release announcement to Nostr?" y; then PUBLISH_NOSTR=true; echo "    ✓ Nostr"
else PUBLISH_NOSTR=false; echo "    ✗ Nostr (skipped)"; fi
echo ""

if ! $PUBLISH_GITHUB && ! $PUBLISH_ZAPSTORE && ! $PUBLISH_NOSTR && ! $PUBLISH_PLAY && ! $PUBLISH_APP_STORE && $SKIP_SEEDER_STORE; then
  echo "No destinations selected. Aborted."
  exit 0
fi

# Zapstore alone does not need a build when GitHub already has this version.
if $PUBLISH_GITHUB || $PUBLISH_PLAY || $PUBLISH_APP_STORE || ! $SKIP_SEEDER_STORE; then
  NEEDS_BUILD=true
fi
if [ "${GH_VERSION:-}" != "$APP_VERSION" ] && ! $NEEDS_BUILD; then
  NEEDS_BUILD=true
  echo "    Note: $RELEASE_TAG is not published on GitHub, so there is no"
  echo "    existing artifact to republish — building it."
fi

if $NEEDS_BUILD; then

# ---------------------------------------------------------------------------
# 0. Update app.json version and versionCode
#
# scripts/release/bump.js sets the version everywhere PearOffice writes it:
# package.json, desktop/package.json, both lock files, app.json (Android
# versionCode and iOS buildNumber go up by one) and the StartOS package
# (image tag and version graph). At the same version (--retag) it changes
# nothing.
# ---------------------------------------------------------------------------
echo "==> Updating the version to $APP_VERSION..."
node scripts/release/bump.js "$APP_VERSION"
echo "    Version     : $(node -p "require('./app.json').expo.version")"
echo "    versionCode : $(node -p "require('./app.json').expo.android.versionCode")"
echo "    iOS build   : $(node -p "require('./app.json').expo.ios.buildNumber")"
echo "    Desktop     : $(node -p "require('./desktop/package.json').version")"
_confirm "app.json version looks correct — proceed with bundle builds?"

# ---------------------------------------------------------------------------
# 1. Canonical verify gate (tests + all bundles)
#
# `npm run verify` is PearOffice's merge gate: the unit tests, the real Bare
# binary with every bundle, and the desktop smoke test. Run unpiped, so a red
# suite aborts here via set -e. The mobile bundles that ship are rebuilt by
# step 3's build-android-release.sh and by ios-appstore.sh on the Mac.
# ---------------------------------------------------------------------------
echo "==> Running the verify gate (tests, Bare bundles, desktop smoke)..."
npm run verify

# ---------------------------------------------------------------------------
# 2. Native project preparation
#
# android/ is generated and gitignored here, so prebuild regenerates it with
# the release-signing config plugin. ios/ is prebuilt on the Mac Mini by
# scripts/ios-appstore.sh in step 11.
# ---------------------------------------------------------------------------
if $SKIP_ANDROID; then
  echo "==> Native project: no Android build, no prebuild."
else
  echo "==> Native project: expo prebuild (android)..."
  npx expo prebuild --clean --platform android --no-install
fi

# ---------------------------------------------------------------------------
# 3. Build signed release APK (and AAB if publishing to Google Play)
#
# scripts/build-android-release.sh builds both every time (the AAB is what
# Google Play takes, uploaded here or by hand) into dist/android/, named
# inline (pearoffice-<version>.apk), and refuses a build not signed with the
# PearOffice key.
# ---------------------------------------------------------------------------
if $SKIP_ANDROID; then
  echo "==> Skipping Android APK/AAB build (--skip-android)."
else
  echo "==> Building signed release APK and AAB (arm64)..."
  PREBUILT=1 scripts/build-android-release.sh
  APK_NAME="dist/android/${ARTIFACT_PREFIX}-${APP_VERSION}.apk"
  AAB_NAME="dist/android/${ARTIFACT_PREFIX}-${APP_VERSION}.aab"
  APK_SIZE=$(du -sh "$APK_NAME" | cut -f1)
  AAB_SIZE=$(du -sh "$AAB_NAME" | cut -f1)
  echo "==> Built APK: $APK_NAME  ($APK_SIZE)"
  echo "==> Built AAB: $AAB_NAME  ($AAB_SIZE)"
fi

# ---------------------------------------------------------------------------
# 4e. Generate .sha256 sidecars for the mobile artifacts
# ---------------------------------------------------------------------------
for _artifact in "$APK_NAME" "$AAB_NAME"; do
  [ -z "$_artifact" ] && continue
  [ -f "$_artifact" ] || continue
  ( cd "$(dirname "$_artifact")" && sha256sum "$(basename "$_artifact")" > "$(basename "$_artifact").sha256" )
  echo "    sha256  $(cut -d' ' -f1 < "${_artifact}.sha256")  $(basename "$_artifact")"
done

echo ""
_BUILD_SUMMARY=""
[ -n "$APK_NAME" ] && _BUILD_SUMMARY="APK ($APK_SIZE), AAB ($AAB_SIZE)"
[ -z "$_BUILD_SUMMARY" ] && _BUILD_SUMMARY="desktop and seeder only (no mobile artifacts)"
_confirm "$_BUILD_SUMMARY look correct — proceed with release notes?"

fi # end NEEDS_BUILD

# ---------------------------------------------------------------------------
# 5. Generate release notes from git log / merge commits
#
# When notes/release-<version>.md exists (plain-language notes written by
# hand, suite rule 13), it is the starting point instead. Either way the file
# opens in vi (as in the other apps) and every destination reads release_notes.md afterwards.
#
# From git: each merge commit since the previous vX.Y.Z tag is a PR, titled
# from the GitHub API when a token works, else from its branch name.
# ---------------------------------------------------------------------------
echo "==> Writing release notes..."
HAND_NOTES="notes/release-${APP_VERSION}.md"
if [ -f "$HAND_NOTES" ]; then
  echo "    Starting from $HAND_NOTES"
  cp "$HAND_NOTES" release_notes.md
else
  PREV_TAG=$(git tag --sort=-version:refname \
    | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' \
    | grep -v "^${RELEASE_TAG}$" \
    | head -1 || echo "")
  if [ -n "$PREV_TAG" ]; then
    LOG_RANGE="${PREV_TAG}..HEAD"
    echo "    Commits since $PREV_TAG"
  else
    LOG_RANGE="HEAD"
    echo "    No previous tag — including all commits"
  fi

  declare -A PR_NUM_FOR_SHA
  if [ -n "$REPO_SLUG" ] && [ -n "$GH_TOKEN" ]; then
    while IFS='|' read -r sha subject; do
      if [[ "$subject" =~ Merge\ pull\ request\ #([0-9]+) ]]; then
        PR_NUM_FOR_SHA["$sha"]="${BASH_REMATCH[1]}"
      fi
    done < <(git log "$LOG_RANGE" --merges --format="%H|%s")
  fi

  FEAT_LINES=""
  FIX_LINES=""
  OTHER_LINES=""

  while IFS= read -r sha; do
    [[ -z "$sha" ]] && continue
    SUBJECT=$(git log -1 --format="%s" "$sha")
    BODY=$(git log -1 --format="%b" "$sha")
    TITLE="$SUBJECT"
    if [[ "$TITLE" =~ ^Merge\ pull\ request\ #[0-9]+\ from\ (.+)$ ]]; then
      BRANCH_TITLE="${BASH_REMATCH[1]}"
      PR_NUM="${PR_NUM_FOR_SHA[$sha]:-}"
      if [ -n "$PR_NUM" ] && [ -n "$REPO_SLUG" ] && [ -n "$GH_TOKEN" ]; then
        API_TITLE=$(curl -sf \
          -H "Authorization: Bearer $GH_TOKEN" \
          -H "Accept: application/vnd.github+json" \
          "https://api.github.com/repos/${REPO_SLUG}/pulls/${PR_NUM}" \
          2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('title',''))" \
          2>/dev/null || echo "")
        [ -n "$API_TITLE" ] && TITLE="$API_TITLE"
      fi
      if [[ "$TITLE" == "$SUBJECT" ]]; then
        TITLE=$(printf '%s' "$BRANCH_TITLE" | sed -E 's|^[^/]+/||; s|^[^/]+/||; s/[-_]/ /g')
      fi
    fi

    # The merge body is GitHub's PR title line; a summary is only kept when
    # it says something the title does not.
    SUMMARY=""
    if [ -n "$BODY" ]; then
      SUMMARY=$(printf '%s' "$BODY" \
        | awk '/^## Summary/{f=1;next} /^## /{if(f)exit} f && /\S/{print}')
      if [ -z "$SUMMARY" ]; then
        SUMMARY=$(printf '%s' "$BODY" | awk 'NF{p=1} p && /^$/{exit} p{print}')
      fi
    fi
    if [ -n "$SUMMARY" ]; then
      CLEAN_TITLE=$(_strip_prefix "$TITLE")
      CLEAN_SUMMARY=$(_strip_prefix "$SUMMARY")
      if [ "$CLEAN_SUMMARY" = "$CLEAN_TITLE" ] || [ "$SUMMARY" = "$TITLE" ]; then
        SUMMARY=""
      fi
    fi

    _add_entry "$TITLE" "$SUMMARY"
  done < <(git log "$LOG_RANGE" --merges --format="%H" --reverse)

  # Commits made straight on the branch (--first-parent leaves out those that
  # arrived inside merged PRs). The release's own bump commits are skipped.
  while IFS='|' read -r sha subject; do
    [[ -z "$subject" ]] && continue
    [[ "$subject" =~ ^(chore\(release\)|Release\ [0-9]) ]] && continue
    _add_entry "$subject" ""
  done < <(git log "$LOG_RANGE" --no-merges --first-parent --format="%H|%s")

  NOTES="## What's Changed\n\n"
  if [ -z "$FEAT_LINES" ] && [ -z "$FIX_LINES" ] && [ -z "$OTHER_LINES" ]; then
    NOTES="${NOTES}No commits since last release.\n"
  else
    [ -n "$FEAT_LINES" ] && NOTES="${NOTES}### ✨ Improvements\n\n${FEAT_LINES}\n"
    [ -n "$FIX_LINES"  ] && NOTES="${NOTES}### 🐛 Bug Fixes\n\n${FIX_LINES}\n"
    [ -n "$OTHER_LINES" ] && NOTES="${NOTES}### 🔧 Other\n\n${OTHER_LINES}\n"
  fi
  printf "%b" "$NOTES" > release_notes.md
fi
sed -i 's/\*\*//g' release_notes.md
echo "    Opening release notes in vi for review/editing (write them for the people using the app)..."
vi release_notes.md
echo "--- Release notes ---"
cat release_notes.md
echo "---"
_confirm "Release notes look good?"

# What the stores show: everything above a "## Downloads" section (which only
# the GitHub release needs), and for the App Store without emoji.
MOBILE_NOTES="dist/release/notes-mobile.md"
mkdir -p dist/release
awk '/^##[[:space:]]+Downloads/{exit} {print}' release_notes.md \
  | sed -e :a -e '/^\n*$/{$d;N;ba' -e '}' > "$MOBILE_NOTES"
WHATS_NEW=$(python3 -c "
import re, sys
t = open(sys.argv[1], encoding='utf-8').read()
t = re.sub('[\U0001F000-\U0001FAFF☀-➿️]', '', t)
t = re.sub(r'(?m)^#+[ \t]*', '', t)
print(re.sub(r'(?m)^[ \t]+$', '', t).strip())
" "$MOBILE_NOTES")

# The StartOS package shows the notes too; the line goes into its current
# version (start9/seeder/startos/versions/current.ts), committed in step 6.
if $NEEDS_BUILD; then
  node scripts/release/bump.js --notes "$MOBILE_NOTES"
fi

if $NEEDS_BUILD; then

# ---------------------------------------------------------------------------
# 5b. Build the desktop installers
#
# One desktop/ project builds every target, so 5b2 is absent and
# --skip-linux / --skip-windows / --skip-macos select inside this step.
# Each runs after the notes so the machine works unattended, one after
# another (they share the staged resources in desktop/build/resources), and
# each ends with its packaged smoke test. Best-effort: a failed platform is
# logged and skipped, never blocking the rest of the release.
# ---------------------------------------------------------------------------
_desktop() { # _desktop <label> <log> <command...>
  local _label="$1" _log="$2"; shift 2
  echo "--> $_label"
  if "$@" > "$_log" 2>&1 < /dev/null; then
    echo "    $_label OK."
    return 0
  fi
  echo "    WARNING: $_label failed, skipping it. Log: $_log"
  return 1
}
_DV="$APP_VERSION"
_DD="$REPO_ROOT/desktop/dist"
if $SKIP_DESKTOP; then
  echo "==> Skipping the desktop installers (--skip-desktop)."
else
  echo ""
  echo "==> Building the desktop installers (Mac on the Mac Mini, Linux and Windows here)..."
  if $SKIP_MACOS; then
    echo "--> macOS    (skipped via --skip-macos)"
  else
    _desktop "macOS, Apple silicon (signed, notarized)" /tmp/pearoffice-build-mac-arm64.log npm run dist:mac \
      && DESKTOP_ARTIFACTS+=("$_DD/PearOffice-$_DV-mac-arm64.dmg" "$_DD/PearOffice-$_DV-mac-arm64.zip")
    _desktop "macOS, Intel (signed, notarized)" /tmp/pearoffice-build-mac-x64.log npm run dist:mac:intel \
      && DESKTOP_ARTIFACTS+=("$_DD/PearOffice-$_DV-mac-x64.dmg" "$_DD/PearOffice-$_DV-mac-x64.zip")
  fi
  if $SKIP_LINUX; then
    echo "--> Linux    (skipped via --skip-linux)"
  else
    _desktop "Linux (.AppImage + .deb)" /tmp/pearoffice-build-linux.log npm run dist:linux \
      && DESKTOP_ARTIFACTS+=("$_DD/pearoffice-$_DV-linux-x86_64.AppImage" "$_DD/pearoffice-$_DV-linux-amd64.deb")
  fi
  if $SKIP_WINDOWS; then
    echo "--> Windows  (skipped via --skip-windows)"
  elif $WINDOWS_ON_VM; then
    _win_vm() {
      virsh -c qemu:///system start win11-pearguard 2>/dev/null || true
      local _i
      for _i in $(seq 1 60); do
        ssh -o BatchMode=yes -o ConnectTimeout=5 "${WINDOWS_VM_HOST:-ben@192.168.50.157}" exit 2>/dev/null && break
        sleep 5
      done
      local _s=0
      npm run dist:windows:vm || _s=$?
      virsh -c qemu:///system shutdown win11-pearguard >/dev/null 2>&1 || true
      return "$_s"
    }
    _desktop "Windows (.exe, built and tested on the VM)" /tmp/pearoffice-build-windows.log _win_vm \
      && DESKTOP_ARTIFACTS+=("$_DD/PearOffice-Setup-$_DV.exe")
  else
    _desktop "Windows (.exe, built with Wine, untested)" /tmp/pearoffice-build-windows.log npm run dist:windows \
      && DESKTOP_ARTIFACTS+=("$_DD/PearOffice-Setup-$_DV.exe")
  fi
  _have=()
  for _f in "${DESKTOP_ARTIFACTS[@]}"; do
    if [ -f "$_f" ]; then _have+=("$_f"); else echo "    WARNING: expected $_f, not found."; fi
  done
  DESKTOP_ARTIFACTS=("${_have[@]}")
  if [ ${#DESKTOP_ARTIFACTS[@]} -gt 0 ]; then
    echo "==> Desktop installers built (${#DESKTOP_ARTIFACTS[@]}):"
    for _f in "${DESKTOP_ARTIFACTS[@]}"; do echo "    - $(basename "$_f")  ($(du -sh "$_f" | cut -f1))"; done
  else
    echo "==> No desktop installers produced (all skipped or failed); the release continues."
  fi
fi

# ---------------------------------------------------------------------------
# 5c. Build the seeder download (Linux x64 and arm64)
#
# The headless seeder: Bare runtime, seeder bundle, launcher and systemd unit.
# The x64 one is started once as a check. Best-effort.
# ---------------------------------------------------------------------------
if $SKIP_SEEDER; then
  echo "==> Skipping the seeder download (--skip-seeder)."
else
  echo ""
  echo "==> Building the seeder download (Linux x64 + arm64)..."
  if npm run dist:seeder > /tmp/pearoffice-build-seeder.log 2>&1 < /dev/null; then
    for _arch in x64 arm64; do
      _f="$REPO_ROOT/dist/seeder-pkg/pearoffice-seeder-$APP_VERSION-linux-$_arch.tar.gz"
      [ -f "$_f" ] && SEEDER_ARTIFACTS+=("$_f")
    done
    echo "    Seeder download OK (${#SEEDER_ARTIFACTS[@]} files)."
  else
    echo "    WARNING: seeder download build failed, skipping it. Log: /tmp/pearoffice-build-seeder.log"
  fi
fi

# ---------------------------------------------------------------------------
# 5d. Build the store packages (Umbrel image, StartOS .s9pk)
#
# Both built here and not pushed: the image goes to ghcr and the stores are
# updated in step 7b, after the tag. Best-effort.
# ---------------------------------------------------------------------------
if $SKIP_SEEDER_STORE; then
  echo "==> Skipping the Umbrel image and the StartOS package."
else
  echo ""
  echo "==> Building the Umbrel image (amd64 + arm64, not pushed yet)..."
  echo "    Full log: /tmp/pearoffice-build-umbrel.log"
  if PUSH=0 scripts/build-umbrel-image.sh "$APP_VERSION" > /tmp/pearoffice-build-umbrel.log 2>&1 < /dev/null; then
    UMBREL_BUILT=true
    echo "    Umbrel image OK."
  else
    echo "    WARNING: Umbrel image build failed, skipping the seeder stores. Log: /tmp/pearoffice-build-umbrel.log"
  fi
  echo "==> Building the StartOS package..."
  echo "    Full log: /tmp/pearoffice-build-start9.log"
  if ( cd start9/seeder && npm install --silent --no-audit --no-fund && make ) > /tmp/pearoffice-build-start9.log 2>&1 < /dev/null; then
    _s9="$REPO_ROOT/start9/seeder/pearoffice-seeder_x86_64.s9pk"
    _got=$(start-cli-1.1.0 s9pk inspect "$_s9" manifest 2>/dev/null \
      | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).version" 2>/dev/null || echo "")
    if [ "$_got" = "$APP_VERSION:0" ]; then
      START9_S9PK="$_s9"
      echo "    StartOS package OK ($(du -h "$START9_S9PK" | cut -f1))."
    else
      echo "    WARNING: the .s9pk says ${_got:-nothing}, expected $APP_VERSION:0; skipping it."
    fi
  else
    echo "    WARNING: StartOS package build failed, skipping it. Log: /tmp/pearoffice-build-start9.log"
  fi
fi

# ---------------------------------------------------------------------------
# 5e. Generate .sha256 sidecars for the desktop artifacts, then the final gate
#
# The last confirm before anything irreversible: step 6 commits and step 6b
# pushes the tag. See RELEASE-PIPELINE.md §2.
# ---------------------------------------------------------------------------
for _artifact in "${DESKTOP_ARTIFACTS[@]}" "${SEEDER_ARTIFACTS[@]}" "$START9_S9PK"; do
  [ -z "$_artifact" ] && continue
  [ -f "$_artifact" ] || continue
  ( cd "$(dirname "$_artifact")" && sha256sum "$(basename "$_artifact")" > "$(basename "$_artifact").sha256" )
  echo "    sha256  $(cut -d' ' -f1 < "${_artifact}.sha256")  $(basename "$_artifact")"
done

fi # end NEEDS_BUILD (slow builds)

echo ""
_RELEASE_SUMMARY=""
[ -n "$APK_NAME" ] && _RELEASE_SUMMARY="APK ($APK_SIZE), AAB ($AAB_SIZE)"
[ ${#DESKTOP_ARTIFACTS[@]} -gt 0 ] && _RELEASE_SUMMARY="${_RELEASE_SUMMARY:+$_RELEASE_SUMMARY, }${#DESKTOP_ARTIFACTS[@]} desktop installer(s)"
[ ${#SEEDER_ARTIFACTS[@]} -gt 0 ] && _RELEASE_SUMMARY="${_RELEASE_SUMMARY:+$_RELEASE_SUMMARY, }${#SEEDER_ARTIFACTS[@]} seeder download(s)"
$UMBREL_BUILT && _RELEASE_SUMMARY="${_RELEASE_SUMMARY:+$_RELEASE_SUMMARY, }Umbrel image"
[ -n "$START9_S9PK" ] && _RELEASE_SUMMARY="${_RELEASE_SUMMARY:+$_RELEASE_SUMMARY, }StartOS .s9pk"
[ -z "$_RELEASE_SUMMARY" ] && _RELEASE_SUMMARY="no new artifacts"
_confirm "$_RELEASE_SUMMARY ready to publish?"

# ---------------------------------------------------------------------------
# 5f. Generate the iOS version metadata BEFORE the bump commit
#
# metadata/ios/version/<version>/en-US.json: the listing text with this
# version's "What's New", so step 6 commits it and step 11 applies it.
# ---------------------------------------------------------------------------
if $PUBLISH_APP_STORE; then
  mkdir -p "metadata/ios/version/$APP_VERSION"
  node -e "
    const f = require('fs')
    const o = JSON.parse(f.readFileSync('metadata/ios/version/default/en-US.json', 'utf8'))
    o.whatsNew = process.argv[1]
    f.writeFileSync('metadata/ios/version/$APP_VERSION/en-US.json', JSON.stringify(o, null, 2) + '\n')
  " "$WHATS_NEW"
  echo "==> Wrote metadata/ios/version/$APP_VERSION/en-US.json"
fi

# ---------------------------------------------------------------------------
# Phase D — publishing starts here. Nothing below this line is undoable.
# ---------------------------------------------------------------------------
if $PUBLISH_GITHUB; then
  _have_upload=false
  [ -n "$APK_NAME" ] && [ -f "$APK_NAME" ] && _have_upload=true
  [ ${#DESKTOP_ARTIFACTS[@]} -gt 0 ] && _have_upload=true
  [ ${#SEEDER_ARTIFACTS[@]} -gt 0 ] && _have_upload=true
  [ -n "$START9_S9PK" ] && _have_upload=true
  if ! $_have_upload; then
    echo ""
    echo "==> No artifacts to upload — skipping GitHub release step."
    PUBLISH_GITHUB=false
  fi
fi

GIT_REMOTE="${GITHUB_REMOTE:-}"
if [ -z "$GIT_REMOTE" ]; then
  if git remote | grep -q '^github$'; then GIT_REMOTE="github"; else GIT_REMOTE="origin"; fi
fi

if $NEEDS_BUILD; then

# ---------------------------------------------------------------------------
# 6. Commit the version bumps this run made, BEFORE tagging
#
# Explicit allowlist, never `git add -A`: a run leaves release_notes.md,
# dist/ and node_modules changes in the tree.
# ---------------------------------------------------------------------------
_bump_paths=(
  package.json
  package-lock.json
  desktop/package.json
  desktop/package-lock.json
  app.json
  start9/seeder/startos/manifest/index.ts
  start9/seeder/startos/versions
  "metadata/ios/version/$APP_VERSION"
  "$HAND_NOTES"
)
_bump_existing=()
for _p in "${_bump_paths[@]}"; do [ -e "$_p" ] && _bump_existing+=("$_p"); done
if [ ${#_bump_existing[@]} -gt 0 ] \
   && [ -n "$(git status --porcelain -- "${_bump_existing[@]}")" ]; then
  echo "==> Committing version bumps for $APP_VERSION..."
  git add -- "${_bump_existing[@]}"
  git commit -q -m "chore(release): $APP_VERSION" \
    && echo "    Committed $(git diff --name-only HEAD~1 HEAD | wc -l) file(s)" \
    || echo "    WARNING: version-bump commit failed - the tag will not contain them." >&2
else
  echo "==> No uncommitted version bumps to record (already committed)."
fi

# ---------------------------------------------------------------------------
# 6b. Push branch and tag
# ---------------------------------------------------------------------------
echo ""
echo "    Remote : $GIT_REMOTE"
echo "    Tag    : $RELEASE_TAG"
echo "    Branch : $(git rev-parse --abbrev-ref HEAD)"
echo "    Commit : $(git rev-parse --short HEAD)  $(git log -1 --format='%s')"
_confirm "Push branch $(git rev-parse --abbrev-ref HEAD) + tag $RELEASE_TAG to $GIT_REMOTE? (This cannot be undone without a force-delete)"

_branch="$(git rev-parse --abbrev-ref HEAD)"
git push "$GIT_REMOTE" "$_branch" \
  && echo "    Pushed $_branch to $GIT_REMOTE" \
  || echo "    WARNING: branch push failed - push $_branch manually so the tag resolves." >&2

echo "==> Tagging and pushing $RELEASE_TAG..."
git tag "$RELEASE_TAG" 2>/dev/null \
  && echo "    Created local tag" \
  || echo "    Tag already exists locally"
git push "$GIT_REMOTE" "$RELEASE_TAG" \
  && echo "    Pushed tag to $GIT_REMOTE" \
  || echo "    Tag already on remote"

fi # end NEEDS_BUILD (commit and tag)

# ---------------------------------------------------------------------------
# 7. Create GitHub release and upload assets
#
# On the public releases repo, where the website, the desktop update check and
# the StartOS registry link. Every file with its .sha256 sidecar.
# ---------------------------------------------------------------------------
if $PUBLISH_GITHUB; then
  echo "==> Creating GitHub release $RELEASE_TAG on $RELEASES_REPO..."
  RELEASE_ASSETS=()
  for _a in "$APK_NAME" "${DESKTOP_ARTIFACTS[@]}" "${SEEDER_ARTIFACTS[@]}" "$START9_S9PK"; do
    [ -n "$_a" ] && [ -f "$_a" ] || continue
    RELEASE_ASSETS+=("$_a")
    [ -f "${_a}.sha256" ] && RELEASE_ASSETS+=("${_a}.sha256")
  done
  # A release without an Android build keeps the previous APK on
  # releases/latest, which the website links to.
  if $SKIP_ANDROID; then
    _CARRIED=$(_carry_forward_apk "$GH_TOKEN" "$RELEASES_REPO" "$(mktemp -d)")
    if [ -n "$_CARRIED" ]; then
      while IFS= read -r _c; do RELEASE_ASSETS+=("$_c"); done <<< "$_CARRIED"
      echo "==> Carrying forward $(basename "$(printf '%s\n' "$_CARRIED" | head -1)") from the previous release."
    else
      echo "==> WARNING: no APK carried forward - this release will have no Android download."
    fi
  fi
  echo ""
  echo "    Repo   : $RELEASES_REPO"
  echo "    Tag    : $RELEASE_TAG"
  echo "    Assets :"
  for _a in "${RELEASE_ASSETS[@]}"; do echo "             - $(basename "$_a") ($(du -sh "$_a" | cut -f1))"; done
  _confirm "Create public GitHub release $RELEASE_TAG and upload ${#RELEASE_ASSETS[@]} assets?"
  if gh release view "$RELEASE_TAG" -R "$RELEASES_REPO" >/dev/null 2>&1; then
    echo "    GitHub release $RELEASE_TAG already exists -- replacing its notes and assets."
    if ! { gh release edit "$RELEASE_TAG" -R "$RELEASES_REPO" --notes-file release_notes.md >/dev/null \
           && gh release upload "$RELEASE_TAG" -R "$RELEASES_REPO" --clobber "${RELEASE_ASSETS[@]}"; }; then
      PUBLISH_FAILED=true
      echo "ERROR: updating the GitHub release failed. Fix and re-run with ./scripts/release.sh $RELEASE_TAG --retag"
    fi
  elif gh release create "$RELEASE_TAG" -R "$RELEASES_REPO" --title "$APP_NAME $APP_VERSION" \
         --notes-file release_notes.md "${RELEASE_ASSETS[@]}"; then
    echo "==> All ${#RELEASE_ASSETS[@]} assets uploaded."
  else
    PUBLISH_FAILED=true
    echo "ERROR: creating the GitHub release failed. The tag is pushed; re-run with ./scripts/release.sh $RELEASE_TAG --retag"
  fi
else
  echo ""
  echo "==> Skipping GitHub release (not selected)."
fi

# ---------------------------------------------------------------------------
# 7b. Refresh external registries
#
# The seeder's stores, after the release exists (the StartOS registry links
# this tag's .s9pk): push the image to ghcr, open the PeerLoom community
# store PR, update the official getumbrel/umbrel-apps listing and open the
# website PR for the StartOS registry. Each asks first. Step 13c then makes
# sure the community store really serves the new version.
# ---------------------------------------------------------------------------
if ! $SKIP_SEEDER_STORE && $UMBREL_BUILT; then
  echo ""
  echo "==> Seeder stores for $APP_VERSION..."
  _digest=""
  if _ask "Push $UMBREL_IMAGE:$APP_VERSION (amd64, arm64) to ghcr?" y; then
    if scripts/build-umbrel-image.sh "$APP_VERSION" > /tmp/pearoffice-push-umbrel.log 2>&1 < /dev/null; then
      echo "    Pushed. Log: /tmp/pearoffice-push-umbrel.log"
    else
      PUBLISH_FAILED=true
      echo "    ERROR: pushing the image failed. Log: /tmp/pearoffice-push-umbrel.log"
    fi
  fi
  _digest="sha256:$(skopeo inspect --raw "docker://$UMBREL_IMAGE:$APP_VERSION" 2>/dev/null | sha256sum | cut -d' ' -f1)"
  if ! skopeo inspect --raw "docker://$UMBREL_IMAGE:$APP_VERSION" >/dev/null 2>&1; then
    echo "    No $UMBREL_IMAGE:$APP_VERSION on ghcr, so the Umbrel stores are not updated."
    _digest=""
  fi
  _store_notes="Updated PearOffice Seeder to $APP_VERSION. Full release notes: https://github.com/$RELEASES_REPO/releases/tag/$RELEASE_TAG"

  if [ -n "$_digest" ]; then
    # The PeerLoom community store.
    _worktree "$PEERLOOM/peerloom-umbrel-app-store" origin master "pearoffice-seeder-v$APP_VERSION"; _store="$WT"
    _umbrel_bump "$_store/peerloom-pearoffice-seeder" "$APP_VERSION" "$_digest" "$_store_notes"
    git -C "$_store" diff --stat
    if _ask "Open the PeerLoom community store PR for $APP_VERSION?" y; then
      git -C "$_store" commit -qam "peerloom-pearoffice-seeder: update to $APP_VERSION"
      git -C "$_store" push -q -f origin "pearoffice-seeder-v$APP_VERSION"
      STORE_PR_URL=$(cd "$_store" && gh pr create --base master --title "peerloom-pearoffice-seeder: update to $APP_VERSION" \
        --body "Image pinned to the multi-arch manifest-list digest ($_digest)." 2>&1 | tail -1)
      echo "    $STORE_PR_URL"
    fi

    # The official store. While the first listing is open its branch is
    # refreshed; once merged, each release opens an update PR off upstream.
    _fork="$PEERLOOM/umbrel-apps"
    git -C "$_fork" remote get-url upstream >/dev/null 2>&1 \
      || git -C "$_fork" remote add upstream https://github.com/getumbrel/umbrel-apps.git
    git -C "$_fork" fetch -q upstream
    if git -C "$_fork" cat-file -e upstream/master:pearoffice-seeder/umbrel-app.yml 2>/dev/null; then
      _obranch="pearoffice-seeder-v$APP_VERSION"
      _worktree "$_fork" upstream master "$_obranch"; _official="$WT"
    else
      _obranch="pearoffice-seeder"
      git -C "$_fork" fetch -q origin "$_obranch"
      _worktree "$_fork" origin "$_obranch" "$_obranch-update"; _official="$WT"
    fi
    _umbrel_bump "$_official/pearoffice-seeder" "$APP_VERSION" "$_digest" "$_store_notes"
    git -C "$_official" diff --stat
    if _ask "Push the official getumbrel/umbrel-apps update for $APP_VERSION?" y; then
      git -C "$_official" commit -qam "pearoffice-seeder: update to $APP_VERSION"
      git -C "$_official" push -q -f origin "HEAD:$_obranch"
      if [ "$_obranch" = pearoffice-seeder ]; then
        echo "    Refreshed the open listing PR: https://github.com/getumbrel/umbrel-apps/pull/${UMBREL_OFFICIAL_PR:-}"
      else
        gh pr create --repo getumbrel/umbrel-apps --base master --head "peerloomllc:$_obranch" \
          --title "pearoffice-seeder: update to $APP_VERSION" \
          --body "Bump PearOffice Seeder to $APP_VERSION (image pinned to the multi-arch manifest-list digest)." \
          || echo "    WARNING: could not open the official store PR."
      fi
    fi
  fi

  # The StartOS registry on the website (merging the PR publishes it).
  if [ -n "$START9_S9PK" ] && $PUBLISH_GITHUB; then
    _worktree "$PEERLOOM/website" origin main "registry/pearoffice-seeder-$APP_VERSION"; _site="$WT"
    if START_CLI=start-cli-1.1.0 node start9/registry/build-registry-04.js "$START9_S9PK" \
         --url https://peerloomllc.com/package/v1/pearoffice-seeder.s9pk --icon start9/seeder/icon.png \
         --out "$_site/registry/0.4/index.json"; then
      sed -i -E "s#(pearoffice-releases/releases/download/)v[0-9.]+(/pearoffice-seeder_x86_64.s9pk)#\1$RELEASE_TAG\2#" "$_site/_redirects"
      git -C "$_site" diff --stat
      if _ask "Open the website PR for the StartOS registry ($APP_VERSION)? (Merging it publishes.)" y; then
        git -C "$_site" commit -qam "StartOS registry: PearOffice seeder $APP_VERSION"
        git -C "$_site" push -q -f origin "registry/pearoffice-seeder-$APP_VERSION"
        (cd "$_site" && gh pr create --title "StartOS registry: PearOffice seeder $APP_VERSION" \
          --body "pearoffice-seeder $APP_VERSION:0 in registry/0.4/index.json and its s9pk redirect to the $RELEASE_TAG release asset.") \
          || echo "    WARNING: could not open the website PR."
      fi
    else
      echo "    WARNING: building the StartOS registry entry failed - refresh the website registry by hand."
    fi
  fi
fi

# ---------------------------------------------------------------------------
# 8. Install zsp if needed
# ---------------------------------------------------------------------------
release_install_zsp

# ---------------------------------------------------------------------------
# 9. Publish to Zapstore
#
# scripts/publish-zapstore.sh links the signing key to the Nostr identity,
# adds the notes and the local APK to zapstore.yaml for the run and runs
# `zsp publish`. A Zapstore-only run (GitHub already has this version) takes
# the APK from that release.
# ---------------------------------------------------------------------------
if $PUBLISH_ZAPSTORE; then
  echo "==> Publishing to Zapstore..."
  _ZSP_APK="$REPO_ROOT/dist/android/${ARTIFACT_PREFIX}-${APP_VERSION}.apk"
  if [ ! -f "$_ZSP_APK" ] && $ZAPSTORE_ONLY; then
    echo "    Downloading ${ARTIFACT_PREFIX}-${APP_VERSION}.apk from the GitHub release..."
    mkdir -p dist/android
    gh release download "$RELEASE_TAG" -R "$RELEASES_REPO" -p "${ARTIFACT_PREFIX}-${APP_VERSION}.apk" -D dist/android --clobber || true
  fi
  # Refuse to publish an artifact that is not the version being announced.
  _ZSP_OK=true
  if [ ! -f "$_ZSP_APK" ]; then
    echo "ERROR: no $_ZSP_APK to publish."
    _ZSP_OK=false
  else
    _ZSP_APK_VERSION=$(_apk_version_name "$_ZSP_APK")
    if [ -z "$_ZSP_APK_VERSION" ]; then
      echo "    Warning: could not read the APK's versionName (no aapt/aapt2) — publishing it unverified."
    elif [ "$_ZSP_APK_VERSION" != "$APP_VERSION" ]; then
      echo "ERROR: artifact/version mismatch — refusing to publish."
      echo "    About to announce : $APP_VERSION"
      echo "    APK actually is   : $_ZSP_APK_VERSION"
      exit 1
    else
      echo "    Artifact : $(basename "$_ZSP_APK") (versionName $_ZSP_APK_VERSION ✓)"
    fi
  fi
  if $_ZSP_OK; then
    echo "    Version  : $APP_VERSION"
    _confirm "Publish $RELEASE_TAG to Zapstore?"
    if scripts/publish-zapstore.sh "$MOBILE_NOTES"; then
      echo "==> Zapstore: published."
    else
      PUBLISH_FAILED=true
      echo "ERROR: Zapstore publish failed. Retry with: scripts/publish-zapstore.sh $MOBILE_NOTES"
    fi
  else
    PUBLISH_FAILED=true
  fi
else
  echo ""
  echo "==> Skipping Zapstore publish (not selected)."
fi

# ---------------------------------------------------------------------------
# 10. Upload to Google Play Store
#
# With credentials (gcloud ADC or PLAY_SERVICE_ACCOUNT_JSON): the Play
# Developer API, as the other apps do (edit, upload the AAB, assign it to the
# track with the notes, commit). Without: the steps to do it in the Console.
# Notes are cut to Play's 500 characters on a line boundary.
# ---------------------------------------------------------------------------
PLAY_TRACK="${PLAY_TRACK:-alpha}"
PLAY_NOTES_TEXT=$(NOTES_SRC="$MOBILE_NOTES" python3 -c '
import os, sys
LIMIT = 500
out, used = [], 0
with open(os.environ["NOTES_SRC"], encoding="utf-8", errors="replace") as fh:
    for raw in fh:
        line = raw.rstrip("\n")
        cost = len(line) + 1
        if used + cost > LIMIT:
            break
        out.append(line)
        used += cost
while out and out[-1].lstrip().startswith("#"):
    out.pop()
sys.stdout.write("\n".join(out).strip())
')
PLAY_AAB="$REPO_ROOT/dist/android/${ARTIFACT_PREFIX}-${APP_VERSION}.aab"
if $PUBLISH_PLAY; then
  echo ""
  echo "==> Uploading to Google Play Store..."
  if [ ! -f "$PLAY_AAB" ]; then
    PUBLISH_FAILED=true
    echo "    ERROR: no $PLAY_AAB. Skipping Google Play upload."
  else
    echo "    Package : $BUNDLE_ID"
    echo "    Track   : $PLAY_TRACK"
    echo "    AAB     : $PLAY_AAB ($(du -sh "$PLAY_AAB" | cut -f1))"
    echo "    Version : $APP_VERSION"
    _confirm "Upload $RELEASE_TAG to Google Play ($PLAY_TRACK track)?"
    PLAY_QUOTA_HDR=()
    if [ -z "${PLAY_SERVICE_ACCOUNT_JSON:-}" ] || [ ! -f "${PLAY_SERVICE_ACCOUNT_JSON:-/dev/null}" ]; then
      _adc_proj="${PLAY_QUOTA_PROJECT:-$(gcloud config get-value project 2>/dev/null || echo "")}"
      [ -n "$_adc_proj" ] && PLAY_QUOTA_HDR=(-H "x-goog-user-project: ${_adc_proj}")
    fi
    PLAY_TOKEN=$(_play_token "${PLAY_SERVICE_ACCOUNT_JSON:-}")
    _play_err() { python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('error',{}).get('message',''))" 2>/dev/null || echo "bad response"; }
    if [ -z "$PLAY_TOKEN" ]; then
      PUBLISH_FAILED=true
      echo "    ERROR: Failed to obtain Google OAuth2 token."
    else
      BASE_URL="https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${BUNDLE_ID}"
      EDIT_ID=$(curl -s -X POST -H "Authorization: Bearer $PLAY_TOKEN" "${PLAY_QUOTA_HDR[@]}" \
        -H "Content-Type: application/json" "${BASE_URL}/edits" -d '{}' \
        | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || echo "")
      if [ -z "$EDIT_ID" ]; then
        PUBLISH_FAILED=true
        echo "    ERROR: Failed to create Play edit."
      else
        UPLOAD_RESP=$(curl -s -X POST -H "Authorization: Bearer $PLAY_TOKEN" "${PLAY_QUOTA_HDR[@]}" \
          -H "Content-Type: application/octet-stream" \
          "https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${BUNDLE_ID}/edits/${EDIT_ID}/bundles?uploadType=media" \
          --data-binary "@${PLAY_AAB}")
        VERSION_CODE=$(printf '%s' "$UPLOAD_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('versionCode',''))" 2>/dev/null || echo "")
        if [ -z "$VERSION_CODE" ]; then
          PUBLISH_FAILED=true
          echo "    ERROR: AAB upload failed: $(printf '%s' "$UPLOAD_RESP" | _play_err)"
          curl -sf -X DELETE -H "Authorization: Bearer $PLAY_TOKEN" "${PLAY_QUOTA_HDR[@]}" "${BASE_URL}/edits/${EDIT_ID}" >/dev/null 2>&1 || true
        else
          TRACK_BODY=$(NOTES="$PLAY_NOTES_TEXT" python3 -c "
import json, os
print(json.dumps({'track': '$PLAY_TRACK', 'releases': [{'name': '$APP_VERSION', 'versionCodes': ['$VERSION_CODE'],
  'status': 'completed', 'releaseNotes': [{'language': 'en-US', 'text': os.environ['NOTES']}]}]}))")
          TRACK_ERR=$(curl -s -X PUT -H "Authorization: Bearer $PLAY_TOKEN" "${PLAY_QUOTA_HDR[@]}" \
            -H "Content-Type: application/json" "${BASE_URL}/edits/${EDIT_ID}/tracks/${PLAY_TRACK}" -d "$TRACK_BODY" | _play_err)
          COMMIT_ERR="$TRACK_ERR"
          if [ -z "$TRACK_ERR" ]; then
            COMMIT_ERR=$(curl -s -X POST -H "Authorization: Bearer $PLAY_TOKEN" "${PLAY_QUOTA_HDR[@]}" \
              "${BASE_URL}/edits/${EDIT_ID}:commit" | _play_err)
          fi
          if [ -n "$COMMIT_ERR" ]; then
            PUBLISH_FAILED=true
            echo "    ERROR: Google Play: $COMMIT_ERR"
            curl -sf -X DELETE -H "Authorization: Bearer $PLAY_TOKEN" "${PLAY_QUOTA_HDR[@]}" "${BASE_URL}/edits/${EDIT_ID}" >/dev/null 2>&1 || true
          else
            echo "==> Google Play upload complete: $APP_VERSION ($VERSION_CODE) on $PLAY_TRACK."
          fi
        fi
      fi
    fi
  fi
elif [ -f "$PLAY_AAB" ] && ! $SKIP_ANDROID && ! $SKIP_PLAY; then
  echo ""
  echo "==> Google Play: by hand in the Play Console"
  echo "  1. Test and release > Testing > Closed testing (or Production) > Create new release"
  echo "  2. Upload $PLAY_AAB"
  echo "  3. Release name: $APP_VERSION"
  echo "  4. Release notes:"
  echo "<en-US>"
  echo "$PLAY_NOTES_TEXT"
  echo "</en-US>"
  echo "  5. Next, check the review page, then Save and publish"
else
  echo ""
  echo "==> Skipping Google Play upload (not selected)."
fi

# ---------------------------------------------------------------------------
# 11. Build, upload, and submit iOS App Store build
#
# The App Store version and its listing text (step 5f's metadata), then
# scripts/ios-appstore.sh builds, signs and uploads on the Mac Mini, then the
# build is attached and submitted for review once Apple has processed it.
# ---------------------------------------------------------------------------
if $PUBLISH_APP_STORE; then
  echo ""
  echo "==> App Store: $APP_VERSION"
  _vid=$(_asc_version_id "$APP_VERSION")
  if [ -z "$_vid" ]; then
    _vid=$(asc versions create --app "$ASC_APP_ID" --version "$APP_VERSION" --platform IOS --output json 2>/dev/null \
      | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['id'])" 2>/dev/null || echo "")
  fi
  if [ -z "$_vid" ]; then
    PUBLISH_FAILED=true
    echo "    ERROR: could not find or create App Store version $APP_VERSION."
  else
    echo "    Version record: $_vid"
    if asc metadata apply --app "$ASC_APP_ID" --version "$APP_VERSION" --dir metadata/ios >/dev/null; then
      echo "    Listing text applied."
    else
      echo "    WARNING: could not apply the listing text; set What's New in App Store Connect."
    fi
    _confirm "Archive, export, and upload to App Store Connect on ${MAC_MINI_HOST:-Tims-Mac-mini.local}?"
    if scripts/ios-appstore.sh; then
      _num=$(node -p "require('./app.json').expo.ios.buildNumber")
      echo "    Waiting for Apple to process build $_num..."
      read -r _bid _state < <(_asc_wait_for_build "$APP_VERSION" "$_num") || true
      if [ "${_state:-}" = VALID ] && _asc_attach_build "$_vid" "$_bid"; then
        if _ask "Submit $APP_VERSION for App Review?" y; then
          _sid=$(asc review submissions-create --app "$ASC_APP_ID" --platform IOS --output json \
            | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['id'])" 2>/dev/null || echo "")
          if [ -n "$_sid" ] \
             && asc review items-add --submission "$_sid" --item-type appStoreVersions --item-id "$_vid" >/dev/null \
             && asc review submissions-submit --id "$_sid" --confirm >/dev/null; then
            echo "    Submitted. Watch with: asc review status --app $ASC_APP_ID"
          else
            PUBLISH_FAILED=true
            echo "    ERROR: the review submission failed; submit in App Store Connect."
          fi
        fi
      else
        APP_STORE_DEFERRED=true
        echo "    Build is ${_state:-not processed yet}; the submission is deferred (see the reminder at the end)."
      fi
    else
      PUBLISH_FAILED=true
      echo "    ERROR: the iOS build or upload failed."
    fi
  fi
else
  echo ""
  echo "==> Skipping App Store (not selected)."
fi

# ---------------------------------------------------------------------------
# 12. Post release announcement to Nostr
#
# Signs a kind:1 note with the Zapstore NSEC (SIGN_WITH) and broadcasts it.
# The body keeps the notes' sections and fills up to NOSTR_NOTE_BUDGET
# characters. See RELEASE-PIPELINE.md §4.
# ---------------------------------------------------------------------------
if ! $PUBLISH_NOSTR; then
  echo ""
  echo "==> Skipping Nostr announcement (not selected)."
elif $PUBLISH_FAILED; then
  echo ""
  echo "==> Skipping Nostr announcement — one or more publish steps failed."
elif ! command -v nak &>/dev/null; then
  echo ""
  echo "==> Skipping Nostr announcement — nak not found (https://github.com/fiatjaf/nak/releases)."
else
  echo ""
  echo "==> Posting release announcement to Nostr..."
  ZAPSTORE_HEX="78ce6faa72264387284e647ba6938995735ec8c7d5c5a65737e55130f026307d"
  ZAPSTORE_NPUB="npub10r8xl2njyepcw2zwv3a6dyufj4e4ajx86hz6v4ehu4gnpupxxp7stjt2p8"
  NOSTR_NOTE_BUDGET="${NOSTR_NOTE_BUDGET:-900}"
  BULLETS=$(NOTES_SRC="$MOBILE_NOTES" BUDGET="$NOSTR_NOTE_BUDGET" python3 -c '
import os, re, sys
BULLET = "• "
ELLIPSIS = "…"
ITEM_MAX = 120
budget = int(os.environ["BUDGET"])
groups = []
with open(os.environ["NOTES_SRC"], encoding="utf-8", errors="replace") as fh:
    for raw in fh:
        line = raw.rstrip("\n")
        m = re.match(r"^#{2,4}\s+(.*)$", line)
        if m:
            title = m.group(1).strip()
            if title.lower().startswith("what"):
                continue
            groups.append((title, []))
            continue
        m = re.match(r"^\s*[-*]\s+(.+)$", line)
        if m:
            item = m.group(1).replace("**", "").strip()
            if not item:
                continue
            if len(item) > ITEM_MAX:
                item = item[:ITEM_MAX].rsplit(" ", 1)[0].rstrip(",.;:") + ELLIPSIS
            if not groups:
                groups.append((None, []))
            groups[-1][1].append(item)
out, used, dropped = [], 0, 0
for heading, items in groups:
    kept = []
    for item in items:
        cost = len(BULLET) + len(item) + 1
        if dropped == 0 and used + cost <= budget:
            kept.append(BULLET + item)
            used += cost
        else:
            dropped += 1
    if not kept:
        continue
    if heading:
        out.append(heading)
        used += len(heading) + 1
    out.extend(kept)
if dropped:
    out.append("%s%sand %d more" % (BULLET, ELLIPSIS, dropped))
sys.stdout.write("\n".join(out))
')
  NOTE_CONTENT="${APP_NAME} ${RELEASE_TAG} is out!"$'\n\n'"${APP_TAGLINE:-}"
  [ -n "$BULLETS" ] && NOTE_CONTENT+=$'\n\n'"What's new:"$'\n'"${BULLETS}"
  NOTE_CONTENT+=$'\n\n'"${APP_WEBSITE:-}"$'\n'"https://github.com/${RELEASES_REPO}/releases/tag/${RELEASE_TAG}"
  NOTE_CONTENT+=$'\n\n'"nostr:${ZAPSTORE_NPUB}"$'\n\n'"${NOSTR_HASHTAGS:-}"
  NOSTR_RELAYS=(wss://relay.damus.io wss://nos.lol wss://relay.primal.net wss://relay.nostr.net)
  NOSTR_DRAFT=$(mktemp /tmp/nostr-note-XXXXXX.txt)
  printf '%s' "$NOTE_CONTENT" > "$NOSTR_DRAFT"
  echo "    Opening note in vi for review/editing..."
  vi "$NOSTR_DRAFT"
  NOTE_CONTENT=$(cat "$NOSTR_DRAFT")
  rm -f "$NOSTR_DRAFT"
  echo "    Final content:"
  echo "$NOTE_CONTENT" | sed 's/^/      /'
  echo ""
  echo "    Relays: ${NOSTR_RELAYS[*]}"
  _confirm "Post this note to Nostr?"
  if nak event --sec "$SIGN_WITH" -k 1 -c "$NOTE_CONTENT" -p "$ZAPSTORE_HEX" "${NOSTR_RELAYS[@]}"; then
    echo "    Nostr announcement posted."
  else
    echo "    WARNING: Nostr publish failed (non-fatal — release is already complete)."
  fi
fi

# ---------------------------------------------------------------------------
# 13. Close-out summary and deferred-action reminders
# ---------------------------------------------------------------------------
echo ""
echo "==> $APP_NAME $RELEASE_TAG"
$PUBLISH_GITHUB    && _report "GitHub"      "published" || _report "GitHub"      "skipped"
$PUBLISH_ZAPSTORE  && _report "Zapstore"    "published" || _report "Zapstore"    "skipped"
if $PUBLISH_PLAY; then _report "Google Play" "uploaded"
elif [ -f "$PLAY_AAB" ] && ! $SKIP_PLAY; then _report "Google Play" "by hand (steps above)"
else _report "Google Play" "skipped"; fi
$PUBLISH_APP_STORE && _report "App Store"   "uploaded"  || _report "App Store"   "skipped"
$UMBREL_BUILT      && _report "Umbrel"      "built"     || _report "Umbrel"      "skipped"
[ -n "$START9_S9PK" ] && _report "StartOS"  "built"     || _report "StartOS"     "skipped"
$PUBLISH_NOSTR     && _report "Nostr"       "announced" || _report "Nostr"       "skipped"
if $PUBLISH_FAILED; then
  echo ""
  echo "    WARNING: at least one publish step failed. Scroll up for which."
  echo "    Re-run with ./scripts/release.sh $RELEASE_TAG --retag once fixed."
fi

# ---------------------------------------------------------------------------
# 13b. Deferred-action reminders
# ---------------------------------------------------------------------------
if $APP_STORE_DEFERRED; then
  echo ""
  echo "==> Reminder: App Store review submission deferred"
  echo "    Apple was still processing the build. Once it is done (watch the email"
  echo "    or App Store Connect), attach it and submit in App Store Connect, or:"
  echo ""
  echo "      asc versions list --app $ASC_APP_ID --version $APP_VERSION"
  echo "      asc builds list --app $ASC_APP_ID --version $APP_VERSION"
  echo "      asc versions attach-build --version-id <VID> --build <BID>"
  echo "      asc review submissions-create --app $ASC_APP_ID --platform IOS"
  echo "      asc review items-add --submission <SID> --item-type appStoreVersions --item-id <VID>"
  echo "      asc review submissions-submit --id <SID> --confirm"
fi

# ---------------------------------------------------------------------------
# 13c. Community app store: publish it, then gate on it being published
#
# The store serves its default branch, so an open PR publishes nothing. This
# offers to merge the PR step 7b opened, then checks what origin/master
# serves, and exits non-zero while it is still the old version: an
# instruction can be walked past, a failed release cannot. Nothing above is
# rolled back; this only refuses to call the run clean.
# ---------------------------------------------------------------------------
if ! $SKIP_SEEDER_STORE && $UMBREL_BUILT; then
  _store_repo="$PEERLOOM/peerloom-umbrel-app-store"
  _branch_pr="pearoffice-seeder-v$APP_VERSION"
  _pr_state=$(cd "$_store_repo" && gh pr view "$_branch_pr" --json state -q .state 2>/dev/null || echo "")
  if [ "$_pr_state" = OPEN ]; then
    echo ""
    read -rp "    Merge the community store PR for $APP_VERSION now (publishes it)? [y/N] " _r || _r=n
    if [[ "$_r" == [Yy]* ]]; then
      (cd "$_store_repo" && gh pr merge "$_branch_pr" --merge --delete-branch) \
        || echo "    WARNING: merging the store PR failed."
    fi
  fi
  git -C "$_store_repo" fetch -q origin master
  _served=$(git -C "$_store_repo" show origin/master:peerloom-pearoffice-seeder/umbrel-app.yml 2>/dev/null \
    | sed -nE 's/^version: "?([0-9.]+)"?.*/\1/p')
  if [ "$_served" != "$APP_VERSION" ]; then
    echo ""
    echo "=========================================================================="
    echo "  RELEASE INCOMPLETE: the community app store was NOT published"
    echo "=========================================================================="
    echo ""
    echo "  The PeerLoom community store still serves ${_served:-nothing} for the seeder."
    echo "  Merge ${STORE_PR_URL:-its update PR} so Umbrel users get $APP_VERSION."
    echo "  Everything else in this release is live."
    echo ""
    exit 1
  fi
  echo "    Community store serves $APP_VERSION ✓"
fi
