# Templates

**Status:** approved by Tim 2026-10-18, with built-in templates added. A user asked: "let's say i have an idea of how to create a
recipe structure. i build it and save it and from there i add it like a file
that is marked like 'use this as a template' private or in groups option and
when i press new its either from a template choice or a blank option".

**Goal:** any sheet, document or deck can be marked as a template, kept to
yourself or shared with other people, and New offers Blank or one of your
templates. A file made from a template is a new file of your own.

**Tier:** T2. One new value in each file's shared data (`meta.template`) and
a new IPC method. No change to keys, crypto, membership or ops.

## What a template is

- **A normal file with a mark on it.** No separate kind of storage. You
  build the recipe sheet like any other file, then choose **Use as a
  template** from its menu. **Stop using as a template** takes the mark off.
  The file stays in your list, with a Template badge.
- **Private or shared by who is in it.** A template only you are in is
  private. To share one, invite people to it the usual way, as viewers if
  they should not change it. PearOffice has no groups, so the people in a
  template file are its group. Your own linked devices already get every
  file you have, so a private template is on all of them, and it comes back
  with the recovery phrase like any file.
- **The mark is shared.** It lives in the file, so everyone in it sees the
  file as a template. The owner and editors can set or clear it; viewers
  cannot.
- **Editing a template changes the template.** Files already made from it do
  not change. They are copies.

## New

New shows the kinds as today (sheet, document, slides) plus a **From a
template** section listing the templates you have, by name, each with
its kind's icon and title. With more than six of your own, a search box and
All, Sheets, Documents and Slides buttons narrow the list, and the built-in
templates fold into a Built-in group that opens on a tap or while searching
(added 2026-10-18, Tim asked about long lists). With no templates, it shows one line: "Mark any
file as a template from its menu to start from it here." Picking a template
asks for nothing and opens the new file, titled after the template ("Recipe"
gives "Recipe"; you rename it as usual).

On phones the section is a list under the kind buttons in the same sheet.

## Making a file from a template

The worklet copies the template's current content into a brand-new file with
fresh keys and you as its only member and owner, the same way a removal or a
restore makes a fresh copy (`moves.js`, `foundCopy`). Then:

- **Kept:** all the content (cells, formats, formulas, charts, validation,
  colour rules, names, tabs; document text and pictures; slides, notes,
  shapes, pictures and theme). Pictures are copied into the new file's
  picture store under its own key, as a move does.
- **Left out:** the template mark, comments, other people's profiles and
  the template's member list. The new file is yours alone until you share
  it.
- **History:** the new file starts with one update, so none of the
  template's edit history (or deleted text) goes with it.
- **Not linked back:** the new file does not record which template it came
  from.

A viewer of a shared template can make files from it: the copy happens on
their device from content they already have.

## Records and IPC

- `meta.template`: `true` or absent, in the file's Yjs `meta` map (sheets,
  documents and decks all have one). Set with `file:setTemplate { sheetId,
  template }`, which refuses viewers.
- `file:list` entries gain `template: true`.
- `file:fromTemplate { sheetId }` makes the copy and returns `{ sheetId }` of
  the new file.

## Compat

Older builds ignore `meta.template`: the file shows as a normal file, with
no badge and no place in New. Files made from a template are normal files,
so older builds open them. An older build editing a template keeps the mark.

## Verify

- Unit tests: setting and clearing the mark, viewers refused, a copy has
  fresh keys, one member (the maker, as owner), the content, no comments,
  no mark, and pictures under the new file's key, for each kind.
- Two-engine test: a template shared with a viewer; the viewer makes a file
  from it; the owner never sees that file.
- Smoke (`app` or a new `templates` part): mark a file, New shows it, make
  one, the copy opens with the content and no badge, unmark.
- Android emulator: the New sheet with templates.
- `npm run verify` green.

## Rollback

Revert the PR. The mark stays in files as an ignored value, which older
builds already ignore. Files made from templates are ordinary files and stay.

## Built-in templates

A starter set ships with the app and shows in New under **From a
template** after your own: **Budget** (sheet), **Recipe** (document),
**Meeting notes** (document) and **Simple deck** (slides). They are data
in the UI, not files on the network: picking one makes a new file through
the same paths as importing a file (`sheet:import`, `doc:import`,
`slides:import`), so they need nothing new in the worklet and work offline.
They cannot be edited or unmarked; to change one, make a file from it and
mark that file as a template.

## Decided 2026-10-18

1. Templates show in the file list with a badge, and in New.
2. Comments are left out of a copy.
3. Built-in templates are part of this change (above).
