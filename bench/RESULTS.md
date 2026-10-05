# Long-lived sheets: load time and size

Measured 2026-10-03 on the Linux dev box (Node 22, local DHT testnet).
`bench/load-time.js` fills a sheet with N single-cell edits (60% numbers,
20% text, 20% `SUM` formulas over a 2,000 x 20 area, so cells are overwritten
many times, as in a budget that is updated for years), then reopens it.
`bench/join-time.js` times a new device joining.

## Before local snapshots

| Edits | Per edit | Reopen: rebuild sheet | First view | Yjs state | Disk |
| --- | --- | --- | --- | --- | --- |
| 1,000 | 2.8 ms | 0.09 s | 0.20 s | 66 KB | 16 MB |
| 10,000 | 2.9 ms | 0.63 s | 0.25 s | 300 KB | 42 MB |
| 100,000 | 3.2 ms | 7.6 s | 0.32 s | 2.6 MB | 178 MB |

A new device joins a 10,000-edit sheet and shows it in 3.8 s.

Reopening replayed every update. On a phone (several times slower than this
box) a heavily used sheet would take tens of seconds to open.

## After local snapshots (PR #21)

Each device saves the document state every 2,000 updates and on shutdown, in
a per-sheet local core whose older copies are cleared. Reopening loads the
snapshot and replays only what came after.

| Edits | Reopen: rebuild sheet | First view | Disk |
| --- | --- | --- | --- |
| 10,000 | 0.06 s | 0.30 s | 45 MB |
| 100,000 | 1.1 s | 0.32 s | 203 MB |

A first attempt kept snapshots in the local Hyperbee, which only appends:
every old copy stayed on disk and the 100,000-edit sheet took 343 MB.

## What is left

- **Disk: about 2 KB per edit** (Autobase writer core, system core and view,
  each with Merkle data and encryption padding). A household budget edited
  daily for years stays well under 100 MB. Shrinking it needs a shared
  compaction step (the owner writes one full-state update and members prune
  old ones), which is a wire change (T2). Not needed yet.
- **Yjs state grows with overwrites** (2.6 MB at 100,000 edits on ~700
  cells): Yjs keeps a small record of every overwritten value. Same
  compaction would reset it.

## After shared compaction (proposals/2026-10-05-shared-compaction.md)

`bench/compaction.js`: a sheet gets N edits, a new device joins it; then the
owner tidies up and another new device joins the tidied copy. Measured
2026-10-05, same box.

| Edits | Tidy-up | New device joins: before | after | Its disk: before | after |
| --- | --- | --- | --- | --- | --- |
| 10,000 | 0.15 s | 2.3 s | 0.26 s | 7.5 MB | 1.2 MB |
| 50,000 | 0.83 s | 19.3 s | 0.70 s | 69.7 MB | 5.2 MB |

The owner's device tidies up by itself at 50,000 updates.
