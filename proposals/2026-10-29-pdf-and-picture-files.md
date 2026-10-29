# PDFs and pictures as files

**Status:** approved by Tim 2026-10-29: no replacing for now, 25 MB. A tester (TODO.md, tester feedback 2026-10-29):
"is it hard to add the possibility to put pdf and pictures in to the
folders as well?" Tim, 2026-10-29: PearOffice is not to become a cloud
drive; limit it to sensible file types.

**Goal:** a PDF or a picture can sit in your files and folders next to
sheets, documents and decks, open inside PearOffice, carry tags and be
shared, backed up and moved like any other file.

**Tier:** T2. Two new kinds of file and a new map in the file's Yjs doc,
reusing the encrypted picture storage (proposals/2026-10-06-document-images.md)
with its own limits. No change to keys, membership, the wire format or the
seeder.

## Limits

- **Kinds:** `pdf` (application/pdf) and `picture` (JPEG, PNG, WebP, GIF).
  HEIC is turned into JPEG when the device can read it (iPhones can, so
  photos from an iPhone work); elsewhere it is refused with a message.
- **Size:** 25 MB a file. Everyone in a file keeps a copy, and so does the
  seeder.
- **Not:** any other file type, syncing a folder on a computer, a picture
  or PDF editor, searching inside PDFs.

## What is stored

A file of these kinds is an ordinary PearOffice file (its own keys,
members, roles, invites, tags, folder) whose Yjs doc holds:

- `meta`: `title` (the file's name without its extension), `kind`
  (`pdf` or `picture`) and `version` 100. The high version is on purpose:
  an older build opens an unknown kind as a sheet, and with version 100
  (sheets are 1) it shows it read-only with "This sheet was made with a
  newer version of PearOffice. Update PearOffice to edit it." One empty
  tab is added so it shows that note instead of loading forever.
- `media`: `ref` and `hash` (as a document's picture, in this device's
  picture core for the file, encrypted under the file key), `mime`,
  `size`, `name` (the original file name, for Save a copy), `w` and `h`
  for a picture, `pages` for a PDF.

The bytes are never in the Yjs doc. In the picture code (`pictures.js`)
`refsIn` gains these kinds, so every member downloads the file for offline
use, seeding registers its core with the file's seeders, and a move to
fresh keys copies it under the new key (`rehome`). A reference in a `pdf`
or `picture` file may claim up to 25 MB; other files keep the 2 MB limit.

## Adding one

- **Import a file** (desktop and phones) also takes `.pdf`, `.jpg`,
  `.jpeg`, `.png`, `.webp`, `.gif` and `.heic`. Inside a folder, the new
  file goes in that folder, as other imports do.
- On phones, Import also offers Choose a photo (the system photo picker).
- **Location data:** a JPEG is redrawn once at full size (up to 6000
  pixels a side) before it is stored, which applies its rotation and
  drops its EXIF data, location included, as profile pictures do. Other
  pictures and PDFs are stored as they are.
- The bytes go from the UI to the worklet in 1 MB parts (`media:begin`,
  `media:part`, `media:end`), so a 25 MB file never crosses the bridge as
  one 33 MB string. Reading for the viewer works the same way.

## Viewing

- **Pictures:** fitted to the window, zoom with the wheel, pinch or
  double-tap, drag to pan. Phones show it edge to edge.
- **PDFs:** pdf.js (Apache 2.0) draws the pages one under the other,
  only those on screen, with zoom and "page 3 of 12". Links in the PDF
  open as other links do.
- The file bar is the same as for other files: title (editors rename it),
  people, Share, and a menu with Save a copy (the original bytes and
  name), Print (desktop), Tags..., Move to folder, Remove and Delete for
  everyone. Phones also get Open in another app (the system share sheet).
  No version history, comments, templates or presence beyond the faces.
- Viewers can view, save a copy and print; editors can also rename.

## Compat

- Older builds: the file shows in the list with a sheet's icon and opens
  as an empty read-only sheet with the update note. They do not download
  or seed the bytes, so a person whose only devices are old cannot open
  it until they update.
- An older build that moves such a file to fresh keys (removing someone,
  tidying up) does not copy the bytes, and the new copy has none. Only
  an owner on an old build can do that, and only to a file a newer device
  made. The release notes tell people to update all their devices.

## Verify

- Unit: kind and `media` checks, the 25 MB limit only for these kinds,
  parts in and out, HEIC refused where it cannot be read, a JPEG's EXIF
  gone after adding, `sheet:view` on a `pdf` file saying newer.
- Engines over the test DHT: an editor imports a PDF, a viewer who joins
  gets the same bytes offline, a seeder alone serves them, removing a
  member moves the file with its bytes.
- Smoke, a new `media-files` part: import a PDF and a PNG made in the
  test, open each, zoom, page count, Save a copy matches the bytes, a tag,
  a folder, reopening.
- Android emulator and the iPhone Simulator: import from files and
  photos, a 20 MB PDF's import and open times on the TCL.
- `npm run verify`.

## Rollback

Revert. Files already made open as the read-only empty sheet described
under Compat; their bytes stay in their picture cores.

## Decided

1. No replacing a file's contents for now; a newer version is a new import.
2. 25 MB a file.
