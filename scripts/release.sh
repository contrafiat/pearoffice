#!/usr/bin/env bash
# A PearOffice release, every platform. Two commands:
#
#   scripts/release.sh prepare <version>
#       Needs notes/release-<version>.md (plain-language notes, CLAUDE.md
#       rule 13, with a "## Downloads" section last, as release-0.1.0.md).
#       Sets the version everywhere (scripts/release/bump.js) on a branch
#       release/<version>, commits and opens the PR. Merge it, then:
#
#   scripts/release.sh publish [step ...]
#       On main. Builds, checks and publishes, asking before each step that
#       publishes anything. With no steps it runs them all, in this order:
#
#       desktop   Mac (Apple silicon, Intel; signed, notarized), Linux and
#                 Windows (on the win11 VM if you let it start, else Wine),
#                 each with its packaged smoke test
#       seeder    the Linux seeder download, the Umbrel/StartOS image
#                 (built, not pushed) and the .s9pk
#       android   the signed APK and app bundle
#       github    the release on peerloomllc/pearoffice-releases: desktop,
#                 seeder, APK and .s9pk, each with a .sha256
#       zapstore  the APK to Zapstore
#       appstore  App Store: version, listing text, build upload, then
#                 submit for review
#       umbrel    push the image; PRs to the PeerLoom community store and
#                 the official getumbrel/umbrel-apps store
#       startos   PR to the website's StartOS registry
#       play      prints the Google Play steps (by hand in the Console)
#       nostr     a "PearOffice <version> is out" note from the Zapstore
#                 key, edited in $EDITOR (vi) before it is posted
#
#   DRY_RUN=1 scripts/release.sh publish ...   builds but publishes nothing.
#
# Needs: scripts/.env (Android signing and Zapstore), gh, asc (App Store
# Connect key in ~/.appstoreconnect), podman and skopeo (ghcr login), the
# Mac Mini, and clones of the sibling repos ../website,
# ../peerloom-umbrel-app-store and ../umbrel-apps (PeerLoom's fork).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
PEERLOOM="$(dirname "$ROOT")"
RELEASES=peerloomllc/pearoffice-releases
ASC_APP_ID=6820799007
IMAGE=ghcr.io/peerloomllc/pearoffice-seeder
DRY_RUN="${DRY_RUN:-0}"
# Zapstore's Nostr account, tagged in the announcement.
ZAPSTORE_HEX=78ce6faa72264387284e647ba6938995735ec8c7d5c5a65737e55130f026307d
ZAPSTORE_NPUB=npub10r8xl2njyepcw2zwv3a6dyufj4e4ajx86hz6v4ehu4gnpupxxp7stjt2p8
NOSTR_RELAYS=(wss://relay.damus.io wss://nos.lol wss://relay.primal.net wss://relay.nostr.net)

say () { printf '\n==> %s\n' "$*"; }
die () { echo "error: $*" >&2; exit 1; }
# Asks before a step that publishes. Never in a dry run.
confirm () {
  if [ "$DRY_RUN" = 1 ]; then echo "dry run: not doing \"$1\""; return 1; fi
  local a; read -r -p "$1 [y/N] " a </dev/tty
  [[ "$a" == [yY]* ]]
}
version () { node -p "require('$ROOT/package.json').version"; }
# A fresh checkout of <repo>'s <base> in a temporary folder (removed on exit).
WORKTREES=()
cleanup () { for w in "${WORKTREES[@]:-}"; do [ -n "$w" ] && git -C "${w%%|*}" worktree remove --force "${w#*|}" 2>/dev/null; done; return 0; }
trap cleanup EXIT
worktree () { # repo remote base branch -> sets WT to the folder
  local repo="$1" remote="$2" base="$3" branch="$4"
  WT="$(mktemp -d)/wt"
  git -C "$repo" fetch -q "$remote"
  git -C "$repo" worktree add -q -B "$branch" "$WT" "$remote/$base"
  WORKTREES+=("$repo|$WT")
}

# --- prepare ------------------------------------------------------------------

prepare () {
  local v="${1:?usage: scripts/release.sh prepare <version>}"
  local notes="notes/release-$v.md"
  [ -f "$notes" ] || die "write $notes first (see notes/release-0.1.0.md)"
  [ -z "$(git status --porcelain --untracked-files=no)" ] || die "commit or stash your changes first"
  git checkout -q main && git pull -q
  git checkout -q -b "release/$v"
  node scripts/release/bump.js "$v" "$notes"
  git add -A package.json desktop/package.json app.json start9/seeder/startos "$notes"
  git commit -q -m "Release $v"
  if confirm "Push release/$v and open its PR?"; then
    git push -q -u origin "release/$v"
    gh pr create --title "Release $v" --body "Sets the version to $v everywhere (scripts/release/bump.js) and adds \`$notes\`. After merging: \`scripts/release.sh publish\` on main."
  fi
}

# --- the notes in each store's shape -----------------------------------------

notes_files () {
  local v; v="$(version)"
  NOTES="notes/release-$v.md"
  [ -f "$NOTES" ] || die "no $NOTES"
  mkdir -p dist/release
  # Phones: everything above "## Downloads".
  ANDROID_NOTES="dist/release/notes-android.md"
  awk '/^## Downloads/{exit} {print}' "$NOTES" | sed -e :a -e '/^\n*$/{$d;N;ba' -e '}' > "$ANDROID_NOTES"
  # App Store "What's New": plain text.
  WHATS_NEW="$(sed -e 's/\*\*//g' -e 's/^## //' "$ANDROID_NOTES")"
  # Google Play: at most 500 characters.
  # Google Play: at most 500 characters, so whole lines while they fit.
  PLAY_NOTES="$(printf '%s\n' "$WHATS_NEW" | node -e "
    const lines = require('fs').readFileSync(0, 'utf8').split('\n').filter((l) => l.trim() && !/^[A-Z][A-Za-z ]+$/.test(l.trim()))
    const out = []
    for (const l of lines) { if ([...out, l].join('\n').length > 500) break; out.push(l) }
    console.log(out.join('\n'))")"
}

# --- steps --------------------------------------------------------------------

step_desktop () {
  say "desktop: Mac (Apple silicon, Intel), Linux, Windows"
  npm run dist:mac
  npm run dist:mac:intel
  npm run dist:linux
  if virsh -c qemu:///system domstate win11-pearguard 2>/dev/null | grep -q running || confirm "Start the win11-pearguard VM (8 GB of RAM) to build and test Windows there? (No: build with Wine, untested)"; then
    virsh -c qemu:///system start win11-pearguard 2>/dev/null || true
    for _ in $(seq 1 60); do ssh -o BatchMode=yes -o ConnectTimeout=5 "${WINDOWS_VM_HOST:-ben@192.168.50.157}" exit 2>/dev/null && break; sleep 5; done
    npm run dist:windows:vm
    virsh -c qemu:///system shutdown win11-pearguard >/dev/null 2>&1 || true
  else
    npm run dist:windows
  fi
}

step_seeder () {
  say "seeder: Linux download, Umbrel/StartOS image, .s9pk"
  npm run dist:seeder
  PUSH=0 scripts/build-umbrel-image.sh
  (cd start9/seeder && npm install --silent --no-audit --no-fund && make)
  local got; got="$(start-cli-1.1.0 s9pk inspect start9/seeder/pearoffice-seeder_x86_64.s9pk manifest | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).version")"
  [ "$got" = "$(version):0" ] || die "the .s9pk is $got, expected $(version):0"
}

