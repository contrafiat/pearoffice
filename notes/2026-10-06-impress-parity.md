# PearOffice Slides against Impress, PowerPoint and Google Slides: what is missing

2026-10-06. Impress's menu bar (10 menus, 390 entries, read from
`share/config/soffice.cfg/modules/simpress/menubar/menubar.xml` with labels
from `main.xcd`, `impress.xcd` and `draw.xcd`), its standard toolbar (46
items), drawing object toolbar (37) and text formatting toolbar (43),
compared with what Slides v1 plans in `proposals/2026-10-06-slides.md`
(a draft). PowerPoint (ribbon tabs Home, Insert, Draw, Design, Transitions,
Animations, Slide Show, Record, Review, View) and Google Slides (menus File,
Edit, View, Insert, Format, Slide, Arrange, Tools, Extensions, Help) were
written from memory, then checked on 2026-10-06 against Microsoft's and
Google's help pages and the Google Workspace Updates blog (not a live copy).
Ten cells changed. PowerPoint's lack of a commenter role is likely but no
page says so outright.

Each gap has a size (S, M, L) and **P** when it needs a proposal first: it
stores something in the shared file that every device must agree on. For
slides that is any new element type, element field, slide field or text
mark, since older devices must then open the file read-only
(`meta.version` bump). Several small additions are best batched into one
proposal and one bump.

## What Slides v1 will have

A slide list with add, duplicate, delete and reorder; layouts (title, title
and content, two columns, section header, title only, blank); text boxes
with rich text (the document editor's text subset); shapes (rectangle,
rounded rectangle, ellipse, triangle, arrow, line) with fill and outline
colour; pictures; move, resize and rotate with snapping to edges, centres
and other objects; bring forward and send back; a few themes; speaker
notes; presenting full screen with keyboard and click, black and white
screen, a presenter view on desktop; export PDF and .pptx; import .pptx
(text, shapes, pictures and positions); live co-editing with everyone's
slide, selection and text cursor shown; sharing, roles, devices, seeder.

## 1. Everyday gaps (most people hit these in their first hour)

| Gap | Impress | PowerPoint | Slides | Size | P |
| --- | --- | --- | --- | --- | --- |
| Slide transitions (fade, push, wipe) | Slide > Slide Transition | Transitions | Slide > Transition | M | P |
| Animations on objects (appear, fade in on click, in order) | View > Animation | Animations | Insert > Animation | L | P |
| Tables on a slide | Insert > Table | Insert > Table | Insert > Table | M | P |
| Group and ungroup objects | Format > Group Shapes | Arrange > Group | Arrange > Group | M | P |
| Align and distribute several objects (buttons; v1 has only snapping) | Format > Align Objects, Distribution | Arrange > Align | Arrange > Align | S | |
| Background colour or picture for one slide (v1 takes it from the theme) | Slide > Set Background Image | Format Background | Slide > Change background | S | P |
| Hide a slide so the show skips it | Slide > Hide Slide | Hide Slide | Slide > Skip slide | S | P |
| Slide numbers, date and footer text | Insert > Header and Footer | Insert > Header & Footer | Insert > Slide numbers | S | P |
| Crop a picture | Format > Image > Crop | Picture Format > Crop | Crop button on the toolbar | M | P |
| Shadow and transparency on shapes and pictures | Format > Shadow | Shape Format | Format options | S | P |
| Copy and paste slides and objects between presentations | Edit > Paste | yes | yes | S | |
| Paste from PowerPoint or Google Slides keeping text formatting | Paste Special | yes | yes | M | |
| Format painter (copy formatting) | Clone Formatting (toolbar) | Home | toolbar | S | |
| Find and replace across all slides and notes | Edit > Find and Replace | Home > Replace | Edit > Find and replace | S | |
| Zoom the editing view; fit slide to window | View > Zoom | View > Zoom | View > Zoom | S | |
| Nudge objects with arrow keys; duplicate with Ctrl+D | yes | yes | yes | S | |
| Spell check underlines (system checker in the WebView) | Tools > Spelling | Review | Tools > Spelling | S | |

## 2. Common in work decks

| Gap | Impress | PowerPoint | Slides | Size | P |
| --- | --- | --- | --- | --- | --- |
| Charts on a slide (ECharts is already in the app for sheets) | Insert > Chart | Insert > Chart | Insert > Chart | M | P |
| A chart linked to a PearOffice sheet, updating with it | no (OLE link) | linked Excel | linked Sheets | L | P (cross-file) |
| Editing masters and layouts (logo on every slide, own layouts) | View > Master Slide | View > Slide Master | Slide > Edit theme | L | P |
| More themes; own theme colours and fonts | Format > Theme | Design | Slide > Change theme | M | P |
| More shapes: callouts, stars, flowchart, block arrows | Insert > Shape (6 groups) | Insert > Shapes | Insert > Shape | M | P |
| Connectors that stay attached when shapes move | Gluepoints, connectors toolbar | Elbow connectors | Insert > Line > Elbow connector | M | P |
| Icons library | Gallery | Insert > Icons | add-ons | M | |
| Video and audio | Insert > Media | Insert > Video, Audio | Insert > Video, Audio | L | P |
| Slide sorter: a grid of all slides for reordering | View > Slide Sorter | View > Slide Sorter | Grid view | S | |
| Outline view: edit every slide's titles and bullets as one text | View > Outline | View > Outline | no | M | |
| Sections in the slide list | no | Add Section | no | S | P |
| Links to another slide or a web page from an object | Format > Interaction | Insert > Action | Insert > Link | S | P |
| Insert slides from another file | Slide > Insert Slide from File | Reuse Slides | Import slides | M | |
| 4:3 and custom slide sizes when creating (import keeps them in v1) | Slide > Format Slide | Design > Slide Size | File > Page setup | S | P |
| Fields: slide title, slide count, author | Insert > Field | Insert > Text | no | S | P |
| Equations | Insert > OLE Object > Formula | Insert > Equation | no (add-ons) | M | P |
| Templates to start from | File > Templates | New | Template gallery, sidebar | M | |
| Export each slide as PNG; import and export .odp | File > Export | Save As | Download | M | |
| QR code of a link on a slide (`src/shared/qr.js` exists) | Insert > OLE > QR and Barcode | no | add-on | S | P |

