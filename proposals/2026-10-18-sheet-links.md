# Links in sheets

**Status:** approved by Tim 2026-10-18, with links inside the file added. Tim asked 2026-10-18: "Sheets needs hyperlink support
like docs and slides. Adding hyperlinks manually through menu bar or context
menu/properties should also be supported."

**Goal:** a cell can hold a link to a web page, an email address or
another tab or cell in the same file, added
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
- **Links inside the file** go to a tab, or to a cell on a tab. They are
  stored by id, `#<tabId>` or `#<tabId>!<rowId>:<colId>`, so renaming the
  tab or inserting rows and columns keeps them on the same cell. They are
  shown in A1 form (`'Costs'!B4`), worked out when drawn. If the cell's
  row or column is deleted the link goes to the tab; if the tab is deleted
  the card says so and Open does nothing. Opening one switches tab, selects
  the cell and scrolls to it.
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
  open the same bar as documents: one address box, Apply and Remove, plus
  a list of the file's tabs to pick from. Typing `Costs!B4` or `B4` (this
  tab) also makes a link inside the file. It
  applies to every cell in the selection. On an empty cell, the address is
  also put in as the cell's text.
- **Viewers** can open links but not add, edit or remove them.

## Record

A format attribute, `link`, stored like the others: `fmt` key
`<rowId>:<colId>:link`, value the address string. Being its own key means
one person changing a link and another making the cell bold do not
overwrite each other. Because it is a format attribute it already moves with
fill, sort, insert and delete of rows and columns, and tidy up. Copy and
paste carry text only, as for every other format. Clearing a cell's
contents also removes its link.

## Files

- **.xlsx:** import reads SheetJS's `cell.l.Target`; export writes it back.
  A link to a place in the workbook (`location`, e.g. `Sheet2!A1`) becomes
  a link inside the file; one to a workbook-wide name goes to the name's
  first cell, and one to a cell past the tab's size goes to the tab.
- **.ods:** a link is a `text:a` around the cell's text; inside the file
  it is `#Sheet2.A1`. SheetJS reads and writes both kinds correctly
  (checked against LibreOffice), so no ODS code of our own is needed.
- **.csv and .json:** only the text, as today.
- **PDF and printing:** web and email links are clickable in the PDF.

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

- Unit tests: the model refuses bad schemes, bad ids and long addresses;
  an in-file link keeps its cell through a tab rename and row inserts; link moves
  with sort, fill, paste and row deletion; clear removes it.
- .xlsx and .ods round trips in `test/`, with LibreOffice reading our
  export (`scripts/check-ods-view.py` style check for the link target).
- Smoke, a new `sheet-links` part: add a link from the toolbar and from
  the cell menu, the card, Open, Ctrl+click, Remove, a typed address, then
  export and import.
- Android emulator: long-press menu, the card and opening in the browser.
- `npm run verify` green.

## Rollback

Revert the PR. Saved links stay in the files as an ignored key, the same as
an older build sees them. A later build can pick them up again.

## Open questions

1. **HYPERLINK() formula.** Excel files use `=HYPERLINK(url, label)`.
   Done 2026-10-18 as a follow-up (T1: computed on each device, nothing
   stored). The cell shows the label and links to the address (web, email
   or `#Sheet2!B4`); a cell that refers to it gets only the text, as in
   Excel. The card opens it; the formula is where it is changed.
2. **Links to a range** (`Costs!B4:D9`, selecting the block) or to a
   named range. Done 2026-10-18 as a follow-up, before any release carried
   links: a block is `#<tabId>!<rowId>:<colId>:<rowId>:<colId>` (if the
   far corner is deleted it goes to the first cell), a named range
   `#=<name>`, rewritten when the name is renamed and gone when it is
   deleted. .xlsx keeps both (`location` `'Costs'!B4:D9` or `Totals`);
   .ods keeps both as `#'Costs'.B4:D9` and `#Totals`, which LibreOffice
   reads.
