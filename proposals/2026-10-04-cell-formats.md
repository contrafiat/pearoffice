# More cell formats, merged cells and row heights

**Status:** approved by Tim 2026-10-04: styles written into .xlsx in this
work, and a short font list. From
`notes/2026-10-04-calc-parity.md` (everyday gaps).

**Goal:** the formatting people expect from a spreadsheet: text alignment,
wrap, font size, underline, strikethrough, borders and merged cells, plus row
heights so wrapped and larger text fits.

**Tier:** T2. New keys in each tab's shared format map, a new shared map of
merged cells and one of row heights. Older builds ignore all three and show
the cells unformatted and unmerged; the values are unaffected.

## 1. New cell formats

Formats are stored one attribute per key (`fmt`: `"<rowId>:<colId>:<attr>"`),
so two people changing different attributes of one cell both keep theirs.
New attributes:

| Attr | Values | Shown as |
| --- | --- | --- |
| `align` | `left`, `center`, `right` | horizontal alignment (default: numbers right, text left) |
| `valign` | `top`, `middle`, `bottom` | vertical alignment (default bottom, as Excel) |
| `wrap` | `true` | text wraps inside the cell |
| `size` | 8 to 36 (points) | font size |
| `u` | `true` | underline |
| `s` | `true` | strikethrough |
| `font` | `serif`, `mono` | font (the default is the sans-serif grid font) |
| `bt`, `br`, `bb`, `bl` | `thin`, `medium`, `thick`, `dashed`, `double`, each optionally `:#rrggbb` | a border on that side |

Borders live on the cell whose side it is, as in Excel. Where neighbours
disagree (B2's right and C2's left), the heavier one shows.

Toolbar: alignment (left, centre, right; top, middle, bottom), wrap, font
size, underline, strikethrough, and a borders menu (all, outside, inside,
top, bottom, left, right, none; line style and colour). Phones get the same
in the scrolling tools row. Ctrl+U for underline, Ctrl+5 for
strikethrough, as in Excel.

## 2. Row heights

Row heights are stored per row id in a new root map `heights:<tabId>`
(rows that were never resized have no entry), like column widths. Drag a row
header's lower edge to resize; double-click it to fit the contents.

A row that holds wrapped or larger text grows on each device to fit it,
unless someone set its height. That fitting is measured locally and never
stored, so it cannot clash between devices.

## 3. Merged cells

A merge is stored in a new root map `merges:<tabId>`: the top-left cell's ids
→ `{ toRow, toCol }` ids of the bottom-right cell, so a merge grows and
shrinks with inserted and deleted rows and columns.

- Merging keeps the top-left cell's contents and clears the others, after a
  warning when they are not empty, as Excel does.
- Two merges that overlap (two people merging at once): the one whose
  top-left cell comes first in reading order wins; the other is ignored
  until it is unmerged, the same on every device.
- A merge whose corner row or column was deleted disappears.
- Selecting any cell of a merge selects all of it; typing goes into the
  top-left cell. Unmerge splits it back.
- A spill that would fill part of a merge is blocked (`#SPILL!`), as in
  Excel. This changes what every device computes, so it is part of this T2.
- Sorting a range that cuts through a merge says so and does nothing, as in
  Excel.

## 4. Files

- **.xlsx merges** are written and read by SheetJS (`!merges`).
- **.xlsx styles:** SheetJS Community Edition writes no styles, so today an
  export loses bold, italic, colours and number formats' look. See question
  1.
- **CSV** is unchanged. **PDF and print** show alignment, wrap, sizes,
  underline, strikethrough, borders, merges and row heights.

## Compat

Older builds: unformatted, unmerged cells at the default row height; no
other effect. A merge made on a new build hides cells that older builds
still show and can edit; those edits stay in the cells and appear again if
the merge is undone.

## Verify

- `npm run verify` green, plus unit tests: two people formatting different
  attributes of one cell; borders on neighbouring cells; merges following
  inserted rows, overlapping merges resolved the same either way, a deleted
  corner dropping the merge; a spill blocked by a merge; row heights
  following their row.
- Desktop smoke: align, wrap a long text and see the row grow, font size,
  underline, borders, merge and unmerge, resize a row.
- Emulator and Simulator: the toolbar row with the new buttons, a merged
  cell, wrapped text.

## Rollback

Revert. The new keys and maps stay in documents unused.

## Decided

1. Cell styles are written into .xlsx exports in this work (built third,
   after formats and merges), the way charts are added after SheetJS writes
   the file.
2. A short font list: sans (default), serif, monospace.
