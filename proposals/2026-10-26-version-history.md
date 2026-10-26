# Version history for documents

**Status:** approved by Tim 2026-10-26: documents first, history starts again after a tidy-up or removal. Idea from Nightjar (github.com/NiyaNagi/Nightjar), passed
on by a tester (TODO.md, tester feedback 2026-10-26).

**Goal:** in a document, see its earlier versions (when and by whom), look
at any of them and bring one back.

**Tier:** T2. A new optional field on edits (`at`) and a new stored value
in each device's view. No change to keys, crypto or membership.

## What is already there

Every edit to a file stays in its log as a `y` op, with the device that
wrote it (`sheetWire.js`; the view keeps each under `yKey(node)` in apply
order). Replaying the log up to any point gives the document exactly as it
was then. So past versions need no extra storage: any member's device can
rebuild them. The seeder cannot (it has no key), and nothing changes for
it.

Two things are missing:

1. **Times.** Edits do not say when they were made. From now on each `y`
   op carries `at`, the writing device's clock in milliseconds, and the
   view keeps it beside the edit. A device's clock can be wrong; times are
   shown as written, and only used to group and label. Edits from before
   this change have no time.
2. **History across moves.** A tidy-up (after 50,000 edits) or removing
   someone moves the file to a fresh copy whose log starts with one edit
   holding the whole document. History then starts there.

## Versions

- A version is a run of edits: it ends when nobody edits for 5 minutes,
  or after an hour of continuous editing. Each shows its time (or
  "Earlier" with no time) and the people who edited in it (pictures and
  names). (Built without a count of changed words: it would mean
  rebuilding every version to list them.)
- After a move, the list ends with "Versions before [date] were cleared
  when this document was tidied up" (or "when someone was removed").

## Seeing and restoring

- File menu: **Version history**. A panel lists the versions, newest first.
  Picking one shows the document as it was, read-only, in place of the
  editor, with the text that version added and removed marked (green and
  struck through, against the version before it), so you can see what
  changed. It shows the text and the kinds of block (headings, list items,
  table rows); bold and the like are left out, and pictures show as
  [Picture]. Close returns to the live document.
- **Restore this version** (owners and editors): one edit that makes the
  document match that version. Others' later edits are replaced too; it is
  an ordinary change, so it shows up in history and can itself be undone
  by restoring the version before it. Asks first.
- **Copy** in the read-only view copies text out of an old version, for
  bringing back one paragraph without restoring everything.
- Viewers can see the history; they cannot restore.
- Phones: the same panel as a sheet; the old version fills the screen.

## How it runs

- The worklet rebuilds a version by replaying the log into a scratch Yjs
  document (`doc:version { sheetId, upto }`), and lists versions with
  `doc:versions { sheetId }` (times, writers, edit counts; computed once
  per open and kept up to date as edits arrive). A 10,000-edit document
  replays in well under a second (bench/RESULTS.md: the whole state is
  300 KB).
- The changed-text marks come from comparing the old and the current
  document as text, paragraph by paragraph.

## Sheets and decks (part 2, Tim 2026-10-26)

The same list and the same replay, through `file:versions` and
`file:version` for any file.

- **A sheet:** the picked version's tab as a grid of its cells, values
  worked out in the worklet (`sheet:versionCells`), cells it added or
  changed in green (a changed one says what it was), cells it emptied
  struck through; a tab picker; Copy copies the tab as tab-separated text.
  Formats are not shown.
- **A deck:** the picked version's slides, the ones it added or changed
  outlined and labelled, the ones it deleted after them, faded.
- **Restore** (`file:restore`, owners and editors): the worklet makes the
  file match the version as one edit: every part of the file except
  `meta` (title, schema version, template mark), so a rename since then is
  kept.

## Not in this
- Naming a version or pinning one so a tidy-up keeps it.
- Showing who wrote each word.

## Compat

- Older builds ignore `at` on an op and keep only the edit, as now. A
  version made only of their edits shows without a time.
- Nothing about an existing document changes; its history before this
  change shows as "Earlier" runs by person.

## Verify

- Unit: grouping by pause and by length; `upto` replays give the document
  as it was; a restore produces the old content and merges with an edit
  made at the same time; `at` kept, missing or nonsense handled.
- Smoke (`doc-history`): type, pause (a fake clock), type again; the panel
  lists two versions; the old one shows with the change marked; restore;
  copy from an old version; a viewer sees no Restore.
- `npm run verify`.

## Rollback

Revert. `at` stays in ops and views and is ignored.

## Open questions

1. **History across a tidy-up.** Proposed: accept that history starts
   again after a tidy-up or a removal, and say so in the list. The
   alternative is to carry a few past versions across a move (for example
   the last 20, as whole documents), which costs disk on every device and
   the seeder.
2. **Documents first?** Proposed: yes; sheets and decks after.
