# Pictures in documents

**Status:** draft, 2026-10-06. Open questions answered by Tim the same day.

**Goal:** people can add pictures to a document (insert, paste, import) and
everyone in it sees them, including a member who catches up from the seeder
alone.

**Tier:** T3. Recommended design B adds a new replicated core per writer per
file, encrypted with the file's key and registered with the seeder. Design A
alone would be T2 (a new node in the document schema and a version bump).

## Today

Pictures are left out with a notice on import (`docFiles.js`, `UNSUPPORTED`)
and on paste. The documents proposal put them in a follow-up "once the 1 MB
fix is proven". That fix is in: edits over 512K base64 characters go as
parts, at most 64 per edit, about 24 MB (`yOps.js`, `sheetWire.js`).

Profile pictures went inside the sheet's Autobase because the core's
`blobs` store is one device-wide Hyperblobs core that is neither encrypted
with the sheet key nor held by the seeder
(proposals/2026-10-04-profiles-with-avatars.md). They are capped at 16 KB.
Document pictures are 20 to 60 times that, so the choice needs redoing.

## Two designs

**A. Bytes inside the Yjs document.** An image node whose attributes carry
the picture as base64.

**B. Bytes in a picture core per writer per file.** Each writer device gets
a Hyperblobs core for that file, encrypted with the file's encryption key
and registered with the file's seeders. The image node carries only a
reference and a hash.

Both scale the picture in the UI first: at most 1600 px on the long side,
JPEG at quality 0.8 (WKWebView cannot encode WebP), PNG kept only when the
source is PNG and the PNG is the smaller. A typical photo comes out at 200
to 400 KB, a screenshot at 50 to 300 KB (guessed, not measured).

Cost of one 300 KB picture:

| | A | B |
| --- | --- | --- |
| Inside the edit | 400 KB string in Yjs, sent as ~533K base64 chars, so 2 parts | 300 KB in the picture core, ~150 bytes in Yjs |
| Disk per device | ~1.07 MB: the op in the writer core plus a copy in the view (`yKey`) | ~0.3 MB |
| Seeder | ~1.07 MB (writer and view cores) | ~0.3 MB |
| A picture someone deletes | Stays in the log, on every device and the seeder, until a tidy-up (automatic only at 50,000 updates) | Not fetched by new members; old blocks go at the next tidy-up |
| New member catching up | Downloads every picture ever added | Downloads only pictures still in the document |
| Opening on a phone | Every picture is held as text in the worklet's Y.Doc and again in the WebView's, and crosses the bridge on open: ~0.8 MB of strings per picture, all the time | Only references; bytes load when a picture is near the screen |
| Work | UI and a version bump | A, plus the picture core, seeder registration and copying on moves |

20 photos: A costs about 21 MB per device and on the seeder, and about
16 MB of strings in memory while open. B costs about 6 MB on disk and only
what is on screen in memory. Decoded bitmaps (1600 x 1200 x 4 bytes, ~7.7 MB
each) cost the same in both and the WebView frees them off screen.

## Recommendation: B

- Size: about 3.5 times smaller everywhere, and deleted pictures do not
  follow new members around.
- Phones: a document with many pictures opens as fast as one without.
- It keeps the promises the avatars proposal said Hyperblobs broke: the
  core is encrypted with the file key and the seeder holds it, blind.
- A is the fallback if B's core work turns out bigger than expected. Its
  limit would be 500 KB per picture.

## Scope (B)

### The picture core

- One Hyperblobs core per writer device per file:
  `store.get({ name: 'pictures/' + fileId })` with hypercore block
  encryption keyed from the file's encryption key, as Autobase does for its
  cores. The exact hypercore option is not checked yet.
- New file `src/worklet/pictures.js`: `put(fileId, bytes)` returns
  `{ core, id, hash, size }`; `get(fileId, ref)` checks the size from the id
  before downloading (refuses over 2 MB) and the blake2b hash after.
- Seeder: register each picture core with `peering.addCore(core, { referrer:
  bootstrap, keys })` (`seeding.js`). The seeder already accepts cores whose
  referrer is a registered file and tracks them per file, so a drop removes
  them too. No seeder change expected (checked by reading `seeder.js`, not
  by test).
