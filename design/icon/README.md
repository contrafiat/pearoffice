# PearOffice icon

`recraft-fx-original.svg` is the source, generated in Recraft by Tim on
2026-10-04 (2048x1509, kept as delivered). The others crop it to a square
without redrawing:

- `pearoffice.svg` - full bleed, for phones and stores (each system adds its
  own corners). Rendered to `assets/images/icon.png`.
- `pearoffice-foreground.svg` - the pear alone, smaller, for the Android
  adaptive icon (background `#00271b` in `app.json`). Rendered to
  `assets/images/adaptive-icon.png`.
- `pearoffice-desktop.svg` - a rounded square with a margin, on Apple's
  824/1024 grid. Rendered to `desktop/build/icon.png` (electron-builder
  makes the macOS and Linux icons from it) and `desktop/build/icon.ico`.

Re-render: `magick -background none -density 300 <file>.svg -resize 1024x1024 <out>.png`.