## 3. Collaboration

| Gap | Impress | PowerPoint | Slides | Size | P |
| --- | --- | --- | --- | --- | --- |
| **Comments** on a slide or object, replies, resolve | Insert > Comment | Review > Comment | Insert > Comment | L | P |
| A "commenter" role that can comment but not edit | no | no (Word only) | yes | M | P (T3: roles) |
| Version history: see and restore an earlier version | File > Versions | Version history | Version history | L | P |
| Follow a person: jump to the slide they are on | no | no | click avatar | S | |
| Follow along: viewers' screens follow the presenter's slide | no | PowerPoint Live | no | M | P (presence) |
| Lock an object so nobody moves it by accident | Format > Position and Size (Protect) | Lock | no | S | P |
| See someone else's drag live instead of a jump on release | no | yes | yes | M | P (presence) |

## 4. Presenting

| Gap | Impress | PowerPoint | Slides | Size | P |
| --- | --- | --- | --- | --- | --- |
| Use a phone as a remote for the computer that presents | Slide Show > Impress Remote | no (retired) | no | M | P |
| Laser pointer and pen while presenting | pen | Laser, Pen | laser, pen | S | |
| Rehearse timings; slides advance on their own | Slide Show > Rehearse Timings | Rehearse Timings | Auto-advance | M | P |
| Loop as a kiosk | Slide Show Settings | Set Up Slide Show | Auto-advance > Loop | S | P |
| Custom shows (a chosen subset in a chosen order) | Slide Show > Custom Slide Show | Custom Slide Show | no | M | P |
| Presenter view on a phone with an external display (v1 mirrors only) | Impress Remote shows notes | mobile app | no | M | |
| Print or PDF of notes pages and handouts | View > Master Notes, Master Handout | Print > Notes Pages | Print settings | M | |
| Zoom into part of a slide while presenting | no | Zoom | no | S | |
| Start from a slide chosen in the presenter view | Go to Slide | yes | yes | S | |

## 5. Rarely used or out of scope

| Gap | Impress | PowerPoint | Slides | Reason |
| --- | --- | --- | --- | --- |
| 3D objects, Fontwork, WordArt, text along a path | Format, Insert > Fontwork | WordArt, 3D Models | Word art | Decoration few decks need; large to render the same everywhere. |
| Point editing of curves, freeform drawing | Toggle Point Edit Mode | Edit Points, Draw | Scribble | A drawing tool; later if people ask. |
| SmartArt | no | Insert > SmartArt | Diagram | Layout engine of its own; imported as plain shapes at best. |
| Morph and other advanced transitions | no | Morph | no | Needs animations first. |
| Recording narration, export as video | no | Record, Export > Video | Record (through Vids) | Large; media capture and encoding. |
| Live captions, subtitles, audience Q&A | no | Subtitles | Captions, Q&A | Need a speech service or a web page for the audience. |
| Design suggestions, AI rewrite | no | Designer, Copilot | Help me create | Needs a service; against no-cloud. |
| Form controls | Insert > Form Control | Developer | no | Forms on slides are rare. |
| Macros and extensions | Tools > Macros | yes | Extensions | Runs code from a shared file; a security risk in a P2P app. |
| OLE objects, photo album, scanning, image map | Insert, Tools | yes | no | Desktop-office features tied to one computer. |
| Summary slide, expand slide | Slide > Summary Slide | Insert > Zoom > Summary Zoom | no | Rare. |
| Digital signatures, check-in and check-out, remote files | File menu | yes | no | Assume a server or a single owner. |
| Hyphenation, Chinese and Hangul conversion, thesaurus | Tools > Language | Review | no | Rare language tools. |
| Redact, minimize presentation, colour replacer | Tools | no | no | Specialist. |
| Colour, greyscale and black-and-white views | View > Color/Grayscale | View | no | Print preview detail. |

## Suggested order

1. Align and distribute buttons, group and ungroup, nudge and duplicate
   keys, format painter, find and replace, zoom: mostly no proposal
   (grouping needs one).
2. Slide backgrounds, hide slide, slide numbers and footer, shadow and
   transparency, crop: one proposal and one version bump.
3. Transitions, then animations on click.
4. Tables, then charts (from data typed in, later linked to a sheet).
5. Phone as remote and follow-along: both ride on presence and suit a P2P
   app; neither is common elsewhere.
6. Comments, with a commenter role (shared with Documents).
7. Masters and own layouts; more themes and own theme colours.
8. Video and audio, after pictures have run for a while.
