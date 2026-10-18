# Links in sheets

**Status:** draft. Tim asked 2026-10-18: "Sheets needs hyperlink support
like docs and slides. Adding hyperlinks manually through menu bar or context
menu/properties should also be supported."

**Goal:** a cell can hold a link to a web page or an email address, added
from the toolbar or the cell's menu, opened with a click or tap, and kept
in .xlsx and .ods files.

**Tier:** T2. One new saved value per cell. No change to keys, crypto,
membership or the wire format of ops.

## What a link is

- A link belongs to a cell. The cell still shows its own text or number;
  the link is where clicking it goes. This is how Excel and LibreOffice
  store links, so files open in them unchanged.
- Allowed addresses: `https:`, `http:` and `mailto:`, at most 2048
  characters. An address typed without a scheme gets `https://`, as in
  documents. Anything else is refused by the model, so no device stores or
  opens a `javascript:` or `file:` link.
- A cell whose whole text is a web address is drawn as a link without
  storing anything, as Google Sheets does. Nothing is saved for these.

## Where it shows

- **Drawn:** link colour and underlined, unless the cell has its own text
  colour or underline.
- **Opening:** selecting a linked cell shows a small card under it with the
  address and Open, Edit and Remove (Edit and Remove for editors only).
  Ctrl+click (Cmd+click on a Mac) opens it directly on desktop. A plain
  click only selects, so clicking a cell to edit it never jumps to a
  browser. On phones the card is the only way, since a tap selects.
- **Adding:** a Link button on the toolbar (Ctrl+K), and Insert link / Edit
  link / Remove link in the cell's right-click or long-press menu. Both
  open the same bar as documents: one address box, Apply and Remove. It
  applies to every cell in the selection. On an empty cell, the address is
  also put in as the cell's text.
- **Viewers** can open links but not add, edit or remove them.

## Record

A format attribute, `link`, stored like the others: `fmt` key
`<rowId>:<colId>:link`, value the address string. Being its own key means
one person changing a link and another making the cell bold do not
overwrite each other. Because it is a format attribute it already moves with
copy and paste, fill, sort, insert and delete of rows and columns, and tidy
up. Clearing a cell's contents also removes its link.

## Files

- **.xlsx:** import reads SheetJS's `cell.l.Target`; export writes it back.
  Links to a place inside the workbook (`#Sheet2!A1`) are dropped on import
  for now and listed in the import notice.
- **.ods:** a link is a `text:a` around the cell's text. Read and written in
  our own ODS code if SheetJS gets them wrong, as it does formulas.
- **.csv and .json:** only the text, as today.
- **PDF and printing:** drawn as links, and clickable in the PDF.

## Compat

Older builds ignore the new key: they show the cell's text without a link
and cannot open it. Their edits to the text keep the link. Two edges, both
harmless:

- Sorting or filling on an older build moves the text but not the link, so
  the link can end up on another row. Fixed by editing it on a new build.
- Clearing a cell on an older build leaves its link; a new build draws
  nothing for an empty cell, and the link shows again if text is typed in.

The sheet's format version stays 1. Nothing an older build does loses data
a newer build needs, so there is no reason to open sheets read-only for
them.

## Verify

- Unit tests: the model refuses bad schemes and long addresses; link moves
  with sort, fill, paste and row deletion; clear removes it.
- .xlsx and .ods round trips in `test/`, with LibreOffice reading our
  export (`scripts/check-ods-view.py` style check for the link target).
- Smoke (`sheets` or `sheet-files` part): add a link from the toolbar and
  from the cell menu, the card shows, Remove, reopen, export and import.
- Android emulator: long-press menu, the card and opening in the browser.
- `npm run verify` green.

## Rollback

Revert the PR. Saved links stay in the files as an ignored key, the same as
an older build sees them. A later build can pick them up again.

## Open questions

1. **HYPERLINK() formula.** Excel files use `=HYPERLINK(url, label)`.
   Supporting it means the formula engine passes a link to the grid along
   with the value. Proposed: a follow-up, not this change.
2. **Links to a place in the file** (another tab or cell). Useful for
   index tabs. Needs tab and cell ids so renames and inserts keep them
   pointing at the right place. Proposed: a follow-up.
