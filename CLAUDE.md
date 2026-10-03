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

Expected to build on `@peerloom/core` (`/home/tim/peerloomllc/peerloom-core/`)
for identity, pairing and sync rather than copy-forking. Confirm in the wire
protocol proposal.

Origin, competitor survey and open hard parts: the PearSheet entry in
`/home/tim/peerloomllc/APP-IDEAS.md`.

## Status

Pre-scaffold. No wire protocol or code yet. The first piece of work is the v1
wire protocol proposal (T3) in `proposals/`. See `TODO.md`.

## The things to get right

- **Blind seeder.** The seeder stores and relays only encrypted blocks and is
  never given the sheet's encryption key. Nothing the seeder receives at
  pairing may let it decrypt. PearSheet ships its own seeder. See `DECISIONS.md`.
- **Deterministic merge and formulas.** Every device must reach the same cell
  values whatever order edits arrive in. Use an existing CRDT library (Yjs or
  Automerge) for merging, and make formula evaluation a pure function of the
  merged cells so the seeder never needs to compute anything.
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
