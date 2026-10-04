# Spilling formulas

**Status:** approved by Tim 2026-10-04: every array result spills, the
other array functions are included, and `A2#` is a follow-up.

**Goal:** a formula whose answer is a block of values fills the cells below
and to the right of it, as in Excel 365 and LibreOffice: `=SORT(A2:A20)`,
`=UNIQUE(B2:B50)`, `=FILTER(A2:C99, C2:C99>100)`, `=SEQUENCE(10)`.

**Tier:** T2. Nothing stored changes: a spilling formula is saved like any
other formula, and the spilled values are computed, never stored. But it
changes what every device computes, so all devices must apply the same
rules. The v1 wire protocol says "no spill"; this replaces that line.

## Scope

### Changes

- Any formula whose result is an array spills it, not only the new
  functions. Today an array result shows its first value.
- New functions: FILTER, SORT, SORTBY, UNIQUE, SEQUENCE, TEXTSPLIT, TAKE,
  DROP, VSTACK, HSTACK, TOCOL, TOROW, CHOOSEROWS, CHOOSECOLS, WRAPROWS,
  WRAPCOLS, EXPAND and RANDARRAY (device-local, like RAND).
- `#SPILL!` when a spill is blocked.
- Formulas can read spilled cells like any other cell.
- The grid outlines a spill and the formula bar shows its formula.
- xlsx export writes Excel's dynamic-array formulas; import reads them.
- Cells are evaluated in a fixed order (section 3).

### Unchanged

The Yjs document, the Autobase ops, the seeder and every stored value.

## 1. The rules

A formula cell is an **anchor** when its result is an array of more than
one value. Its **spill range** is the block that starts at the anchor and is
as big as the array.

The spill is **blocked**, and the anchor shows `#SPILL!`, when any of these
holds:

1. A cell in the range, other than the anchor, has something typed in it
   (any input, including a formula).
2. A cell in the range is already covered by another anchor's spill that is
   not blocked, where that anchor comes earlier in reading order (row, then
   column). The earlier anchor wins.
3. The range goes past the tab's last row or column. The grid then offers
   "Add rows" (or columns), which is an ordinary edit.
4. The range is larger than 100,000 cells.

A blocked anchor shows only `#SPILL!` and covers nothing.

An empty cell inside an unblocked spill range takes its value from the
anchor's array. Every formula that reads that cell gets that value.

These rules depend only on the merged cells, so every device reaches the
same spills whatever order the edits arrived in. When two people's edits
meet (Alice's FILTER grows into the rows where Bob is typing), Bob's typed
value blocks the spill on every device and Alice sees `#SPILL!` until one of
them moves something.

## 2. Evaluating it

Today a lookup of an empty cell returns empty at once. With spills, it first
asks whether an anchor covers the cell:

- Only formula cells above and to the left can cover it. The evaluator
  keeps each tab's formula cells sorted in reading order and checks those.
- Checking an anchor evaluates it (memoised, as now). An anchor that is
  being evaluated at that moment, so its value depends on this cell, is
  skipped. If its finished spill range then covers a cell it skipped, the
  anchor is circular and shows `#CIRCULAR!`.
- Once every anchor on a tab is evaluated, the spill ranges go into a
  per-tab index so later lookups are cheap.

## 3. A fixed evaluation order

Evaluation is on demand with cycle detection. For a cycle the result can
depend on which cell is evaluated first. `=IFERROR(B1, 5)` in A1 and `=A1` in
B1 gives B1 `#CIRCULAR!` if A1 is evaluated first, and 5 the other way
round. Today the starting order is the Yjs map's key order, which can differ
between devices.

The evaluator will start from cells in reading order: tab order, then row,
then column. Cycles then come out the same on every device. This also
fixes the case without spills.

## 4. The functions

- **FILTER(array, include, [if_empty])**: `#CALC!` when nothing matches and
  there is no `if_empty`.
- **SORT(array, [index], [order], [by_col])** and **SORTBY(array, by1,
  [order1], ...)**: a stable sort. Numbers come before text, then
  booleans, then errors. Text compares with the fixed comparison the engine
  already uses instead of `localeCompare`, so the order does not depend on
  the device's language.
- **UNIQUE(array, [by_col], [exactly_once])**: case-insensitive as in
  Excel, keeping the first spelling seen.
- **SEQUENCE(rows, [cols], [start], [step])**.
- **TEXTSPLIT(text, col_delimiter, [row_delimiter], [ignore_empty],
  [match_mode], [pad_with])**.

Each function gets catalog entries and test cases. Their expected values
come from LibreOffice 26.2, which has all six, with Excel's answer written
down by hand where the two differ, as for the other functions.

## 5. The grid and the formula bar

- Spilled cells show their values with the anchor's number format.
- Selecting the anchor or a spilled cell draws a thin outline around the
  whole spill range.
- In a spilled cell the formula bar shows the anchor's formula in grey and
  cannot be edited there. Typing in the cell is allowed: it stores what was
  typed, which blocks the spill (rule 1), as in Excel.
- `#SPILL!` cells explain why on hover or long-press, for example "Cells
  in the way: B4, B7" or "Needs 12 more rows", with an "Add rows" button
  for rule 3.

## 6. xlsx

- **Export:** the anchor is written as a dynamic-array formula over its
  spill range (SheetJS CE: `F` is the range and `D: true`, written as
  `cm="1"`). The spilled cells are written as plain values, so programs
  that do not compute formulas still show them.
- **Import:** for a cell marked as a dynamic-array formula, the anchor keeps
  its formula and the values in its range are dropped, since the formula
  makes them. Old array formulas entered with Ctrl+Shift+Enter (no `D`) are
  imported as a formula in the top-left cell, which then spills. Their
  other cells are dropped too.

## Compat

Old builds keep showing the first value of an array, and see spilled cells
as empty, so their totals over a spill range differ from new builds until
they update. Nothing is stored differently, so updating fixes it. PearSheet
is not released yet, so this only affects test devices.

## Verify

- `npm run verify` green, plus:
- Unit: each of the four blocking rules; two anchors whose spills overlap
  (the earlier one wins whatever order the edits arrive in); a formula
  that reads a spilled cell; a spill that would cover a cell it depends on
  (`#CIRCULAR!`).
- Unit: the reading-order fix gives the same answer for the `IFERROR` cycle
  whatever the Yjs key order.
- Corpus: the new functions against LibreOffice; the golden file still
  matches bit for bit under Node, Bare and four timezones.
- Merge test: two engines, one adds a FILTER while the other types into its
  range, and both show `#SPILL!`.
- xlsx: export a spill, check it in LibreOffice, re-import it.
- Desktop smoke: type `=SEQUENCE(3)`, see three cells and the outline.
- Emulator and Simulator: the outline and the `#SPILL!` explanation on a
  phone.

## Rollback

Revert to first-value-only. Nothing stored changes, so no data needs
migrating. Sheets that used the new functions show their first value
again.

## Decided

1. Every array result spills, as in Excel 365.
2. The other array functions come in the same change.
3. The `A2#` spill-reference operator is a follow-up.