- Every member device downloads all live pictures in the background, so
  documents work offline. Viewers only read; they get no picture core.

### The image node

A custom block node built on `@tiptap/extension-image`, with attributes:
`ref` (core key and Hyperblobs id, as one string), `hash`, `mime`, `w` and
`h` (pixels, so the page lays out before the bytes arrive), `width` (10 to
100 percent of the page), `align` (left, centre, right) and `alt`. Captions
and pictures inside a line of text come later.

The UI resolves `ref` through a new `doc:picture` IPC call and shows a grey
box with "Picture loading" until the bytes arrive, or "This picture is not
available yet" after a timeout.

### Version

`meta.version` goes from 1 to 2 when the first picture is inserted, not
before, so documents without pictures still open on older builds. An older
build opens a version 2 document read-only with "Update PearOffice to edit
it" (already built, `DocView.jsx`).

### Adding pictures

- Insert button, drag and drop and pasting image files (screenshots).
- Import: .docx pictures through mammoth's `convertImage`; .md and .html
  pictures given as `data:` URLs. Pictures at web addresses are never
  fetched (that would tell the site who opened the file) and are left out
  with the existing notice.
- SVG is left out (it can carry scripts). GIFs keep their first frame.
- Over the limit after scaling: "This picture is too big to add, even after
  shrinking it. Try a smaller one." Limit: 1 MB per picture.

### Export

- .docx: `ImageRun` with the bytes, width and alignment.
- PDF and print: the printable page gets each picture as a `data:` URL.
- .txt: `[Picture: alt text]`.
- .md: see open question 2.

### Deleting and tidy-up

Removing a picture removes the node. The bytes stay in the writer's core
and on the seeder until the next move. A move (tidy-up or removing a
person) copies each picture still in the document into the owner's new
picture core for the new file (under the new key) and rewrites the
references before appending the new state. Old cores go with the old file
when its 90 days are up. A move waits until the owner's device has every
live picture; if one cannot be fetched, the owner is told which.

### Unchanged

The `y` op format, membership, invites, roles, the join handshake and the
seeder code. Sheets do not get pictures.

## Compat

- Older builds open documents with pictures read-only and ask for an
  update. Documents without pictures are unaffected.
- Older builds never open picture cores. Nothing is released yet.

## Verify

- Two engines: one adds a picture, the other gets the node and the bytes,
  hash checked. Both add pictures while offline and both see all of them
  after reconnecting.
- Seeder: a third member who joins while the writers are offline gets the
  document and every picture from the seeder alone. The seeder's storage
  holds no JPEG or PNG magic bytes and no picture hash.
- Tidy-up: a document with 5 pictures, 2 deleted, moves; the new file
  references 3 pictures in the new owner core and opens on every device.
- Removal: the removed person cannot read a picture added after the move.
- Refusals: a reference to a blob over 2 MB is not downloaded; bytes with
  a wrong hash are not shown.
- Version: a version 2 document opens read-only in a build that knows
  version 1 only.
- Import and export: a .docx with 3 pictures imports them and exports
  them; LibreOffice opens the export with the pictures. A .md with a
  `data:` picture imports it; one with an `https:` picture leaves it out.
- Desktop smoke: insert, resize, align, delete and undo.
- Android emulator and iPhone Simulator: add from the photo library and
  paste; two-device check with the emulator and the TCL.

## Rollback

Hide the insert button and go back to leaving pictures out on paste and
import. Version 2 documents stay version 2 and keep syncing; their text can
still be exported. Picture cores stay registered and are dropped with their
files. If B fails in testing before release, ship A instead (T2), with a
500 KB limit.

## Decided 2026-10-06

1. Design B: a picture core per writer per file, beside the document.
2. .md export writes pictures into the file as `data:` URLs.
3. Limit per picture after scaling: 1 MB.
4. Every member device fetches all pictures, for offline use.

## Open questions

None left from the draft. Before building, check the three guesses above
(encrypting the picture core with the file key, the seeder taking the new
cores unchanged, typical sizes after scaling) with a spike.
