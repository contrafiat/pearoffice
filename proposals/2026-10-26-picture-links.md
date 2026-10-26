# Links on pictures and shapes

**Status:** approved by Tim 2026-10-26. A tester reported "link embedded in picture does not
work" (TODO.md, tester feedback 2026-10-26). No editor can put a link on a
picture today.

**Goal:** a picture in a document, and a picture or shape on a slide, can
carry a link: a web or email address, another file or a folder. Opening it
works as for a link in text.

**Tier:** T2. A new saved field on document pictures and slide objects. No
change to keys, crypto, membership or the wire format.

## What is stored

- **Documents:** a new `href` attribute on the `image` node, next to `alt`.
- **Slides:** a new `link` key on a picture's or shape's map, set by a new
  `slidesModel.setLink(id, href)`. Charts and text boxes do not get one
  (text has its own links).
- The value is checked as text links are: `http(s):`, `mailto:` or
  `pearoffice://file|folder/<id>`, at most 2000 characters. Anything else is
  not stored.

## Adding and opening one

- **Documents:** the picture bubble gets a Link button that opens the same
  link bar as text, with the file and folder list. When a picture with a
  link is selected, the bubble shows where it goes, with Open and Copy link.
  Ctrl+click opens it; for a viewer a click does.
- **Slides:** Link in the selected object's tools (desktop), same bar. A
  linked object shows a small link mark in the editor. In the show, a click
  on a linked object opens the link (web and email in the browser) instead
  of moving to the next slide, as PowerPoint does. Files and folders are not
  opened during a show; that would end it.
- Phones: in a document, viewers open a linked picture with a tap and
  editors from the picture's bubble. On a slide, a tap on a linked picture
  opens it; a linked shape opens in the show. Phones do not add links on
  slides, since phones do not edit objects there.

## Files

| Format | Out | In |
| --- | --- | --- |
| .docx | picture inside a hyperlink | kept (mammoth gives `<a><img>`) |
| .odt | `draw:a` round the frame | kept |
| .pptx | `hyperlink` on the picture or shape (pptxgenjs) | `a:hlinkClick` on `cNvPr` |
| .odp | `draw:a` round the frame | kept |
| PDF | a link annotation over the picture, where the PDF printer keeps `<a>` | n/a |

`pearoffice://` links go out as they are, as text links already do; other
apps cannot open them.

## Compat

- Older versions ignore the new field: the picture or shape shows and
  works, with no link.
- An older version that changes a linked document picture (alignment,
  size, alt text) can drop its link, since the editor rewrites the node's
  attributes from its own schema. Slide objects keep it, because
  `slidesModel` writes only the keys it changes.
- No migration.

## Verify

- `test/`: `setLink` accepts and refuses the right values; the document
  schema keeps `href` through a Yjs round trip.
- Smoke: a doc picture linked to a web page and to a folder, opened from
  the bubble and by Ctrl+click, kept after reopening and through .docx and
  .odt; a slide picture and shape linked, opened in the show, kept
  through .pptx and .odp.
- `npm run verify`.

## Rollback

Revert the UI. Stored links stay in files and are ignored, as by an older
version.

## Decided

- A linked picture in a document shows a small link mark in a corner on
  hover and when selected, never in print or export (Tim, 2026-10-26).
