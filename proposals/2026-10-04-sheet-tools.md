# Hiding rows and columns, conditional formatting, validation, named ranges and comments

**Status:** approved by Tim 2026-10-04: hiding shared, comments from
editors and the owner, standard conditional rules now. From `notes/2026-10-04-calc-parity.md`
(rows 38, 40, 47, 48, 49).

**Goal:** the remaining everyday spreadsheet tools from the LibreOffice
comparison: hide and show rows and columns, colour cells by rule, limit
what can be typed (with dropdown lists), name a range and use the name in
formulas, and leave comments on cells.

**Tier:** T2. Each part adds a new shared map per tab (or per sheet for
names). Older builds ignore them; what that means for each is under
Compat.

## 1. Hiding rows and columns (shared)

Hidden rows and columns are part of the sheet's layout, as in Excel and
Google Sheets, so everyone sees the same ones (see question 1).

- Stored in a new root map `hidden:<tabId>`: row or column id -> `true`.
  One key per row or column, so two people hiding different rows both
  keep theirs, and a row's hidden state moves with it on insert and
  delete.
- Row and column header menus: Hide, and Show on a selection that spans
  hidden ones. A small mark between headers shows where something is
  hidden; tapping it shows them again.
- Hidden rows and columns take no space, and the arrow keys, copy, fill
  and the status bar skip them, as filtered rows do now. A filter and
  hidden rows combine.
- SUBTOTAL with 101 to 111 and AGGREGATE skip hidden rows, as in Excel.
  They do not skip filtered rows: a filter is one person's own, and every
  device must compute the same value. This differs from Excel, which
  skips both.
- Double-clicking a column edge fits the column to its contents. The
  width is measured on that device and then stored like a dragged width.
- .xlsx: `hidden="1"` on rows and columns, written and read.

## 2. Conditional formatting (shared)

A rule colours cells when their value matches. Rules belong to the sheet,
so everyone sees the same colours.

- Stored in a new root map `cf:<tabId>`: rule id -> `{ range (ids),
  kind, ..., style, order }`. Ranges are stored by row and column ids, as
  charts and merges are.
- Rule kinds, as in Excel's Highlight Cells and Top/Bottom menus: greater
  than, less than, between, equal to, text contains, a date in the last
  7 days (and similar), duplicates and unique values, top or bottom N or
  N%, above or below average, blank and not blank.
- Colour scales (2 or 3 colours) and data bars.
- Each rule sets text colour, fill, bold, italic or strikethrough. The
  first rule in order that matches a cell wins for each attribute, as in
  Excel.
- Rules are worked out on each device from the merged values. Values are
  already the same everywhere, so the colours are too. "Last 7 days" uses
  the device's date, like TODAY().
- A panel lists the tab's rules: add, edit, reorder and delete.
- Formula rules ("use a formula to decide") and icon sets are left for
  later (question 3).
- .xlsx: `<conditionalFormatting>` with `cfRule` and `dxf` styles,
  written and read for the kinds above.

## 3. Data validation (shared)

A validation rule limits what can be typed in a range.

- Stored in a new root map `valid:<tabId>`: rule id -> `{ range (ids),
  kind, ..., onBad, message }`.
- Kinds: a list (typed items, or the values in a range), whole number,
  decimal, date, time and text length, each with between, equal, greater
  or less than.
- A list cell shows a dropdown arrow when selected. On phones the list
  opens as a bottom sheet.
- onBad: "stop" refuses the entry with the rule's message; "warn" asks
  first and lets it through.
- Validation runs where a value is typed. A paste, an edit from an older
  build or two edits at once can still leave a value that breaks a rule.
  Such cells get a small red mark on every device, which is worked out
  from the merged values, so it is the same everywhere.
- .xlsx: `<dataValidations>`, written and read.

## 4. Named ranges (shared, changes formulas)

- Stored in a new root map `names` for the whole sheet: name ->
  `{ tabId, range (ids) }`. Names follow Excel's rules (a letter or
  underscore first, no spaces, not a cell reference like `AB12`) and
  ignore case.
- Formulas use them anywhere a range works: `=SUM(Sales)`. The formula
  text keeps the name; the engine looks it up when it computes.
- Deleting a name gives `#NAME?` in formulas that use it. Deleting all of
  its rows or columns gives `#REF!`. Two people creating the same name at
  once: the later write wins on every device, as with any shared value.
- A panel lists names: add, rename, change range, delete. The name box
  next to the formula bar accepts a name to jump to it.
- Formula suggestions offer names as well as functions.
- .xlsx: `<definedNames>`, written and read.

## 5. Comments (shared)

- Stored in a new root map `comments:<tabId>`: comment id -> `{ cell
  (ids), parent, author key, text, at, resolved }`. A thread is a comment
  and its replies. Author is the member's key, shown with their profile
  name and avatar.
- A cell with comments shows a small corner mark. Hovering (desktop) or
  tapping the mark (phones) opens the thread: reply, edit or delete your
  own, resolve.
- Who can comment: editors and the owner (question 2).
- A count of open threads appears in the More menu; "Comments" lists
  them and jumps to each.
- .xlsx: written as plain notes (`comments1.xml` with the thread as text)
  so Excel and LibreOffice show them. Imported notes become comments by
  "Imported".

## Compat

Older builds:

- Hidden rows and columns show normally. Their SUBTOTAL 101-111 counts
  hidden rows, so it can differ from newer builds until they update.
- Conditional formatting, validation marks and comments do not show.
- Named ranges: formulas that use a name show `#NAME?` on older builds.
  This is the same as a newly added function.

None of these change stored values, so nothing has to be migrated.

## Build order

Each part is its own PR, smallest first: hiding (with auto-fit), comments,
validation, conditional formatting, named ranges.

## Verify

- `npm run verify` green, plus unit tests for each part: hidden rows
  follow inserts and deletes and SUBTOTAL 109 skips them; each
  conditional rule kind and the order rule; each validation kind and the
  mark for values that break a rule; names in formulas, renamed and
  deleted names, a name over deleted rows; comment threads, two people
  replying at once.
- .xlsx round trips for each, checked in LibreOffice.
- Desktop smoke: hide and show a row, add a highlight rule, a dropdown
  list, a name used in SUM, a comment and a reply.
- Emulator: the dropdown and comment thread as bottom sheets.

## Rollback

Revert. The new maps stay in documents unused; formulas that use names
show `#NAME?`.

## Decided

1. Hidden rows and columns are shared by everyone in the sheet.
2. Editors and the owner can comment; viewers read comments.
3. Conditional formatting: the standard rules, colour scales and data
   bars now; formula rules and icon sets later.