step_android () {
  say "android: signed APK and app bundle"
  scripts/build-android-release.sh
}

desktop_files () {
  local v; v="$(version)"
  printf '%s\n' \
    "desktop/dist/pearoffice-$v-linux-x86_64.AppImage" \
    "desktop/dist/pearoffice-$v-linux-amd64.deb" \
    "desktop/dist/PearOffice-$v-mac-arm64.dmg" \
    "desktop/dist/PearOffice-$v-mac-arm64.zip" \
    "desktop/dist/PearOffice-$v-mac-x64.dmg" \
    "desktop/dist/PearOffice-$v-mac-x64.zip" \
    "desktop/dist/PearOffice-Setup-$v.exe" \
    "dist/seeder-pkg/pearoffice-seeder-$v-linux-x64.tar.gz" \
    "dist/seeder-pkg/pearoffice-seeder-$v-linux-arm64.tar.gz" \
    "dist/android/pearoffice-$v.apk" \
    "start9/seeder/pearoffice-seeder_x86_64.s9pk"
}

step_github () {
  local v; v="$(version)"
  say "github: v$v on $RELEASES"
  [ "$(node -p "require('./desktop/package.json').version")" = "$v" ] || die "desktop/package.json is not $v"
  local missing=0 assets=() f
  while read -r f; do
    [ -f "$f" ] || { echo "missing $f" >&2; missing=1; continue; }
    (cd "$(dirname "$f")" && sha256sum "$(basename "$f")" > "$(basename "$f").sha256")
    assets+=("$f" "$f.sha256")
    echo "  $(cut -c1-16 "$f.sha256")...  $(basename "$f")"
  done < <(desktop_files)
  [ "$missing" = 0 ] || die "build the missing files first (steps desktop, seeder, android)"
  if confirm "Publish v$v on $RELEASES with ${#assets[@]} files?"; then
    gh release create "v$v" -R "$RELEASES" --title "PearOffice $v" --notes-file "$NOTES" "${assets[@]}"
  fi
}

