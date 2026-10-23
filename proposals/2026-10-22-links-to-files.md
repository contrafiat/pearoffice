# Links from a sheet cell to another file or folder

**Status:** draft, 2026-10-22. A user keeps a task list in a sheet and
wants each row to link to its document or folder (TODO.md, requested
2026-10-22). Builds on proposals/2026-10-18-sheet-links.md.

**Goal:** a cell's link can go to another PearOffice file (sheet, document
or deck) or to one of your folders. Opening it opens that file or folder.
Someone who does not have the file is told so plainly.

**Tier:** T2. A new kind of value for the existing `link` format
attribute. No change to keys, crypto, membership or the wire format of ops.

## What the link holds

- A file: `pearoffice://file/<fileId>`, the 43-character id `file:list`
  already uses.
- A folder: `pearoffice://folder/<folderId>`, the 32-character hex id from
  `folders.js`.

These sit beside the `pearoffice://join`, `link` and `seeder` links the
app already uses, and the model checks them with an exact pattern, as it
does every other link. Nothing else about the file is stored: no name, no
key. Being in the link gives no access to the file. Only its id is
written into the sheet, which every member of the sheet can read.

## Opening one

- **A file you have:** the card under the cell shows its name and kind
  icon, looked up from your file list when drawn, so a rename shows
  straight away. Open (or Ctrl+click) opens it, as a tap on its card in
  the file list does.
- **A file that has moved** (someone was removed, or the owner tidied it
  up, so it has fresh keys and a new id): your device remembers the move
  (`moves:<oldId>` in localDb) and follows it, as many times as needed, to
  the file you have now. The link in the cell is not rewritten, since the
  sheet holding it may belong to other people.
- **A file you do not have:** the card says "You don't have this file.
  Ask someone who has it to share it with you." Open does nothing. This
  covers a file you were never in, one you removed from this device and
  one that was deleted.
- **A folder:** folders are yours alone, so a folder link only works on
  your own devices (all of them, since folders sync between them). Open
  goes to the start screen inside that folder. Anyone else sees "This
  folder belongs to someone else." A deleted folder says "This folder was
  deleted."

## Adding one

The link bar (toolbar Link, Ctrl+K, the cell menu) gets a second list
under the tabs: **Files**, your files and folders, with a search box once
there are more than a few. Picking one makes the link. On an empty cell
the file's or folder's name goes in as the cell's text, as an address
does today.

A sheet can link to itself; Open then does nothing new, which is fine.

## Files

- **.xlsx and .ods:** the link goes out as the `pearoffice://` address.
  Excel and LibreOffice show it and ask before handing it to the system,
  which opens PearOffice if it is installed. Importing it back keeps it.
- **PDF:** the text only, since a PDF reader cannot open it usefully.
- **Templates:** a file made from a template keeps the links as they are.

## Compat

Incoming edits are not checked against the link pattern, so an older
build keeps the value and syncs it like any other. It draws the cell as a
link and its card shows the raw `pearoffice://file/...` address. Open does
nothing there: the desktop shell only hands `https:`, `http:`, `mailto:`
and `lightning:` to the system. An older build cannot add or change one,
since its own model check refuses the value. The same two edges as before
apply (sort or fill on an older build can leave the link behind on its
old row). Format version stays 1.

## Verify

- Unit tests: the model accepts the two new forms and refuses near misses
  (wrong length, other characters, other `pearoffice://` paths); a link
  to a moved file resolves through one and two moves; a file not in the
  list and a deleted folder give the right state.
- .xlsx and .ods round trips keep the link.
- Smoke, in the `sheet-links` part: link a cell to a document and to a
  folder from the bar, the card shows the name, Open goes to each, the
  missing-file card.
- Android emulator: the Files list in the bar and Open from the card.
- `npm run verify` green.

## Rollback

Revert the PR. Saved file links stay as ignored keys, as an older build
sees them.

## Open questions

1. **Links from outside the app.** A `pearoffice://file/...` address
   pasted in a chat or email could open the file when clicked, since the
   app already handles `pearoffice://` links. Cheap to add once this
   exists. Leave for later unless wanted now.
2. **Documents and decks.** Their link boxes could get the same Files
   list. Not asked for; leave for later.
