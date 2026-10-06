# Rename PearSheet to PearOffice

**Status:** approved by Tim 2026-10-06 (reset the test devices; remove the
Umbrel listing until the first release).

**Goal:** the app that will hold sheets, documents and later slides is
called PearOffice everywhere, from the store name to the internal labels,
before the first release fixes any of them.

**Tier:** T3. Every wire and signing label changes, so a renamed build and
a PearSheet build cannot share a sheet.

## Decided 2026-10-06

- One app for sheets, documents and slides (DECISIONS.md 2026-10-06).
- Sharing stays one file at a time.
- The public name is picked first and used for the internal ids too:
  **PearOffice**.
- Rename and reorganise the repo and folders.
- Order: this rename, then the first release.

## Scope

Three PRs, in this order.

### 1. The rename (mechanical)

| What | Now | After |
| --- | --- | --- |
| Android and iOS app id | `com.pearsheet`, `com.pearsheet.debug` | `com.pearoffice`, `com.pearoffice.debug` |
| Desktop app id and name | `com.peerloomllc.pearsheet`, PearSheet | `com.peerloomllc.pearoffice`, PearOffice |
| Links | `pearsheet://join`, `link`, `seeder` | `pearoffice://join`, `link`, `seeder` |
| Channels | `pearsheet/join/1`, `link/1`, `seeder/1`, `seeder-pair/1`, `presence/1` | `pearoffice/...` |
| Signing purposes | `pearsheet/member/v1`, `role/v1`, `invite/v1` and the other 13 | `pearoffice/...` |
| Engine app id (storage folder) | `pearsheet` | `pearoffice` |
| Data folders | `~/.pearsheet-dev`, `~/.pearsheet-seeder`, `PEARSHEET_*` variables | `~/.pearoffice-dev`, `~/.pearoffice-seeder`, `PEAROFFICE_*` |
| Seeder download and image | `pearsheet-seeder`, `ghcr.io/peerloomllc/pearsheet-seeder` | `pearoffice-seeder`, `ghcr.io/peerloomllc/pearoffice-seeder` |
| Update checks | `peerloomllc/pearsheet-releases` (not created yet) | `peerloomllc/pearoffice-releases` |
| GitHub repo | `peerloomllc/pearsheet` | `peerloomllc/pearoffice` (GitHub redirects the old address) |
| Folder on disk | `/home/tim/peerloomllc/pearsheet` | `/home/tim/peerloomllc/pearoffice` |
| Mac build folder | `~/peerloomllc/pearsheet-build` | `~/peerloomllc/pearoffice-build` |

Also: the Umbrel store entry (`peerloom-pearsheet-seeder` becomes
`peerloom-pearoffice-seeder`), the Start9 package, `@peerloom/host`'s test
configs and README that name PearSheet, `APP-IDEAS.md`, the suite
`CLAUDE.md` and wiki pages that say PearSheet, and this project's Claude
memory folder (copied to the new path).

Kept as they are: old proposals, `DECISIONS.md` and `DONE.md` entries (they
describe what happened under the old name), and the word "sheet" where it
means a spreadsheet.

### 2. Each file records its type

A `kind` field in each file's root map: `sheet` (later `doc`, `slides`).
Files without one are sheets. The file list, invite links and the join
welcome carry it, so a device can show the right icon before it opens a
file. The seeder never needs it.

### 3. Code layout

The parts that work for any file (identity, invites and roles, joining,
seeding, moves, deleting, linking, profiles, presence) stay in
`src/worklet/` and `src/shared/`. The spreadsheet parts (grid, formulas,
charts, .xlsx) move under `src/sheet/` (engine side) and `src/ui/sheet/`
(UI). Documents get `src/doc/` and `src/ui/doc/` when that work starts.
This is a move with no change in behavior.

## Compat

Nobody outside Tim's devices runs PearSheet: there is no release, no store
listing, and the seeder image is not public. A renamed build cannot open
sheets made by a PearSheet build, because their stored ops are signed with
the old purposes.

Proposed: reset the test devices (uninstall `com.pearsheet.debug`, clear
`~/.pearsheet-dev` and the seeders' data) instead of writing a migration
for test data. Sheets worth keeping can be saved as .xlsx first and imported
again.

## Verify

- `npm run verify` passes.
- `git grep -i pearsheet` finds only the kept history (proposals,
  DECISIONS, DONE).
- Fresh installs on the emulator, the TCL, the iPhone Simulator and the
  desktop; two devices share a file, a seeder pairs and backs it up.
- The packaged builds for Linux, macOS (signed, notarized) and Windows
  start.

## Rollback

Before the first release: revert the PRs and rename the GitHub repo back.
After it, there is no rollback, which is why this goes first.

## Decided at approval

1. **Test devices are reset**, with no migration. Sheets worth keeping go
   out as .xlsx first.
2. **The Umbrel store entry is removed** until the first release, then
   added back as PearOffice.
