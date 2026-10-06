# Documents

**Status:** draft, for Tim's review.

**Goal:** PearOffice can make, share and co-edit rich-text documents, using
the same sharing, roles, seeders, moves and deleting as sheets.

**Tier:** T2. A new file kind (`doc`) in invite links and the file list, new
presence fields and a new document shape inside the Yjs doc. No change to
signing, membership or the join handshake.

## What a document is in v1

A page-width document like Google Docs, without page breaks while editing:

- Headings (three levels), paragraphs, bold, italic, underline,
  strikethrough, text colour and highlight
- Bulleted, numbered and checklist lists, nested
- Links, quotes, code blocks, horizontal lines
- Tables (insert, add and remove rows and columns, merge is later)
- Undo and redo (your own edits only, as in sheets), find and replace
- Word count
- Live co-editing with everyone's cursor and selection, in their colour
- Import .docx, .md and .txt. Export .docx, .md, .txt and PDF

Later, each with its own proposal if it touches the wire: images, comments
and suggestions, page breaks and headers, footnotes, a table of contents.

## How it is built

Most of the file machinery is already independent of the file type (mapped
on 2026-10-06):

| Part | Today | For documents |
| --- | --- | --- |
| Edits on the wire | `{ type: 'y', data }`, plain Yjs updates, checked only for size and role (`sheetWire.js`) | Unchanged |
| Storage, catch-up, snapshots | Plain Yjs (`sheets.js`) | Unchanged |
| Moves and tidying up | Copy the Yjs state (`moves.js`) | Unchanged, once the 1 MB fix below is in |
| Invites, roles, seeders, deleting, linking | Generic | Unchanged |
| `kind` | `meta.kind`, `f=` in links, `LINK_KINDS = ['sheet']` | Add `doc` |
| Presence | `{ open, tab, row, col, editing }` | Add a text cursor (below) |
| Undo scope | `meta`, `tabs`, `tab:<id>` | Per kind: `meta` and `body` for a doc |
| UI | `App.jsx` always renders `SheetView` | Pick the editor by kind |

### Inside the Yjs doc

- `meta`: `title`, `kind: 'doc'`, `version: 1` (as sheets)
- `body`: a `Y.XmlFragment` holding the document, in the editor's schema

The seeder still sees only encrypted blocks. Nothing on the wire says
whether a file is a sheet or a document except the invite link's `f=`,
which the seeder never receives.

### Editor

**TipTap 3** (MIT), a toolkit on top of ProseMirror, with its Yjs
extension (`y-prosemirror`, maintained by the Yjs author). It gives the
features above as ready extensions, works in a phone WebView and keeps its
document schema fixed in code, so every device reads `body` the same way.

Alternatives: plain ProseMirror (smaller, but we would write every feature
TipTap already has) and Lexical with `@lexical/yjs` (its Yjs binding is less
mature and it has had WebView input problems on Android).

The schema is versioned in `meta.version`. A device whose schema is older
than the document's opens it read-only and asks for an update, instead of
dropping content it does not understand.

### Code

- `src/doc/`: `docModel.js` (create, title, schema version),
  `docMethods.js` (`doc:*` IPC), `docx.js` (import with mammoth, BSD-2;
  export with `docx`, MIT), `markdown.js`
- `src/ui/doc/`: `DocView.jsx` (toolbar and editor), its panels
- The file-generic methods now in `sheetMethods.js` (`list`, `invite`,
  roles, `members`, `join`, `compact`, `setTitle`, undo and redo) move to
  `src/worklet/fileMethods.js` under `file:*`, keeping `sheet:*` names as
  aliases until the UI is moved over. `sheet:setTitle` stops needing a tab.
- The title, Share button, people, More menu and their panels move out of
  `SheetView` into a shared `FileBar`, used by both editors.

### Presence

The state gains an optional `cursor: { anchor, head }`, each a Yjs relative
position (base64, at most 256 bytes), sent when a document is open. Sheets
keep `tab`, `row`, `col`. Older builds drop fields they do not know
(`cleanState`), so they show a document user as "here" without a cursor.

### The 1 MB limit

Devices skip any single edit over 1 MB (`MAX_UPDATE_BYTES`). Moving or
tidying up a file sends its whole state as one edit (`moves.js`), so a
file over 1 MB loses its content on every device but the owner's. This
affects big sheets today. The fix goes first, in its own PR: split large
states and large imports into edits under the limit. Documents need it
more, since a long document or an imported .docx can pass 1 MB.

## Compat

- Older builds already refuse a `f=doc` invite with "This invite needs a
  newer version of PearOffice" (`parseInviteLink`).
- A person's other device on an older build can still learn about a
  document through device linking. It shows it in the list with the right
  icon and opens it as "Update PearOffice to open this document" instead of
  as an empty sheet. This needs the kind check in the build before
  documents, so it ships first, in the same PR as the 1 MB fix.
- Nothing is released yet, so the only old builds are on Tim's devices.

## Verify

- Two engines co-edit a document over the local testnet; concurrent typing
  in the same paragraph converges, in either order of arrival.
- A third member who was offline catches up from the seeder alone.
- Moving and tidying up a 5 MB document keeps all its text on every device.
- An old-schema device opens a newer document read-only.
- .docx, .md and .txt round trips keep headings, lists, links, tables and
  formatting. Checked against LibreOffice opening the exported .docx.
- Desktop smoke: create a document, type, format, undo, share, export.
- Android emulator and the iPhone Simulator; two-device co-editing with
  the emulator and the TCL.

## Rollback

Mark Document "coming soon" again in New. Documents already made stay on
devices and keep syncing, and their content can be exported first. The
1 MB fix and the generic-file refactor are useful without documents and
stay.

## Order

1. Split edits over 1 MB; refuse unknown kinds cleanly (fixes big sheets).
2. Move file-generic methods and the file bar out of the sheet code (no
   change in behavior).
3. The document editor, presence cursors, import and export.

## Open questions

1. TipTap, or one of the alternatives?
2. Images in v1 (stored inside the document, which makes it grow fast), or
   in a follow-up?
3. Page-width layout as above, or full-width like a notes app?
4. Our own names for the file types (TODO) - settle before step 3.
