# Coloured dropdowns in documents

**Status:** approved by Tim 2026-10-29, with Yes and No as the starting
choices and Enter carrying the dropdown. A tester (TODO.md, tester feedback
2026-10-29): "a checkbox system with different labels that you can create
on your own and with different colours. like the shopping list example in
a document. Beans -> click on the dropdown menu, yes, no, is not in store
etc. so afterwards you can just look over and see what is checked green
and not." They looked for the 1.1.3 dropdowns in a document; those are in
sheets only (proposals/2026-10-22-dropdown-chips.md).

**Goal:** a document can hold dropdown pills in its text. Each pill uses
a list of choices made in that document, each choice with its own name
and colour, and a click on the pill picks one.

**Tier:** T2. A new inline node, a new map in the document and a schema
version bump. No change to keys, crypto, membership or the wire format.

## What is stored

- A root map `lists` in the document's Yjs doc: list id -> a map with
  `name` and `items`, an array of `{ id, text, color }`. Colours are the
  sheet palette names (`grey`, `red`, `orange`, `yellow`, `green`,
  `teal`, `blue`, `purple`, `pink`, `brown`, `CHIP_COLORS` in
  `src/sheet/validation.js`), so both themes draw their own shade. At
  most 50 lists, 100 items each, 100 characters a name.
- An inline atom node `dropdown`, attributes:
  - `list`: the list id.
  - `item`: the chosen item's id, or empty for no choice yet.
  - `text`: the chosen item's text when it was picked, for exports and
    for an item that has since been deleted.

The pill shows the item's current text and colour from `lists`, so
renaming "Yes" to "Got it" or recolouring it changes every pill. An item
that was deleted shows its old `text` in grey. A pill with no choice
shows a grey "Choose".

## Using it

- **Insert dropdown** in the document toolbar (desktop and phones) and
  in the @ menu ("Dropdown"). It offers the document's lists and New
  list. A new list starts with Yes (green) and No (red), ready to edit.
- A click or tap on a pill opens its choices as pills, the current one
  ticked, then Edit choices. Viewers see the pills but cannot change them.
- Edit choices: rename, recolour, add, delete and reorder items, rename
  or delete the list. Deleting a list leaves its pills as grey text.
- In a bullet, numbered or tick list, Enter at the end of an item that
  ends in a dropdown starts the next item with an empty dropdown of the
  same list, so a shopping list is: type Beans, Enter, type Milk, Enter,
  then pick a choice on each one.

## Version

Documents go to schema version 4 when the first dropdown goes in, as
chips moved them to 3. An older build opens a version 4 document
read-only with "made with a newer version of PearOffice". Documents
without dropdowns stay at their version.

## Files

- .docx and .odt: the chosen text with the item's colour as the run's
  shading, so Word and LibreOffice show the colour. A pill with no choice
  goes out as nothing.
- .md, .txt and .html: the chosen text.
- PDF and printing: the pill is drawn.
- Import makes no dropdowns.
- Copy and paste inside the same document keeps dropdowns. Pasted into
  another document they become text, since the list belongs to the
  document it came from.
- Templates (proposals/2026-10-18-templates.md): `lists` is copied with
  the content, so a shopping list template keeps its choices.
- Version history shows a changed choice as a change to that text.

## Verify

- Unit: `lists` limits and colour checks, a renamed and a deleted item,
  version 4 on the first dropdown, .docx/.odt/.md export text and
  shading, a template copy keeping `lists`.
- Smoke, a new `doc-dropdowns` part: insert from the toolbar with a new
  list, pick Yes, add "Not in store" in orange, rename an item and see
  every pill follow, Enter in a tick list carrying the dropdown, a viewer
  unable to change it, reopening.
- Android emulator: inserting and picking by tap.
- `npm run verify`.

## Rollback

Revert the PR. Version 4 documents then open read-only on that build, as
an older build would; nothing else changes.

## Decided

1. A new list starts with Yes (green) and No (red).
2. Enter in a list carries the dropdown to the next item.
3. Sheets keep their own dropdowns per range. Sharing lists between a
   sheet and a document is not planned.
