# Update checker for the desktop app and the seeder download

**Status:** approved by Tim 2026-10-05 (releases in a separate public repo;
the code moves into `@peerloom/host` first).

**Goal:** the desktop app and the headless Linux seeder notice a new
PearSheet release and install it on request, as the PearCircle seeder and
PearTune do. The Umbrel and Start9 builds never check: their stores update
them.

**Tier:** T1. Nothing shared between devices changes.

## Where releases live

`peerloomllc/pearsheet` is private, and an app cannot read a private repo's
releases without a token. Releases go to a new public repo,
`peerloomllc/pearsheet-releases`, which holds only release notes and
installers. The checker reads
`https://api.github.com/repos/peerloomllc/pearsheet-releases/releases/latest`.

Every installer gets a `<name>.sha256` file next to it. Nothing is installed
unless the download matches it.

## Shared code

PearTune's `host/update-check.js` and `host/update-apply.js` (a port of the
PearCircle seeder's) move to `peerloom-host/src/update-check.js` and
`src/update-apply.js`, with the app-specific parts (repo, file names,
environment variable prefix, service names, the macOS app name) passed in.
They use only Node built-ins. PearSheet keeps a copy in
`desktop/vendor/peerloom-host/` (`scripts/vendor-peerloom-host.js`, checked
by `test/vendor.test.js`), with `dashboard-auth.js` for the Umbrel image. PearTune switches over later.

## Desktop app

- Checks a minute after start and then hourly; fails quietly. Off in
  development runs.
- A bar at the top: "PearSheet 0.2.0 is out." with "See what changed",
  "Update now" and a close button remembered per version. The tray menu
  gets "Update to 0.2.0".
- "Update now" downloads the installer for this computer, checks its
  `.sha256`, installs it and restarts PearSheet:
  - AppImage: replaces the file and relaunches. Electron's own relaunch
    runs from the AppImage's mount, which is gone once the app exits, so a
    small shell outside it waits for the app to exit and starts the new
    file (measured 2026-10-05: Electron's relaunch never came back).
  - .deb: `pkexec dpkg -i`, which asks for the computer's password.
  - Windows: runs the installer silently and quits; the installer starts
    the new version.
  - macOS: mounts the .dmg, checks the app inside is signed by PeerLoom's
    Apple team (G79ALD29NA), swaps it in and relaunches.
  - Anything that fails offers the download page instead.
- `PEARSHEET_NO_UPDATE_CHECK=1` turns it off.

## Seeder download (Linux, no screen)

The launcher script checks at start and then daily with `curl` and prints a
line when a newer version is out. `pearsheet-seeder update` downloads the
tarball for this machine, checks its `.sha256`, replaces `bare` and
`seeder/` and restarts the systemd user service if it is running. The Bare
seeder itself does not change.

## Umbrel and Start9

The checker is off inside a container (`/.dockerenv`), and the image sets
`PEARSHEET_NO_UPDATE_CHECK=1` as well.

## Releasing

`scripts/release.sh <version>` checks every installer and seeder tarball
for that version is built, writes the `.sha256` files and creates the
release on `pearsheet-releases` with `gh release create`. Building stays
with the existing `dist:*` scripts.

## Checks

- peerloom-host: PearTune's tests, ported, against the new options.
- PearSheet: a fake release served locally
  (`PEARSHEET_UPDATE_LATEST_URL`) with a newer AppImage; the AppImage
  updates itself and comes back on the new version. The seeder `update`
  command against the same fake release. Windows and macOS: install the
  older build, publish the newer one, press Update now.
