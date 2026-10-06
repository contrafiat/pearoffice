#!/usr/bin/env bash
# Guess 3: sizes after shrinking to 1600 px on the long side.
# Usage: spikes/picture-core/sizes.sh <out-dir>
set -euo pipefail
OUT=${1:?out dir}
mkdir -p "$OUT/src" "$OUT/out"
SCR=/tmp/claude-1000/-home-tim-peerloomllc-pearoffice/90f05ce4-a75a-49ce-b5c6-ad30f7bfd325/scratchpad

# Photos: real photographs (KDE wallpapers, 2560x1600) made into 12 MP
# 4000x3000 frames with light sensor-like noise, as a phone would hand over.
for name in Autumn BytheWater ColorfulCups Path ColdRipple; do
  magick "/usr/share/wallpapers/$name/contents/images/2560x1600.jpg" -resize 4000x3000^ -gravity center -extent 4000x3000 \
    -attenuate 0.4 +noise Gaussian -quality 92 "$OUT/src/photo-$name.jpg"
done

# Worst case: fine noise everywhere, nothing a codec can save on.
magick -size 4000x3000 plasma:fractal -attenuate 2 +noise Gaussian -quality 92 "$OUT/src/photo-worst-noise.jpg"

# Screenshots: desktop app (1280x820) and Android emulator (1080x2424).
cp "$SCR/doc-editor.png" "$OUT/src/shot-doc-editor.png"
cp "$SCR/btc.png" "$OUT/src/shot-btc.png"
cp "$SCR/emu1.png" "$OUT/src/shot-phone1.png"
cp "$SCR/emu4.png" "$OUT/src/shot-phone4.png"
# A HiDPI desktop screenshot (2560x1640), the app at 2x.
magick "$SCR/doc-editor.png" -filter point -resize 200% "$OUT/src/shot-hidpi.png"

# Diagram: boxes, arrows and labels on white, 2400x1600.
magick -size 2400x1600 xc:white -stroke '#334' -strokewidth 6 -fill '#dde8ff' \
  -draw 'roundrectangle 150,200 750,500 30,30' -draw 'roundrectangle 900,200 1500,500 30,30' -draw 'roundrectangle 1650,200 2250,500 30,30' \
  -fill '#ffe9d6' -draw 'roundrectangle 525,900 1125,1200 30,30' -draw 'roundrectangle 1275,900 1875,1200 30,30' \
  -fill none -draw 'line 750,350 900,350' -draw 'line 1500,350 1650,350' -draw 'line 450,500 825,900' -draw 'line 1200,500 1575,900' -draw 'line 1950,500 1575,900' \
  -stroke none -fill '#223' -pointsize 64 \
  -annotate +260+370 'Phone' -annotate +1020+370 'Worklet' -annotate +1780+370 'Seeder' -annotate +640+1070 'Picture core' -annotate +1400+1070 'Document' \
  -pointsize 40 -annotate +150+1400 'Each writer device keeps one picture core per file, encrypted with the file key.' \
  "$OUT/src/diagram.png"

printf 'file,source,srcbytes,w,h,jpeg80,webp80,png\n'
for f in "$OUT"/src/*; do
  b=$(basename "${f%.*}")
  magick "$f" -resize '1600x1600>' -strip -quality 80 -sampling-factor 4:2:0 "$OUT/out/$b.jpg"
  magick "$f" -resize '1600x1600>' -strip -quality 80 "$OUT/out/$b.webp"
  magick "$f" -resize '1600x1600>' -strip "$OUT/out/$b.png"
  wh=$(magick identify -format '%w,%h' "$OUT/out/$b.jpg")
  printf '%s,%s,%s,%s,%s,%s,%s\n' "$b" "$(magick identify -format '%wx%h' "$f")" "$(stat -c %s "$f")" "$wh" \
    "$(stat -c %s "$OUT/out/$b.jpg")" "$(stat -c %s "$OUT/out/$b.webp")" "$(stat -c %s "$OUT/out/$b.png")"
done