step_zapstore () {
  say "zapstore: PearOffice $(version)"
  DRY_RUN=1 scripts/publish-zapstore.sh "$ANDROID_NOTES" >/dev/null
  if confirm "Publish PearOffice $(version) to Zapstore?"; then scripts/publish-zapstore.sh "$ANDROID_NOTES"; fi
}

step_appstore () {
  local v vid; v="$(version)"
  say "appstore: $v"
  vid="$(asc versions list --app "$ASC_APP_ID" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')).data;const x=d.find((x)=>x.attributes.versionString==='$v');console.log(x?x.id:'')")"
  if [ -z "$vid" ]; then
    confirm "Create App Store version $v?" || return 0
    vid="$(asc versions create --app "$ASC_APP_ID" --version "$v" --platform IOS | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).data.id")"
  fi
  mkdir -p "metadata/ios/version/$v"
  node -e "const f=require('fs');const o=JSON.parse(f.readFileSync('metadata/ios/version/default/en-US.json','utf8'));o.whatsNew=process.argv[1];f.writeFileSync('metadata/ios/version/$v/en-US.json',JSON.stringify(o,null,2)+'\n')" "$WHATS_NEW"
  asc metadata apply --app "$ASC_APP_ID" --version "$v" --dir metadata/ios --dry-run >/dev/null
  confirm "Apply the App Store listing text for $v?" && asc metadata apply --app "$ASC_APP_ID" --version "$v" --dir metadata/ios >/dev/null
  confirm "Build and upload the iOS app for $v?" || return 0
  scripts/ios-appstore.sh
  local build="" state=""
  local number; number="$(node -p "require('./app.json').expo.ios.buildNumber")"
  say "appstore: waiting for Apple to process build $number"
  for _ in $(seq 1 60); do
    read -r build state < <(asc builds list --app "$ASC_APP_ID" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')).data.find((b)=>b.attributes.version==='$number');console.log(d?d.id+' '+d.attributes.processingState:'- -')")
    [ "$state" = VALID ] && break
    if [ "$state" = INVALID ] || [ "$state" = FAILED ]; then die "build $number is $state"; fi
    sleep 60
  done
  [ "$state" = VALID ] || die "build $number not processed after an hour; attach and submit later"
  asc versions attach-build --version-id "$vid" --build "$build" >/dev/null
  asc review doctor --app "$ASC_APP_ID" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log('  review check:',JSON.stringify(d.summary));for(const c of d.blockingChecks||[])console.log('  blocking:',c.id,c.message)"
  if confirm "Submit $v for App Review?"; then
    local sid
    sid="$(asc review submissions-create --app "$ASC_APP_ID" --platform IOS | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).data.id")"
    asc review items-add --submission "$sid" --item-type appStoreVersions --item-id "$vid" >/dev/null
    asc review submissions-submit --id "$sid" --confirm >/dev/null
    echo "  submitted; watch with: asc review status --app $ASC_APP_ID"
  fi
}

