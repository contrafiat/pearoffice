# Shared compaction: tidy a long-lived sheet by moving it

**Status:** approved by Tim 2026-10-05: automatic at 50,000 updates plus the menu item; keep the old copy up to 90 days.

**Goal:** a sheet edited for years stops costing about 2 KB of disk per edit
on every device and the seeder, and a new device joins it without downloading
every edit ever made.

**Tier:** T2. It adds a field to the shared `move` op and changes what a
device does when it follows a move.

## The problem, measured

From `bench/RESULTS.md` (2026-10-03):

| Edits | Disk per device | Yjs state | A new device joins |
| --- | --- | --- | --- |
| 10,000 | 45 MB | 300 KB | 3.8 s |
| 100,000 | 203 MB | 2.6 MB | (not measured; about 10x) |

Disk is about 2 KB per edit: every `y` op stays in the editor's writer core,
the system core and the view, each with Merkle data and encryption padding.
Local snapshots (PR #21) fixed reopening; nothing yet shrinks the history.
A household budget edited daily stays under 100 MB for years, so this
matters for heavy sheets, not typical ones.

## The idea: compaction is a move that keeps everyone

Removing someone already moves the sheet to fresh keys
(`src/worklet/moves.js`, wire protocol section 7): the owner's device builds
a new sheet whose first `y` op is the whole current document, carries the
members, devices and seeders across, and appends `move` to the old sheet,
which freezes it. Everyone follows. A week later devices remove the frozen
copy and the seeder drops it (`deleting.js`, `afterMove`).

That is already a compaction: the new sheet's history is one update. So
compacting is a move with nobody removed. What it needs on top:

1. **`move` gets `reason: 'compact' | 'remove'`.** Only so the app can say
   "This sheet was tidied up" instead of "You were removed" or "Someone was
   removed". Older builds ignore the field and follow as they do today.
2. **Nothing typed in the old sheet is lost.** Today an edit that reaches
   the old sheet after the owner took its snapshot is dropped: the old sheet
   is frozen, and someone who edited offline loses those edits when they
   come back. That is rare for removals and would be common for
   compaction. Fix: when a writer device follows a move, it sends the new
   sheet whatever its copy of the old document has that the new one lacks
   (`Y.encodeStateAsUpdate(oldDoc, stateVector(newDoc))`, a normal `y` op).
   This works because the new sheet starts from the same Yjs document, not
   a fresh one. It fixes removals too. A viewer cannot write, but has
   nothing of their own to carry.
3. **Nobody is stranded.** A device that stays offline longer than the
   week cleanup finds no one still holding the old sheet, so it never sees
   the move. For compaction (where everyone stays) the owner's device keeps
   its frozen copy, and asks the seeder to keep it, until every member's
   devices have joined the new sheet or 90 days have passed, whichever is
   first. Removals keep the week.
4. **Unused invite links.** A move does not carry invites, so a link sent
   before compaction stops working. The owner's device compacts only when
   it has no unused, unexpired invites.

## What it does not reset

The Yjs document keeps a small record of every overwritten value (about
26 bytes per edit: 2.6 MB at 100,000 edits). Starting a fresh Yjs document
would clear it, but then edits made offline against the old document could
no longer be merged, which is point 2. 26 bytes per edit is small enough to
keep.

## When it runs

Recommended: **automatically on the owner's device**, when the sheet's
history passes **50,000 updates** (about 100 MB on disk), the owner has the
sheet open, and there are no unused invites. Nobody has to know the word
"compaction". The sheet menu also gets **Tidy up this sheet** for the owner,
for a sheet that is slow to join.

The alternative is manual only. It is simpler, but most owners would never
find it.

## What people see

- Owner: after an automatic tidy-up, a short note: "PearSheet tidied up a
  long sheet: devices now keep it as it is, not every change ever made."
  Undo history restarts in the new copy.
- Everyone else: the sheet keeps its place in the list and opens as before;
  for a moment it shows "Updating this sheet..." while their device follows.

## Files

- `src/worklet/moves.js`: `compact(sheetId)` (the move without removal),
  `reason` on the op, and the carry-over in `onMoved`.
- `src/worklet/membership.js`: `moveOp` takes `reason`; `apply` records it.
- `src/worklet/deleting.js`: the longer keep for compaction moves.
- `src/worklet/sheets.js` or `engine.js`: count updates, start the automatic
  run.
- UI: the sheet-menu item and the notes above.

## Checks

- `test/compaction.test.js`: compact a sheet with an editor online and one
  offline who edits while away; both end up with every edit, the old sheet
  is frozen, the seeder holds the new one, invites block it.
- `test/removal.test.js` gains an offline editor's edits surviving a removal.
- `bench/load-time.js`: disk and join time at 10,000 and 100,000 edits,
  before and after.
- The emulator and a phone: compact on the desktop, follow on the phone.

## Open questions for Tim

1. Automatic at 50,000 updates plus a manual item (recommended), or manual
   only?
2. 90 days for keeping the frozen copy while someone has not followed?
