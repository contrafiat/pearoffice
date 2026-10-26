# @ chips in documents

**Status:** approved by Tim 2026-10-26. A tester: "the coloured chips work in sheet, I didn't
understand how to do it in doc" (TODO.md, tester feedback 2026-10-26).
Follows proposals/2026-10-23-multi-select-and-smart-chips.md, part 2.

**Goal:** typing @ in a document offers the same people, files, folders
and dates as in a sheet, and puts a pill in the text.

**Tier:** T2. A new inline node in the document schema and a schema
version bump. No change to keys, crypto, membership or the wire format.

## Typing it

- @ at the start of a line or after a space opens the sheet's menu
  (`AtMenu`, `atItems`) under the caret. Typing narrows it; Enter, Tab or
  a click picks; Esc closes it and leaves the typed text.
- Dropdown chips (a cell's list of choices) stay in sheets. Documents have
  no cells to hold a list.

## What is stored

An inline atom node `chip`, attributes:

- `kind`: `person`, `file`, `folder` or `date`.
- `id`: the person's identity key (64 hex), or the file or folder id.
- `date`: `YYYY-MM-DD` for a date chip.
- `text`: the name or date as shown when inserted, for exports and for a
  person who has left.

A person pill shows the current name from the member list, so a rename
shows. A file or folder pill shows the current name and opens it on click
(Ctrl+click while editing), through `src/ui/pearLinks.js`, and says so
when you do not have it. A date pill shows the date in the device's
format; editors get a calendar button on it to change the date.

## Version

Documents go to schema version 3 when the first chip goes in, as pictures
moved them to 2. An older build opens a version 3 document read-only with
"made with a newer version of PearOffice", as it does now. Documents
without chips stay at their version.

## Files

- .docx, .odt, .md, .txt and PDF: the text. File and folder chips go out
  as links to `pearoffice://file/<id>` or `pearoffice://folder/<id>`, as
  text links do. Import makes no chips.
- Copy and paste inside PearOffice keeps chips; to other apps they paste
  as text (and links for files).

## Verify

- Unit: the node's attribute checks (kind, a 64-hex person, a date),
  .docx/.odt/.md export text and links, version 3 on first chip.
- Smoke (`doc-links` or a new `doc-chips` part): @ then a person whose pill
  follows a rename, a file opened from its pill, Tomorrow changed with the
  calendar button, Esc leaves plain text, reopening keeps them.
- `npm run verify`.

## Rollback

Revert. Documents that already reached version 3 stay read-only in the
reverted build until it learns version 3 again, so a rollback after
release would ship a build that still reads chips (shown as text) and
only stops offering the menu.

## Decided

- Documents only for now; slide text boxes can follow if asked (Tim,
  2026-10-26).
