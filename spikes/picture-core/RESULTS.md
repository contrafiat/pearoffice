# Spike: a picture core per writer per file

Checks the three guesses in `proposals/2026-10-06-document-images.md` before
building design B. Run 2026-10-06 on the Linux dev box, Node 22, hypercore
11.37.1, hyperblobs 2.12.1, autobase 7.28.2, blind-peer 3.15.1, blind-peering
2.10.0, ImageMagick 7.1.2 (libwebp 1.6.0).

- `spike.js <picture> [<picture2>]`: guesses 1 and 2, with the real engine,
  the real seeder and a local test DHT. `NOPATCH=1` runs it without the
  `DefaultEncryption._reload` fix.
- `sizes.sh <out-dir>`: guess 3. `sizes.csv` is its output.

## 1. Encryption with the file key: works

How the file's cores are encrypted today: `@peerloom/core` passes the file's
32-byte `encryptionKey` to Autobase (`buildBase`, engine.js:224), in a
Corestore namespace per file. Autobase derives a block key per core from it.
Every device has the key as `base.encryptionKey`.

What `spike.js` does: device A makes a document, B and C join as editors. A
opens `store.get({ name: 'pictures/' + fileId, encryption: { key } })`, wraps
it in Hyperblobs and stores a 462 KB JPEG with a text marker in its comment
segment. Every check below passed.

| Check | Result |
| --- | --- |
| Picture size, blocks | 461,894 bytes, 8 blocks of 64 KB, 8 bytes padding each |
| Reference string | 77 characters (core key plus the four id numbers) |
| B (has the file key) opens the core by key and reads it | yes, hash matches |
| Raw blocks on A and on B: marker, JPEG header, 64 bytes from inside, picture hash | 0 hits in 8 blocks each |
| A's disk, every file | no picture bytes (scan sanity: a plain core's marker was found) |
| A device without the key replicates the core | gets 461,958 bytes of ciphertext, no JPEG header, wrong hash |
| Opened with the plain file key instead of the picture key | does not decrypt |
| Without the `_reload` patch | also passes (B gets the manifest before the first block) |

Which key: use a key derived from the file key, a keyed BLAKE2b of the
purpose string `pearoffice/pictures/1` with the file key as the key (the
same style as `linking.js` and `seeder/protocol.js`). Hypercore's default
encryption already mixes in each core's own key, so passing the file key
straight in would also be safe. The derived key costs one line and keeps
picture cores apart from anything else that ever uses the file key. A move
makes a new file key, so the new file's picture key changes with it.

Keep the `_reload` patch applied in the worklet as it is today. This path did
not need it, but readers open picture cores by key with no manifest, which is
the case the patch was written for.

## 2. Seeder backup: works, no seeder change

A pairs with the real seeder (`createSeeder`). A (paired) and B (not paired)
each register their picture core through the engine's own blind-peering:
`engine.seeding.peering.addCoreBackground(core, { referrer: base.key, keys: [seederKey] })`.
Then C, A and B close. C comes back with only the seeder online.

| Check | Result |
| --- | --- |
| Seeder stores A's picture core (paired device) | yes, 51 ms after registering |
| Seeder stores B's picture core (member, not paired) | yes |
| C held picture blocks before fetching | 0 |
| C reads A's and B's pictures from the seeder alone | yes, hashes match, about 5 s |
| Seeder raw blocks: plaintext hits | 0 in 8 blocks |
| Seeder disk (17 files, 827 KB): plaintext hits | 0 |
| `scheduleDrop(file, 0)` | "dropped sheet (8 cores)", picture core length 8 to 0 |

Why no change is needed: the seeder's `admit` takes any core from a paired
device and adds its referrer to the allowed list, and takes cores from anyone
else when the referrer is already allowed. `track` files every accepted core
under `core/<file>/`, and a drop deletes them all. The referrer has to be the
base key (`base.key`), the same key blind-peering sends for the Autobase.

The 5 s for C is its seeding sweep (`SWEEP_MS`) opening the connection to
the seeder. Picture downloads ride that connection, so readers need no
registration of their own.

Trap found: in a test, do not open a picture core on the seeder before
blind-peer has its record (`seeder.peer.db.getCoreRecord`). Opening it first
lets the seeder fetch the length over the open connection; blind-peer then
treats the add as known, writes no record and never downloads the blocks.
Nothing on a real seeder opens cores that way.

## 3. Sizes after shrinking to 1600 px: smaller than guessed

Photos are real photographs (KDE wallpapers) blown up to 12 MP (4000x3000)
with light noise, as a phone would hand them over. JPEG at 4:2:0, as browsers
encode it. Sizes in KB.

| Picture | Source | JPEG q80 | WebP q80 | PNG |
| --- | --- | --- | --- | --- |
| Photo, Autumn | 7,220 | 249 | 180 | 3,285 |
| Photo, By the water | 3,925 | 287 | 192 | 2,993 |
| Photo, Cold ripple | 6,913 | 188 | 93 | 3,086 |
| Photo, Colourful cups | 4,427 | 190 | 88 | 2,932 |
| Photo, Path (fine detail) | 7,719 | 462 | 421 | 3,929 |
| Worst case, noise everywhere | 16,474 | 422 | 519 | 4,306 |
| Screenshot, desktop 1280x820 | 54 | 43 | 20 | 55 |
| Screenshot, desktop with photo | 120 | 86 | 41 | 122 |
| Screenshot, desktop HiDPI 2560x1640 | 81 | 57 | 26 | 132 |
| Screenshot, phone 1080x2424 | 139 | 51 | 21 | 126 |
| Screenshot, phone, busy | 267 | 97 | 48 | 250 |
| Diagram 2400x1600 | 178 | 57 | 23 | 239 |

- Photos: 190 to 460 KB as JPEG, 90 to 420 KB as WebP. The guess was 200 to 400.
- Screenshots and diagrams: 40 to 100 KB as JPEG, 20 to 50 KB as WebP. The
  guess was 50 to 300.
- The 1 MB cap never came close. The largest result was 519 KB. Only an
  unshrunk PNG would pass it, and the UI never keeps one that size.
- PNG was never the smaller choice at 1600 px, not even for screenshots, so
  the "keep PNG when smaller" rule will almost never fire.

What the UI should pick: WebP at 0.8 where the WebView can encode it
(Chrome, Electron and the Android WebView can), else JPEG at 0.8. WebKit
(Safari and the iOS WKWebView) decodes WebP but `canvas.toBlob(cb,
'image/webp')` hands back a PNG instead, so check `blob.type` and fall back
to JPEG. WebP is 10 to 60 percent smaller on photos and about half on
screenshots, but larger than JPEG on pure noise, so where both encoders
exist, encode both and keep the smaller. Every device can show either.

## What the build should do differently from the proposal

1. Picture key: `blake2b(key = fileKey, 'pearoffice/pictures/1')`, passed as
   `encryption: { key }` to `store.get` for the writer's core and for every
   reader's open by key.
2. Register with `referrer: base.key`. `seeding.js` must also register
   picture cores again after `rebuild()` (taking a seeder off a file starts a
   fresh blind-peering instance and re-adds only the bases). That is a
   device-side change; the seeder needs none.
3. Encode WebP where the WebView supports it, JPEG otherwise, keep the
   smaller. The proposal said JPEG only.
4. The size estimates in the proposal can drop: a typical photo is about
   250 KB as JPEG or 180 KB as WebP, a screenshot 20 to 100 KB.
