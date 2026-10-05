# Spike: CRDT library in an encrypted Autobase, with a blind seeder

Run 2026-10-03 on the Linux dev box. Desktop first per Tim's call, so the
Android emulator run is deferred to the start of the mobile phase.

## What `spike.js` does

1. Device A creates an encrypted Autobase (random 32-byte `encryptionKey`) and
   admits device B as a writer.
2. A lays out 3 rows and 3 columns and writes one cell (`SECRET-BUDGET-4242`).
3. A and B go offline and edit concurrently: both set the same cell, each sets
   a different cell, each inserts a row at the same position.
4. They reconnect over a local test DHT. Check both reach the same sheet.
5. A blind seeder (`blind-peer` server) is added. A and B register the base with
   it through `blind-peering`. The seeder gets core public keys and lengths only.
6. Scan every raw block the seeder holds for the cell text.
7. A and B shut down. New device C (has the keys, no prior data) syncs from the
   seeder alone.
8. C restarts and rebuilds the sheet from its local view.
9. 2000 single-cell edits through Autobase for throughput and size.

Sheet model: ordered lists of stable row and column ids, cells keyed
`rowId:colId`. A row insert adds an id and never renumbers cells.

## Results

| | Yjs 13.6.33 | Automerge 3.5.0 |
| --- | --- | --- |
| Node 22 (V8 12.4) | all checks pass | all checks pass |
| Bare 1.34.1 (V8 14.8) | all checks pass | all checks pass |
| Converged after offline edits | yes, 100 ms | yes, 100 ms |
| Seeder blocks with readable cell text | 0 of 15 | 0 of 15 |
| Owner's own decrypted blocks with it (sanity) | 1 | 1 |
| New device synced from seeder alone | yes, ~100 ms | yes, ~100 ms |
| Restart rebuilds from local view | yes | yes |
| 2000 edits (Bare) | 4.1 s | 5.1 s |
| Average update size | 34 bytes | 152 bytes |
| Library size | 0.3 MB (+ lib0) | 5.0 MB (wasm inlined as base64) |

Concurrent writes to the same cell: both libraries keep one value and drop the
other (`from-b` won in both). Automerge can list the losing value through
`getConflicts`; Yjs cannot.

## Runtime shims Bare needed

- Yjs: `lib0` requires `node:crypto` for `getRandomValues`. Mapped to a shim
  over `sodium-universal` via a bare-pack import map.
- Automerge: needs `TextEncoder`/`TextDecoder` and `globalThis.crypto`
  globals, plus an import map to its base64 build (the default Node entry reads
  the `.wasm` with `fs`).

## Recommendation: Yjs

- **Automerge needs WebAssembly.** Apple does not let third-party iOS apps
  generate code at run time, so V8 runs with `--jitless` there, and jitless V8
  has no WebAssembly unless it is built with the DrumBrake interpreter. The
  iOS BareKit binary in `pearpetal/node_modules/react-native-bare-kit` has the
  `--jitless` flag string and no DrumBrake symbols. Confirmed on the iPhone
  SE on 2026-10-05 (iOS 27.0.1, react-native-bare-kit 0.12.3): inside the
  PearSheet worklet `typeof WebAssembly` is `"undefined"`, so a tiny module
  cannot even be compiled. The same check under Node gives `add(2,3)=5`.
  Automerge cannot run in PearSheet on iOS.
- Yjs is far smaller (0.3 MB plus the parts of lib0 it uses, against 5 MB),
  its updates are 4.5x smaller and it was about 20% faster.
- The one Automerge advantage (seeing conflicting values) is not needed for v1.
  Google Sheets also keeps the last write.

## Other findings for the proposal

- Hypercore 11.37.1 (latest) still has the `DefaultEncryption._reload` bug that
  PearCircle patches in `src/lib/hypercoreEncryptionPatch.js`. PearSheet must
  apply that patch.
- `blind-peer` downgrades `announce` to false for peers not listed in
  `trustedPubKeys`. Devices still reach the seeder by dialing its key, which is
  how C synced here.
- The CRDT state is idempotent, so the Autobase view can simply be "every
  update in log order" and reorders are harmless.

## Re-run

```
npm install && chmod +x node_modules/bare-runtime-linux-x64/bin/bare
npx bare-pack --host linux-x64 --offload-addons --imports bare-imports.js -o pack/spike.bundle spike.js
node_modules/bare-runtime-linux-x64/bin/bare pack/spike.bundle yjs ./tmp
node_modules/bare-runtime-linux-x64/bin/bare pack/spike.bundle automerge ./tmp
```