# Version, release notes and image digest in an Umbrel app's two files.
umbrel_bump () { # dir version digest notes
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

step_umbrel () {
  local v digest notes; v="$(version)"
  say "umbrel: image and store entries for $v"
  if confirm "Push $IMAGE:$v (amd64, arm64) to ghcr?"; then
    scripts/build-umbrel-image.sh
  fi
  digest="sha256:$(skopeo inspect --raw "docker://$IMAGE:$v" | sha256sum | cut -d' ' -f1)" || die "no $IMAGE:$v on ghcr"
  notes="Updated PearOffice Seeder to $v. Full release notes: https://github.com/$RELEASES/releases/tag/v$v"

  # The PeerLoom community store.
  worktree "$PEERLOOM/peerloom-umbrel-app-store" origin master "pearoffice-seeder-v$v"; local store="$WT"
  umbrel_bump "$store/peerloom-pearoffice-seeder" "$v" "$digest" "$notes"
  git -C "$store" diff --stat
  if confirm "Open the PeerLoom community store PR for $v?"; then
    git -C "$store" commit -qam "peerloom-pearoffice-seeder: update to $v"
    git -C "$store" push -q -f origin "pearoffice-seeder-v$v"
    (cd "$store" && gh pr create --base master --title "peerloom-pearoffice-seeder: update to $v" --body "Image pinned to the multi-arch manifest-list digest ($digest).")
  fi

  # The official store. While the first listing (#6172) is open, refresh its
  # branch; once merged, a new update PR off upstream each release.
  local fork="$PEERLOOM/umbrel-apps" official branch
  git -C "$fork" remote get-url upstream >/dev/null 2>&1 || git -C "$fork" remote add upstream https://github.com/getumbrel/umbrel-apps.git
  git -C "$fork" fetch -q upstream
  if git -C "$fork" cat-file -e upstream/master:pearoffice-seeder/umbrel-app.yml 2>/dev/null; then
    branch="pearoffice-seeder-v$v"
    worktree "$fork" upstream master "$branch"; official="$WT"
  else
    branch="pearoffice-seeder"
    git -C "$fork" fetch -q origin "$branch"
    worktree "$fork" origin "$branch" "$branch-update"; official="$WT"
  fi
  umbrel_bump "$official/pearoffice-seeder" "$v" "$digest" "$notes"
  git -C "$official" diff --stat
  if confirm "Push the official getumbrel/umbrel-apps update for $v?"; then
    git -C "$official" commit -qam "pearoffice-seeder: update to $v"
    git -C "$official" push -q -f origin "HEAD:$branch"
    if [ "$branch" = pearoffice-seeder ]; then
      echo "  refreshed the open listing PR: https://github.com/getumbrel/umbrel-apps/pull/6172"
    else
      gh pr create --repo getumbrel/umbrel-apps --base master --head "peerloomllc:$branch" \
        --title "pearoffice-seeder: update to $v" --body "Bump PearOffice Seeder to $v (image pinned to the multi-arch manifest-list digest)."
    fi
  fi
}

step_startos () {
  local v site; v="$(version)"
  say "startos: registry entry for $v"
  worktree "$PEERLOOM/website" origin main "registry/pearoffice-seeder-$v"; site="$WT"
  START_CLI=start-cli-1.1.0 node start9/registry/build-registry-04.js start9/seeder/pearoffice-seeder_x86_64.s9pk \
    --url https://peerloomllc.com/package/v1/pearoffice-seeder.s9pk --icon start9/seeder/icon.png --out "$site/registry/0.4/index.json"
  sed -i -E "s#(pearoffice-releases/releases/download/)v[0-9.]+(/pearoffice-seeder_x86_64.s9pk)#\1v$v\2#" "$site/_redirects"
  git -C "$site" diff --stat
  if confirm "Open the website PR for the StartOS registry ($v)? (Merging it publishes.)"; then
    git -C "$site" commit -qam "StartOS registry: PearOffice seeder $v"
    git -C "$site" push -q -f origin "registry/pearoffice-seeder-$v"
    (cd "$site" && gh pr create --title "StartOS registry: PearOffice seeder $v" --body "pearoffice-seeder $v:0 in registry/0.4/index.json and its s9pk redirect to the v$v release asset.")
  fi
}

step_play () {
  local v; v="$(version)"
  say "play: by hand in the Play Console"
  cat <<EOF
  1. Test and release > Testing > Closed testing (or Production) > Create new release
  2. Upload $ROOT/dist/android/pearoffice-$v.aab
  3. Release name: $v
  4. Release notes:
<en-US>
$PLAY_NOTES
</en-US>
  5. Next, check the review page, then Save and publish
EOF
}

step_nostr () {
  local v; v="$(version)"
  say "nostr: the announcement"
  command -v nak >/dev/null || die "nak not found (https://github.com/fiatjaf/nak/releases)"
  set -a; . scripts/.env; set +a
  : "${SIGN_WITH:?SIGN_WITH (Zapstore nsec) missing from scripts/.env}"
  local draft; draft="$(mktemp --suffix=.txt)"
  {
    printf 'PearOffice %s is out!\n\n' "$v"
    printf 'Spreadsheets, documents and slides you share with a link and edit together, straight between your devices. No account, no server, no cloud.\n\n'
    node scripts/release/nostr-bullets.js "$ANDROID_NOTES" "${NOSTR_NOTE_BUDGET:-900}"
    printf '\nhttps://peerloomllc.com/pearoffice/\nhttps://github.com/%s/releases/tag/v%s\n\n' "$RELEASES" "$v"
    printf 'nostr:%s\n\n' "$ZAPSTORE_NPUB"
    printf '#PearOffice #Nostr #P2P #privacy #spreadsheets #Android #iOS #Zapstore\n'
  } > "$draft"
  if [ "$DRY_RUN" = 1 ]; then sed 's/^/    /' "$draft"; rm -f "$draft"; echo "dry run: not posting"; return; fi
  "${EDITOR:-vi}" "$draft" </dev/tty >/dev/tty
  local note; note="$(cat "$draft")"; rm -f "$draft"
  printf '%s\n' "$note" | sed 's/^/    /'
  echo "    relays: ${NOSTR_RELAYS[*]}"
  if confirm "Post this note to Nostr?"; then
    nak event --sec "$SIGN_WITH" -k 1 -c "$note" -p "$ZAPSTORE_HEX" "${NOSTR_RELAYS[@]}"
  fi
}

# --- main ---------------------------------------------------------------------

STEPS=(desktop seeder android github zapstore appstore umbrel startos play nostr)
case "${1:-}" in
  prepare) shift; prepare "$@" ;;
  publish)
    shift
    if [ "${RELEASE_ANY_BRANCH:-0}" != 1 ]; then # testing this script only
      [ "$(git branch --show-current)" = main ] || die "publish from main (after merging the release PR)"
      git pull -q
    fi
    run=("$@"); [ ${#run[@]} -gt 0 ] || run=("${STEPS[@]}")
    for s in "${run[@]}"; do [[ " ${STEPS[*]} " == *" $s "* ]] || die "unknown step $s (steps: ${STEPS[*]})"; done
    notes_files
    say "PearOffice $(version): ${run[*]}$([ "$DRY_RUN" = 1 ] && echo ' (dry run)')"
    for s in "${run[@]}"; do "step_$s"; done
    say "done"
    ;;
  *) sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
