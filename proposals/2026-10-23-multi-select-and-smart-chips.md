# Multi-select dropdowns and @ chips in sheets

**Status:** approved by Tim 2026-10-23, file links from the link bar drawn as pills too. Follow-up to
proposals/2026-10-22-dropdown-chips.md (open questions 1 and 2), picked by
Tim from TODO.md. Google Sheets has both.

**Goal:** a dropdown cell can hold more than one choice, and typing @ in a
cell inserts a person, a file or a date as a chip.

**Tier:** T2. New optional fields on a validation rule and two new format
attributes. No change to keys, crypto, membership or the wire format of ops.

Two parts, built and merged one after the other.

## Part 1: more than one choice

### Stored

- A list rule gets `multi: true`. Set in the panel with a checkbox, "Allow
  more than one choice".
- The cell's value is the chosen items in list order, joined by ", ", as
  Google does: `Design, Testing`. It stays ordinary text, so formulas,
  sort, filter, find, copy and paste and .csv see that text.
- `allows()` splits on commas, trims, and accepts the cell when every part
  is an item. An item with a comma in it cannot be chosen in a multi list
  (the panel's items are already split on commas; a range item with a
  comma is left out of the menu).

### Drawn

- With chips on, each choice is its own pill, side by side, clipped at the
  cell's edge like long text.
- The choices menu has a tick box per item. Tapping one adds or removes it
  and the menu stays open; tapping outside or Done closes it. On phones the
  bottom sheet has Done.

### Files

- .xlsx and .ods: the rule goes out as a list rule with the error message
  turned into a warning (Excel's "information" style), since Excel cannot
  hold more than one choice and would otherwise refuse the cell. Imports
  read it back as a normal single-choice list.
- Chip colours go out as colour rules only for single-choice lists. A
  "contains" rule would colour `Done` for an item called `Do`, so multi
  lists go out uncoloured.

### Compat

An older build reads the rule as single-choice: a cell with two choices
gets the invalid mark, and picking from its menu replaces the value with
one choice. Nothing is lost on its own; the text stays until someone
changes it.

## Part 2: @ chips

Typing @ as the first character in a cell opens a menu under it with
three groups. Typing more narrows it. Enter or a tap picks; Esc hides
the menu and leaves a plain @. The menu hides when nothing matches.

- **People:** the people in this file, with their pictures. The cell gets
  the person's name as text and a new format attribute `person`: their
  identity key (the same key `file:members` lists). Drawn as a pill with
  the avatar. The name shown is the current one from the member list, so
  a rename shows up; the stored text is the name when inserted, for files
  and older builds. A person who left the file keeps the stored name and a
  grey pill.
- **Files:** your files and folders. The cell gets the name as text and
  a `link` to `pearoffice://file/<id>` or `pearoffice://folder/<id>`, the
  same as the link bar (proposals/2026-10-22-links-to-files.md). Every
  cell whose own link goes to a file or folder is then drawn as a pill
  with the file's kind icon, including links made with the link bar.
- **Dates:** Today, Tomorrow and "Pick a date". The cell gets the date as
  a number with the sheet's date format and a new format attribute
  `datechip: true`. Drawn as a pill; selecting the cell shows a calendar
  button that opens the system date picker. Formulas see a normal date.

### Files

- .xlsx and .ods: the text (people, files) or the date. File links go out
  as links, as now. `person` and `datechip` are PearOffice's own and are
  not written; an import has none.
- PDF and printing draw the pills.

### Compat

Older builds ignore `person` and `datechip`. They show the name or the
date as plain text and a file link as an underlined link.

## Verify

- Unit tests: `multi` in `normalize` and `allows` (two items, an unknown
  part, spaces, order); the `person` and `datechip` checks (a 64-hex key,
  `true` only); the .xlsx and .ods rule with the warning style; dumps
  leave out `person` and `datechip`.
- Smoke: a multi list picked twice and unpicked once in `sheet-files`; @
  then a person, a file and a date in a new `sheet-chips` part, with the
  calendar button and a rename showing on the person pill.
- Android emulator: the menus, Done and the date picker.
- `npm run verify` green.

## Rollback

Revert each PR. Saved `multi`, `person` and `datechip` stay as ignored
fields and the cells show their text.

## Open questions

1. Should file links made with the link bar also draw as pills, or only
   ones made with @? All, decided by Tim 2026-10-23.
2. Google's person chip can send an email; there is no email here. The
   pill only shows the name and picture.
