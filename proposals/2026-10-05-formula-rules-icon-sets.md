# Colour rules: formula rules and icon sets

**Status:** approved by Tim 2026-10-05: all five icon sets, Excel's
threshold defaults only. The part of conditional formatting left
for later in `proposals/2026-10-04-sheet-tools.md` (decision 3).

**Goal:** colour cells by any formula ("use a formula to decide"), and show
small icons (arrows, traffic lights) by how a value compares with the rest.

**Tier:** T2. Two new rule kinds in the shared `cf:<tabId>` map.

## 1. Formula rules

- A rule `{ kind: 'formula', formula, style }`. The formula is written for the
  top-left cell of the range, as in Excel: `=B2>AVERAGE($B$2:$B$20)` on
  B2:B20 colours each cell above the column's average, the relative `B2`
  moving with each cell and `$B$2:$B$20` staying put.
- A cell matches when its formula gives TRUE or a number other than 0.
  Errors and text do not match.
- Stored like a formula reference (row and column ids), so it follows
  inserted and deleted rows and columns.
- Worked out on each device by the formula engine, from the merged values,
  so every device colours the same cells. The engine runs in the worklet, so
  these matches are sent with the sheet view (the other rules are worked out
  in the page).
- Up to 20,000 cells per formula rule; beyond that it is not applied, with a
  note in the rules panel.
- Formulas with TODAY(), NOW() or RAND() follow the device's clock or chance,
  as those functions do in cells.

## 2. Icon sets

- A rule `{ kind: 'icons', set, reverse, iconOnly }`. Sets (see question 1):
  three arrows (up, sideways, down), three traffic lights, three symbols
  (tick, exclamation, cross), four arrows, five ratings.
- As Excel by default: numbers are ranked by percent of the range between
  the smallest and largest (three icons: 67% and up, 33% and up, the rest;
  four or five icons split evenly). `reverse` flips them; `iconOnly` hides
  the number.
- The icon sits at the left of the cell, in the cell's height.
- An icon rule shares cells with fill and text rules; each applies its own
  part.

## Files

- **.xlsx:** formula rules as `<cfRule type="expression">` with the formula;
  icon sets as `<cfRule type="iconSet">` with Excel's set names and percent
  thresholds. Written and read, checked in LibreOffice.

## Compat

Older builds skip rule kinds they do not know: no colours or icons from
these rules, nothing else changes.

## Verify

- `npm run verify` green, plus unit tests: a formula rule with relative and
  fixed references, following an inserted row, errors not matching; each icon
  set's thresholds, reverse, two people adding rules at once; .xlsx round
  trips and a LibreOffice file.
- Desktop smoke: a formula rule and an icon set from the rules panel.
- Emulator: icons in cells on a phone.

## Rollback

Revert. The rules stay in documents unused.

## Decided

1. All five icon sets.
2. Excel's percent thresholds only for now, with reverse.
3. Approved as written.
