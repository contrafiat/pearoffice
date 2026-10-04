# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

Constitution applies. See `/home/tim/peerloomllc/CONSTITUTION.md` for risk tiers,
proposal gate, DECISIONS convention, verify gate and wiki-sync rules.

## Project Overview

PearSheet is a peer-to-peer shared spreadsheet app for Android, iOS and
(later) desktop. No accounts. No servers. No cloud. A sheet is shared with a
small group who co-edit it live, device to device. Shared documents are phase 2
and absorb the former PearNote idea.

It uses the same three-layer architecture as the rest of the suite:
- React Native (Expo) shell
- WebView React UI
- Bare worklet (P2P backend)

Builds on `@peerloom/core` (`/home/tim/peerloomllc/peerloom-core/`)
for identity, pairing and sync rather than copy-forking (confirmed in the wire
protocol proposal).

Origin, competitor survey and open hard parts: the PearSheet entry in
`/home/tim/peerloomllc/APP-IDEAS.md`.

## Status

v1 wire protocol approved: `proposals/2026-10-03-wire-protocol.md`. Desktop
first (Electron), then mobile (Android first). The engine is scaffolded: the
Bare worklet, the Yjs sheet model, the vendored formula engine and sync over
`@peerloom/core`. The Electron shell and grid UI work on Linux. Sharing works: single-use
invites, owner, editor and viewer roles, renames. The blind seeder works:
pair by link, every member backs up to it, a member can catch up from it
alone. Removal by key move, packaging and the mobile app are next.
See `TODO.md`.

## Layout

- `src/shared/` - runs anywhere (Bare, Node, browser): `sheetModel.js` (the
  Yjs document), `refs.js` (A1 <-> id formula references), `formula/`
  (evaluator, deterministic maths, formulajs fills, vendored
  fast-formula-parser).
- `src/worklet/` - the Bare program: `bare.js` entry, `engine.js` (core
  wiring), `sheetWire.js` (apply rules), `membership.js` (signed membership
  ops, built and checked), `join.js` (the `pearsheet/join/1` handshake),
  `sheetMethods.js` (IPC), `sheets.js` (live documents).
- `src/ui/` - the React spreadsheet UI. Talks only to `window.pearsheet`
  (`call`, `on`), which the desktop preload provides and the mobile WebView
  will provide later. Built to `dist/ui` by `scripts/build-ui.mjs`.
- `desktop/` - the Electron shell: `main.js` starts the worklet bundle with
  the bare-runtime binary and relays IPC, `preload.js` is the bridge,
  `smoke.js` + `smoke-run.js` are the offscreen smoke test. Has its own
  `package.json` (Electron): `npm install --prefix desktop`.
- `src/seeder/` - the blind seeder: `seeder.js` (blind-peer plus the rule
  that it stores only sheets a paired device registered), `protocol.js`
  (pairing link and topic, shared with the app), `bare.js` (CLI entry).
  The app side is `src/worklet/seeding.js`.
- `spikes/` - the 2026-10-03 research spikes and their `RESULTS.md`.

## Running

`npm run desktop` builds the UI and worklet and opens the app, using
`~/.pearsheet-dev` for data (override with `PEARSHEET_DATA`).

`npm run seeder` builds and runs the seeder with data in `~/.pearsheet-seeder`
(override with `PEARSHEET_SEEDER_DATA`). It prints a pairing link; type `pair`
for a new one and `status` for counts.

## Packaging

Installers land in `desktop/dist/`. Each build ends with the packaged smoke
test (`scripts/smoke-packaged.js`) run against the installed-layout app.

- `npm run dist:linux` - AppImage and deb, built here.
- `npm run dist:mac` - dmg and zip for Apple silicon, built on the Mac Mini
  over SSH in `~/peerloomllc/pearsheet-build` (`scripts/build-desktop-mac.sh`;
  pass `x64` for Intel, smoke-tested under Rosetta).
- `npm run dist:windows` - NSIS installer, built on the local libvirt VM
  `win11-pearguard` (start it with `virsh -c qemu:///system start
  win11-pearguard`, shut it down after).

`scripts/stage-desktop.js` gathers the Bare runtime, the worklet bundle with
the target's addons and the minified UI into `desktop/build/resources`, which
electron-builder copies into the app (`desktop/paths.js` finds them). All
builds are unsigned for now.

## Verify

`npm run verify` is the merge gate (Constitution §5). It runs:

- `npm test`: `node --test test/*.test.js`. Formula corpus against Excel and a
  golden file, the same corpus in four timezones, formula reference
  translation, Yjs merging, bad-update handling, a two-engine sync test and
  the invite and role rules (single use, expiry, viewers cannot write, forged
  and replayed ops skipped) and the seeder (pairing, sync from the seeder
  alone, no readable data on it, strangers refused), all over a local DHT
  testnet.
- `npm run test:bare`: bundles for this machine and runs the real Bare binary.
  The formula corpus must match the golden file bit for bit, and the worklet
  bundle must create, edit and read a sheet over stdin/stdout, and the seeder
  bundle must start and print a pairing link.
- `npm run smoke:desktop`: launches Electron with an offscreen window and a
  throwaway data folder, creates a sheet through the UI, types with real key
  events and checks formula, bold, undo and rename. About 15 s. Skipped (with
  a message) when there is no display.

After a deliberate formula change, regenerate the golden file with
`UPDATE_GOLDEN=1 node --test test/formula.test.js` and say why in the commit.

Formula code must never use `**`, and `Math.pow`, `Math.sin` and `Math.cos`
are replaced at start-up (`src/shared/formula/detmath.js`). A test fails if a
`**` appears under `src/shared/formula/`.

## The things to get right

- **Blind seeder.** The seeder stores and relays only encrypted blocks and is
  never given the sheet's encryption key. Nothing the seeder receives at
  pairing may let it decrypt. PearSheet ships its own seeder. See `DECISIONS.md`.
- **Deterministic merge and formulas.** Every device must reach the same cell
  values whatever order edits arrive in. Yjs does the merging. Formula
  evaluation is a pure function of the merged cells, so the seeder never needs
  to compute anything.
- **File compatibility.** .xlsx import and export, not perfect round-trips, in v1.

## Prior art in this repo family

- PearCal already uses `blind-peering` (`pearcal-native/src/bare.js`,
  `pearcal-native/src/seed.js`).
- Wiki: `p2p-wiki/wiki/concepts/blind-peers.md`, `seeder-qr-pairing.md`,
  `blind-relay-off-lan-backstop.md`.
- PearTune's blind relay: `peartune/DECISIONS.md`.

## Branch Strategy

Always branch before work. Never commit directly to main (the initial repo
scaffold commit excepted).
- Feature branches: `feature/description`
- Bug fix branches: `bugfix/description`
- Merge via GitHub PR
