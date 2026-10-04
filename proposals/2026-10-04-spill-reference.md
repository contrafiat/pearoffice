# The A2# spill reference

**Status:** approved by Tim 2026-10-04. Follow-up to
proposals/2026-10-04-spilling-formulas.md.

**Goal:** `A2#` means "the whole block the formula in A2 spills", as in
Excel 365, so `=SUM(A2#)` or `=SORT(A2#)` follows a FILTER or UNIQUE as it
grows or shrinks.

**Tier:** T2. A formula containing `#` is stored as typed, and older builds
cannot read it, so they show an error in that cell. Nothing else changes.

## How it works

- **Storage:** none to change. A formula is already saved with cell ids
  instead of A1 names, and the `#` after a reference is kept as is:
  `=SUM(A2#)` is stored as `=SUM({row.col}#)` and follows its cell when rows
  or columns are inserted or deleted (checked on the current code).
- **Evaluation:** before a formula is parsed, each `ref#` outside text in
  quotes becomes an internal call `_SPILL(ref)`, with any tab name kept
  (`'Costs'!B2#` becomes `_SPILL('Costs'!B2)`). `_SPILL` gets the reference
  itself, as OFFSET does, evaluates that cell and returns:
  - the anchor's whole block when it spills;
  - its single value when its formula gives one value, as Excel does;
  - `#REF!` when the cell has no formula, or its spill is blocked.
- Reading the block goes through the normal cell lookup, so cycles,
  probes and reading order work as for any other range.
- The vendored parser's grammar is not touched. `_SPILL` cannot be typed
  usefully (the UI never suggests it), and a typed `_SPILL(...)` behaves the
  same as `#`.

## UI

- Formula suggestions do not list `_SPILL`.
- Typing `A2#` needs nothing new; the formula bar shows what was typed.

## xlsx

Excel stores `A2#` as `ANCHORARRAY(A2)` with an `_xlfn.` prefix. Export
writes `_xlfn.ANCHORARRAY(ref)`; import turns `ANCHORARRAY(ref)` back into
`ref#`.

## Compat

Older builds read `A2#` as a syntax error and show `#ERROR!` in that cell
until they update. Nothing stored differs.

## Verify

- `npm run verify` green, plus unit tests: `=SUM(A2#)` follows a FILTER as
  rows are added and removed; `#` on a cell without a formula and on a
  blocked spill gives `#REF!`; on a single-value formula gives that value;
  across tabs; after inserting rows above; inside text (`"A2#"`) it is
  left alone; xlsx round trip through `ANCHORARRAY`.
- Spill corpus cases checked against LibreOffice (it supports `A2#`).
- Desktop smoke: `=SUM(H1#)` next to `=SEQUENCE(3)`.

## Rollback

Revert. Cells using `#` show `#ERROR!` again; nothing stored changes.

## Changes after approval

- 2026-10-04, build: the internal function is Excel's own `ANCHORARRAY`
  (what `A2#` means in Excel and how .xlsx stores it), not a hidden
  `_SPILL`. It returns a reference to the block, as OFFSET does, so
  functions that need a range (ROWS, INDEX, SUMIF) accept it. Typing
  `=ANCHORARRAY(A2)` works too, and it has a catalog entry.
