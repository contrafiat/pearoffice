# PearOffice icon

`recraft-cards-original.svg` is the source, generated in Recraft by Tim on
2026-10-06 (2048x1509, kept as delivered): the suite's pear with three cards
for spreadsheets (green), documents (blue) and slides (red-orange). The
others crop it to a square without redrawing, with two colours changed to
match the suite: the pear's lit half to rgb(170,202,58) (it came as a
brighter lime) and the background to #00271b.

- `pearoffice.svg` - full bleed, for phones and stores (each system adds its
  own corners). Rendered to `assets/images/icon.png`.
- `pearoffice-foreground.svg` - the pear alone, smaller, for the Android
  adaptive icon (background `#00271b` in `app.json`). Rendered to
  `assets/images/adaptive-icon.png`.
- `pearoffice-desktop.svg` - a rounded square with a margin, on Apple's
  824/1024 grid. Rendered to `desktop/build/icon.png` (electron-builder
  makes the macOS and Linux icons from it) and `desktop/build/icon.ico`.

Re-render: `magick -background none -density 300 <file>.svg -resize 1024x1024 <out>.png`,
and `magick desktop/build/icon.png -define icon:auto-resize=256,128,64,48,32,16 desktop/build/icon.ico`.

`recraft-fx-original.svg` is the earlier spreadsheet-only icon (2026-10-04).
