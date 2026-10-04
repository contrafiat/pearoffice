# Freeze panes and filters

**Status:** approved by Tim 2026-10-04: freeze panes shared, filters each
person's own. From
`notes/2026-10-04-calc-parity.md`.

**Goal:** keep header rows and label columns in view while scrolling, and
filter a table down to the rows you want, by value or by a condition.

**Tier:** T2 for freezing (a new shared setting per tab). Filters as
recommended below are kept on each device and change nothing shared (T1).

## 1. Freeze panes (shared)

Frozen rows and columns are part of how a sheet is laid out, so everyone in
the sheet sees the same ones, as in Excel and Google Sheets.

- Stored in a new root map `view:<tabId>`: `freezeRow` and `freezeCol`, the
  ids of the last frozen row and column. Inserting a row inside the frozen
  part grows it; deleting that row or column unfreezes it.
- Menu (More, and the cell menu): Freeze top row, Freeze first column,
  Freeze up to this cell, Unfreeze.
- The grid draws the frozen rows and columns in panes that stay put while
  the rest scrolls, with a heavier line at the edge. On phones the same
  applies; a frozen part taller than half the screen is drawn unfrozen on
  that device so the rest can still be reached.
- .xlsx: written as Excel's frozen pane (`<pane state="frozen">`, added after
  SheetJS writes the file, as for charts and styles) and read back on import.

## 2. Filters (each person's own)

In a live shared sheet, one person filtering would hide rows for everyone
in the middle of their work. So a filter belongs to the device that set it,
like Google Sheets' filter views: nothing is stored in the sheet and nobody
else is affected.

- Turn on: select a table (or a cell in one) and choose Filter. Each header
  cell gets a small button.
- A column's menu: sort A to Z or Z to A (an ordinary shared sort), a search
  box, a checklist of the column's values (blanks included), and a
  condition (equals, contains, starts with, greater than, less than,
  between, top 10). Filters on several columns combine.
- Rows that do not match are hidden on this device only: the row numbers
  skip, a line shows where rows are hidden, and the status bar says
  "Showing 12 of 40 rows".
- Editing still works on what is shown. Copy copies only the shown rows.
  Fill and paste over hidden rows skip them, as in Excel.
- The filter is remembered on this device for the tab and range until it is
  turned off. If rows are added to the table, they are filtered too.
- .xlsx: exports do not carry a filter (it is personal); an imported
  file's filter range becomes this device's filter with nothing hidden.

## Compat

Older builds ignore `view:<tabId>` and scroll everything. Filters affect
nobody else.

## Verify

- `npm run verify` green, plus unit tests: freeze follows inserted and
  deleted rows; two people freezing at once end up the same; the filter
  rules (values, blanks, each condition, several columns); copy of a
  filtered range takes only shown rows.
- Desktop smoke: freeze the top row and scroll, filter by a value and by a
  condition, clear the filter.
- Emulator: frozen header while scrolling; the filter menu as a bottom
  sheet.

## Rollback

Revert. `view:<tabId>` stays in documents unused; filters leave nothing
behind.

## Decided

1. Freeze panes are shared by everyone in the sheet.
2. Filters are each person's own.
