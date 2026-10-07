# Slides follow-ups

**Status:** draft, 2026-10-06. Follows `proposals/2026-10-06-slides.md` (v1,
parts 1 to 4, PRs #123, #126, #127 and #128).

**Goal:** close the gaps .pptx import showed: see-through fills, custom
shapes, text that sits at the bottom or does not wrap, cropped pictures,
arrowheads, SmartArt and charts. Each one is also something people make in
PowerPoint or Google Slides by hand.

**Tier:** T2. New fields in the deck's elements (persisted, synced to every
member). No change to IPC shapes, the wire, membership, the seeder or
pictures.

## New fields

All optional. A missing field means today's behaviour, so decks made before
read the same.

| Field | On | Values | Today |
| --- | --- | --- | --- |
| `fillOpacity` | shape | 0 to 1 | 1 |
| `lineOpacity` | shape | 0 to 1 | 1 |
| `anchor` | text, shape | `top`, `middle`, `bottom` | top for text boxes, middle for titles and shapes |
| `wrap` | text, shape | `false` to keep each line on one line | true |
| `crop` | picture | `{ l, t, r, b }`, each 0 to 0.9, fractions of the picture | none |
| `head`, `tail` | shape `line` | `none`, `arrow`, `triangle`, `oval` | none |
| `path` | shape `custom` | SVG path data in a 1000 x 1000 box | (new shape) |

`shape: 'custom'` is a seventh shape. `path` is checked like any other
value: only the commands M, L, H, V, C, Q, A and Z with numbers, at most
20,000 characters; anything else draws as the frame's box. `slidesModel`
gets setters for each (`setOpacity`, `setAnchor`, `setWrap`, `setCrop`,
`setArrows`) and `style()` reads them made safe.

## Where each one shows

- **Editor:** opacity sliders in the fill and outline menus; top, middle
  and bottom buttons with the alignment buttons; "Wrap text" in the
  right-click menu; Crop on a selected picture (drag the edges, Enter to
  finish); arrowhead pickers for lines. Custom shapes are drawn and styled
  but not drawn from scratch (they come from import, duplicate or paste).
- **Import:** alpha on fills and lines, bodyPr anchor and wrap, srcRect
  crops, line head and tail ends, custGeom paths scaled into the 1000 box.
  SmartArt uses the drawing PowerPoint saves with it
  (`ppt/diagrams/drawingN.xml`), imported as shapes and text boxes.
- **Export (.pptx):** the same, written back: alpha, anchor, wrap, srcRect,
  line ends, custGeom from `path`.
- **PDF and the show:** drawn like the editor.

## Charts

Import drops charts today. Two ways to keep them:

1. **Recommended: a `chart` element drawn with the sheet's chart code**
   (`src/sheet/charts.js`, `src/ui/sheet/Chart.jsx`, ECharts as SVG). The
   element stores the chart's type, series names and values (copied once
   from the .pptx's cached values, at most 10 series of 1000 points) and
   its colours. Charts can then also be added and edited by hand later.
   Exported to .pptx as a picture of the chart at first; a native chart
   later.
2. A picture of the chart only: PowerPoint stores no picture of a chart,
   so we would have to draw it anyway. Option 1 does the same drawing and
   keeps the data.

A `chart` element is a new type: builds without it skip it (as `TYPES`
already does) and show nothing there.

## Compat

Older builds ignore fields they do not know, so they draw opaque fills,
top-anchored wrapping text, uncropped pictures, plain lines and custom
shapes as their box. They skip `chart` elements. Nothing has been released,
so this only matters between test builds. `meta.version` stays 1.

## Verify

- Model tests: each setter clamps bad values; concurrent changes to two
  different fields of one element both survive.
- Import tests: a pptxgenjs deck and a hand-built one with each feature,
  read back field by field; the LibreOffice templates lose fewer shapes
  (Candy and Forestbird counts before and after).
- `scripts/check-slides-export.js` grows a check per field (LibreOffice
  reads them back).
- Smoke: opacity, anchor, wrap, crop and arrowheads set in the editor and
  kept after reopening; a chart in an imported deck drawn in the editor and
  the show.
- Keynote on the Mac Mini opens an export with every feature.

## Rollback

Hide the new controls. Decks that use the fields keep them and older
drawing ignores them.

## Order

1. Opacity, anchor, wrap, crop and arrowheads: model, editor, import,
   export.
2. Custom shapes and SmartArt drawings on import.
3. Charts (if approved as above).

## Open questions

1. Charts: the `chart` element with the sheet's chart code (recommended),
   or leave charts out for now?
