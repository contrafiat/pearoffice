# Coloured dropdown chips

**Status:** approved by Tim 2026-10-22. Asked for by the same user as
proposals/2026-10-22-links-to-files.md: "List validation already shows a
dropdown, but the choices are plain text. Google shows each choice as a
coloured pill and sets the list up from the cell" (TODO.md).

**Goal:** a cell with a list rule can show its value as a coloured pill,
one colour per choice, as Google Sheets does. Setting a dropdown up starts
from the cell, with the column's existing values offered as the choices.

**Tier:** T2. Two new optional fields on a validation rule. No change to
keys, crypto, membership or the wire format of ops.

## What is stored

A list rule (`valid:<tabId>`, proposals/2026-10-04-sheet-tools.md) gets:

- `look`: `'chip'` (a coloured pill with a small arrow), `'arrow'` (plain
  text with the arrow, as today) or `'plain'` (no arrow). This replaces
  `dropdown` for new rules; a rule with only `dropdown` reads as `arrow`
  or `plain` as before.
- `colors`: item text -> one of ten palette names (`grey`, `red`,
  `orange`, `yellow`, `green`, `teal`, `blue`, `purple`, `pink`,
  `brown`). At most one entry per item, 500 items, the same limit as
  the items. An item with no entry is grey.

Palette names rather than hex, so the light and dark themes each draw
their own shade with readable text. `normalize` refuses anything else.

A list from a range (`source`) can have colours too, keyed by the text of
each value in the range. A value added to the range later is grey until
someone picks a colour.

## Drawing

- A cell under a chip rule shows its value inside a pill of that item's
  colour, with the arrow at the end of the pill on the selected cell. An
  empty cell shows nothing until selected. A value that is not in the list
  shows as plain text with the existing invalid mark.
- The pill takes the cell's text size and font, ignores its text colour
  and fill (the cell fill still shows around the pill).
- On phones the same; a tap on the selected cell opens the choices as now.
- The choices menu shows each item as its pill.

## Setting one up

- **Dropdown** in the cell's right-click or long-press menu and in the
  Data tools opens the validation panel on the selection with List chosen
  and the look set to chips.
- The panel's items are pre-filled with the distinct values already in
  the selected cells (up to 500), as Google does, so turning an existing
  column into a dropdown is one step.
- Each item in the panel has a colour button. New items get the next
  palette colour in turn, so a fresh list is already coloured.
- The look is a three-way choice: Chips, Arrow, Plain.

## Files

- **.xlsx:** the list rule goes out as today. Each coloured item also goes
  out as a colour rule (fill and text colour when the cell equals the
  item), so Excel and LibreOffice show the colours. On import those come
  back as colour rules, not chips. Google does the same.
- **.ods:** the same, through the existing `odsRules.js`.
- **PDF and printing:** the pill is drawn.
- **.csv and .json:** the text only.

## Compat

Older builds read the rule's known fields and ignore `look` and `colors`.
They draw a chip cell as plain text with an arrow (or none) and keep the
check. Editing the rule on an older build writes it again without the new
fields, so the colours are lost for everyone; a new build shows it as
Arrow. Rare, and the list itself is kept. Format version stays 1.

## Verify

- Unit tests: `normalize` keeps good `look` and `colors` and refuses bad
  names, unknown items and too many entries; an old `dropdown` rule reads
  as before; the .xlsx and .ods exports carry one colour rule per coloured
  item and LibreOffice reads them.
- Smoke, in `sheet-files`: Dropdown from the cell menu on a filled column,
  the items pre-filled and coloured, the pills drawn, picking a choice,
  changing a colour, an invalid value shown plain, export.
- Android emulator: pills, the choices menu and the long-press Dropdown.
- `npm run verify` green.

## Rollback

Revert the PR. Saved rules keep `look` and `colors` as ignored fields and
draw as Arrow.

## Open questions

1. **@ chips** for people, files and dates, as Google has. Not now. File
   links are now possible through the link bar
   (proposals/2026-10-22-links-to-files.md).
2. **More than one choice per cell** (Google's multi-select dropdown). Not
   asked for; leave for later.
