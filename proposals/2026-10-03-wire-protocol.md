# PearSheet v1 wire protocol

**Goal:** define how a shared sheet is stored, synced, shared and backed up by a
blind seeder, so the desktop app can be built against a fixed format.

**Tier:** T3 (new wire protocol, pairing and invite flow, key management).

Inputs: the spikes in `spikes/*/RESULTS.md`, the choices in `DECISIONS.md` and
Tim's answers on 2026-10-03, summarised here:

| Question | Answer |
| --- | --- |
| Platform order | Desktop first (Electron: Linux, macOS, Windows), then mobile, Android first |
| Desktop P2P side | The same Bare program the phones will run, started by Electron |
| Roles | Owner, editor, viewer |
| Who invites and removes | Owner only |
| Group size | Built for up to about 10 people |
| Tabs | Yes, several tabs per sheet in v1 |
| Formatting | Basic: bold, italic, text and fill colour, number formats, column widths |
| History | Undo of your own edits on your device only |
| Several devices, one person | Linked as one identity (`@peerloom/device-link`) |
| Removing someone | The sheet moves to a fresh key without them |
| Seeder pairing | Scan a QR once; the seeder then backs up every sheet you own or join |
| Seeder runs on | A standalone program for Linux, macOS and Windows boxes, plus a "keep my sheets online" tray mode in the desktop app |
| Invites | Single-use, expire after 24 hours |
| Keys on the device | Stored like the other suite apps (app files, no OS keychain) |
| Same cell edited at once | Last edit wins, quietly |

## Scope

### What this covers

The sheet's data format, the Autobase layout, encryption keys, invites and
joining, roles, removal, linked devices, the blind seeder and the desktop
process layout.

### What it does not cover

- UI design.
- The mobile shell, beyond keeping the same worklet.
- .xlsx details: SheetJS CE runs in the UI layer and turns files into ordinary
  edits, so it has no wire effect.
- Shared documents (phase 2).
- Umbrel and Start9 packages for the seeder (not in v1).

## 1. Building blocks

| Layer | Choice |
| --- | --- |
| Group engine | `@peerloom/core` `createGroupEngine`: one encrypted Autobase per sheet, Hyperbee view, Hyperswarm topic, writer-admission pairing. Used as a file dependency, as PearList and PearPetal do. |
| Identity and own devices | `@peerloom/device-link`: a recovery-phrase identity (Ed25519) shared by all of a person's devices. |
| Merging | Yjs 13.6. One Yjs document per sheet. |
| Formulas | Vendored fast-formula-parser with deterministic maths (see `DECISIONS.md`). Formulas are computed on each device and never synced. |
| Seeder | Holepunch `blind-peer` server, with devices using the `blind-peering` client. |
| Relay | None in v1 (Tim, 2026-10-03). People on networks that never allow a direct connection sync only through the seeder, if they can reach it. |

Hypercore 11.37.1 still has the `DefaultEncryption._reload` bug, so PearCircle's
`hypercoreEncryptionPatch.js` is applied at worklet start before any core opens.

## 2. Keys

Each sheet has four secrets or identifiers, all random 32 bytes, minted by the
owner's device when it creates the sheet:

| Key | Who holds it | Purpose |
| --- | --- | --- |
| `sheetId` | members, seeder | Stable id across key moves. Not secret. |
| `topicKey` | members | `topic = blake2b("pearsheet/topic/v1" + topicKey)`, joined on Hyperswarm. |
| `bootstrap` | members, seeder | Autobase bootstrap key (the owner's first writer core). |
| `encryptionKey` | members only | Autobase `encryptionKey`. Hypercore derives each core's block key from this and the core's own key. |

The seeder never receives `encryptionKey` or `topicKey`. The topic is derived
from `topicKey` and not from `bootstrap`, so knowing core keys does not tell
the seeder where members meet.

Per person: the device-link identity keypair (Ed25519), the same on all their
linked devices. Its X25519 form (`crypto_sign_ed25519_pk_to_curve25519`) is used
to seal keys to a person during a key move (section 7).

Per device: its Autobase writer key per sheet, and its Hyperswarm keypair.

Stored on each device in the local Hyperbee, as the other suite apps do:
`sheets:joined:<sheetId>` → `{ sheetId, topicKey, bootstrap, encryptionKey, name, role }`.

## 3. Sheet content: the Yjs document

One `Y.Doc` per sheet:

```
meta    Y.Map    title, version: 1
tabs    Y.Array  ordered tab ids
tab:<tabId>  Y.Map
  name    string
  rows    Y.Array  ordered row ids
  cols    Y.Array  ordered column ids
  cells   Y.Map    "<rowId>:<colId>" -> raw input string ("42", "Rent", "=SUM(...)")
  fmt     Y.Map    "<rowId>:<colId>" -> { b, i, color, fill, num }
  widths  Y.Map    colId -> pixels
```

- **Row and column ids** are random 8-byte values (base64url, 11 chars). Rows
  and columns are inserted by adding an id, so existing cells never move.
  Concurrent inserts at the same place both survive in a stable order.
- **Values and formatting are separate maps,** so one person changing a value
  and another making it bold do not overwrite each other.
- **Deleting a row** removes its id and its cells in one transaction. A cell
  written concurrently into a deleted row is never shown, and formulas that
  point at it show `#REF!`.
- **Formulas are stored with ids, shown with A1 references.** The UI turns
  `=SUM(B2:B9)` into `=SUM({r:Xk..,c:Pq..}:{r:Zz..,c:Pq..})` before saving and
  back when showing. Inserting a row inside a range grows the range, deleting
  a referenced row gives `#REF!`, and a formula never needs rewriting because
  someone else inserted a row. Cross-tab references carry the tab id.
- **Number formats** use the Excel format-code strings understood by SSF
  (bundled with both fast-formula-parser and SheetJS).
- **Same cell edited at once:** Yjs keeps one value on every device and drops
  the other.
- **Undo:** `Y.UndoManager` scoped to local edits only.

Computed values are never stored. Each device evaluates formulas from the
merged cells. The spike showed bit-identical results across Node, Bare and four
timezones once the maths fixes are in. `NOW`, `TODAY`, `RAND` and `RANDBETWEEN`
are device-local and marked as such in the UI. Numbers are shown rounded to
15 significant digits.

## 4. Autobase layout

One Autobase per sheet, built by `@peerloom/core` with `encryptionKey` set.
Writers are the devices of the owner and editors. Viewers' devices hold the
keys and replicate, but are never writers.

### Ops (Autobase entries, JSON)

| Op | Fields | Who may append | Effect in `apply` |
| --- | --- | --- | --- |
| `y` | `data` (base64 Yjs update) | owner and editor devices | `put y/<writerKey>/<seq>` |
| `member` | `identity, role, name, sig` | owner | `put member/<identity>` |
| `device` | `writerKey, identity, sig` | the device itself, signed by its identity | `put device/<writerKey>` |
| `invite` | `inviteId, role, secretHash, expiresAt, sig` | owner | `put invite/<inviteId>` |
| `inviteUse` | `inviteId, identity, writerKey, name` | any writer | if the invite exists and is unused: `put invite-used/<inviteId>`, add the member and `addWriter(writerKey)` when the role is editor |
| `role` | `identity, role, sig` | owner | update the member, `addWriter` or `revokeWriter` for their devices |
| `seeder` | `seederKey, sig` | any member's identity | `put seeder/<seederKey>` |
| `move` | `newSheet, sealed, sig` | owner | `put moved` and revoke every writer, which freezes this base |
| `addWriter`, `revokeWriter` | as in core | as in core, gated by the rules above | as in core |

`sig` is a `records.signValue` signature by the acting person's identity key.
`apply` checks it, and checks that the appending writer key maps to that
identity through `device/<writerKey>`. Anything that fails a check is skipped.
A skip is deterministic, so every device skips the same entries.

Wall-clock time is never read inside `apply`. Invite expiry is checked by the
admitting device before it hands over keys (section 5), not by `apply`.

### View keys (Hyperbee, utf-8 keys, JSON values)

```
sheet                    { sheetId, owner: identity, version: 1 }
member/<identity>        { role: owner|editor|viewer, name, addedBy, sig }
device/<writerKey>       { identity, sig }
invite/<inviteId>        { role, secretHash, expiresAt, sig }
invite-used/<inviteId>   { identity, writerKey }
y/<writerKey>/<seq>      { data }                 one Yjs update
seeder/<seederKey>       { addedBy, sig }
moved                    { newSheet, sealed, sig }
```

### Loading a sheet

The worklet reads every `y/` entry and applies it to a fresh `Y.Doc`. Yjs
updates can be applied in any order and more than once, so Autobase reorders
are harmless. To keep opening fast, each device keeps a local snapshot
(`Y.encodeStateAsUpdate` plus the view length it covers) in its local Hyperbee
and replays only newer entries. The snapshot is never synced.

**Bad updates** (Tim, 2026-10-03: test each one first). Before a `y` update
is applied to the real document, it is applied to a scratch copy. If that
throws, the update is skipped and logged. Every device runs the same check on
the same bytes, so every device skips the same updates. The view still records
the `y/` entry, so a later Yjs fix can re-read it.

## 5. Invites and joining

Owner only, single-use, valid for 24 hours. The link does **not** contain
`encryptionKey`. The key is handed over inside an encrypted connection after
the invite is checked.

1. The owner's device mints `inviteId` (16 bytes) and `secret` (32 bytes) and
   appends `invite { inviteId, role, secretHash: blake2b(secret), expiresAt }`.
2. The link and QR code carry
   `pearsheet://join?s=<sheetId>&t=<topicKey>&i=<inviteId>&k=<secret>&o=<ownerIdentity>&v=1`.
   `topicKey` is in the link so the joiner can find members. It does not open
   anything by itself.
3. The joiner joins the topic and opens Protomux channel `pearsheet/join/1` on
   each connection. It sends `hello { inviteId, secret, identity, writerKey, name }`.
4. Any member device that is online and holds the sheet answers, whether
   owner, editor or viewer. It checks, in order:
   - `invite/<inviteId>` exists and is signed by the owner;
   - `invite-used/<inviteId>` does not exist;
   - `blake2b(secret)` matches;
   - its own clock is before `expiresAt`.
   On success it sends `welcome { bootstrap, encryptionKey, name, role }`.
   Viewers cannot append, so a viewer that admits someone sends the welcome and
   leaves the `inviteUse` to the next writer that sees the joiner's
   `pending { inviteId, identity, writerKey, name }` message.
5. The admitting writer appends `inviteUse`. Once that is applied, the invite
   is spent everywhere.
6. The joiner opens the base with core's join path and the received keys,
   appends its `device` op once it is writable (editors) and writes
   `sheets:joined:<sheetId>`.

Two devices could each check the same invite before either `inviteUse` is
applied. Only the first `inviteUse` in Autobase order takes effect. A leaked
link used twice in that window could hand out the key twice, and the owner
would see an unexpected member and can remove them (section 7).

Implementation note: core's `joinGroup` expects the invite to carry the
encryption key. PearSheet implements steps 3 to 5 itself and then calls core
with the keys. If this works out it is a candidate for core's planned invite kit.

## 6. Linked devices

A person's devices share the device-link identity. When device-link adds a
new device for someone, its group plugin appends a `device` op for that device
in each of the person's sheets. If the person is an owner or editor, it also
appends `addWriter` (allowed because the op is signed by the same identity).

If the owner loses every device, they get the owner role back by restoring the
recovery phrase on a new device. Without the phrase, nobody can change the
sheet's membership again. Editing still works.

## 7. Removing someone: move to a fresh key

Removal changes all keys, because the removed person still holds the old
`encryptionKey` and the seeder hands encrypted blocks to anyone who knows the
core keys.

1. The owner's device creates a new sheet base with a new `topicKey`,
   `bootstrap` and `encryptionKey`. The `sheetId` stays the same. Its first
   entries are:
   - a `y` op holding `Y.encodeStateAsUpdate` of the current document;
   - the remaining `member` and `device` records;
   - `addWriter` for the remaining editors' devices.
2. On the old base it appends
   `move { newSheet: { topicKey, bootstrap }, sealed: { <identity>: crypto_box_seal(newEncryptionKey + topicKey, identityX25519) } }`
   with one sealed entry per remaining person. The move also revokes every
   writer, so the old base is frozen.
3. Every remaining device sees `moved`, opens its own sealed entry with its
   identity key, joins the new base and replaces `sheets:joined:<sheetId>`.
4. The removed person sees the move but cannot open any sealed entry. They keep
   what they already had and nothing after.
5. Members' devices register the new base with the seeder, and a paired device
   tells the seeder the old base has moved. The seeder deletes the old cores a
   week later (section 8).

Demoting an editor to viewer needs no move: it revokes their writers and they
keep reading.

## 8. Blind seeder

### Software

A `blind-peer` server plus a small host (dashboard, pairing, updates) modelled
on `pearcircle/seeder-launcher`. Two ways to run it in v1:

- the standalone seeder for Linux, macOS and Windows boxes;
- the desktop app's "keep my sheets online" mode. This is not a seeder. The app
  stays in the tray as an ordinary member device, with the key, while the
  computer is on.

### Pairing (QR once, follows every sheet)

1. The seeder shows a QR code `pearsheet://seeder?rv=<rendezvous>&seeder=<seederKey>&v=1`
   that is valid for 5 minutes, as in PearCal and PearCircle.
2. The phone or desktop meets the seeder on `blake2b("pearsheet/seeder-pair/v1" + rv)`
   and talks only if the connection's remote public key equals `seederKey`.
3. On channel `pearsheet/seeder-pair/1` the device sends
   `trust { deviceSwarmKey }` and the seeder adds that key to `trustedPubKeys`.
   This lets it announce the device's cores and gives them priority. Nothing
   about any sheet is sent here.
4. The device stores `seederKey` and appends `seeder { seederKey }` to every
   sheet it is in, now and in future. Its own `blind-peering` registration of
   a sheet (`addAutobase`) tells the seeder that sheet's bootstrap key, and the
   seeder records it as an allowed sheet.
5. Every member's device sees the `seeder` record and registers the sheet with
   the seeder too, so each member's writer cores reach it even when the
   pairing device is off.

**Who the seeder stores data for.** Only sheets that a paired device has
registered (Tim, 2026-10-03). A core is accepted when it arrives from a paired
device, or when its Autobase target is a bootstrap key already on the allowed
list. Anything else is refused. Strangers would need a registered sheet's
bootstrap key, which only members and the seeder hold. `blind-peer` does not do
this today: untrusted peers only lose the `announce` flag. PearSheet wraps or
patches its `add-core` handling to enforce the list.

**Old copies after a move.** The seeder deletes a sheet's old cores one week
after a member's device registers the new base with a `move` notice for the old
bootstrap key (Tim, 2026-10-03). The seeder cannot read the `move` op itself,
so a paired device sends the notice over channel `pearsheet/seeder/1`, which
paired devices open on every connection to the seeder.

### What the seeder receives

| Received | Why |
| --- | --- |
| The bootstrap key, plus core public keys and lengths for each writer core and view core of a sheet | `blind-peering.addAutobase` sends these so the seeder can store and serve them |
| Encrypted blocks and their Merkle proofs | Normal Hypercore replication |
| Paired devices' swarm public keys, IP addresses and timing | Connections |

It never receives `encryptionKey`, `topicKey`, invite secrets, sealed move
entries in readable form or anything from the Yjs document.

### Why it cannot decrypt

Every block in every core of the sheet is encrypted by Hypercore with a block
key derived from `encryptionKey` and that core's key. The seeder has the core
keys but not `encryptionKey`, so it can check and serve blocks but not read
them. The `autobase/encryption` userData entry that stores the key on member
devices is local storage and is not replicated. The CRDT spike scanned every
block the seeder held and found no readable cell text (0 of 15), while the
owner's own decrypted copy did contain it.

What it can learn: how many sheets a paired person has, how many writers each
has, how big they are, when edits happen and which IPs connect. None of
that is sheet content, and this proposal does not try to hide it.

## 9. Desktop process layout

- **Electron main process:** window, tray, files and updates.
- **Electron renderer:** the React spreadsheet UI. This is the same UI the
  mobile WebView will load later, and .xlsx import and export run here.
- **Worklet:** the `bare` binary (from `bare-runtime-<os>-<arch>`), started by
  main as a child process. It runs the same bundle the phones will run:
  `@peerloom/core`, Yjs, the formula engine and `blind-peering`. Main and the
  worklet talk newline-delimited JSON over stdio, which is core's existing IPC
  format.
- **Who does what:** the worklet holds the Yjs document and computes formulas.
  The UI sends edits and receives changed cells and computed values.

## Compat

v1 is the first version, so there are no old peers. For later versions:

- `sheet.version`, `meta.version` and the `v=` in links are all 1.
- A device that sees a higher major version refuses to write and shows "update
  PearSheet to edit this sheet". It still shows the last state it understood.
- Every op type `apply` does not recognise is skipped, so additive changes
  (new formatting keys, new op types) do not break older devices. Older devices
  ignore what they do not know.
- Changes to the Yjs layout must be additive. Removing or renaming a Yjs field
  needs a move to a new base with a migrated document, as in section 7.

## Verify

1. **Unit tests (Node and Bare):**
   - `apply` authorisation for each op: signed by the wrong identity, writer
     key not mapped, viewer appending `y`, invite reused;
   - the formula golden corpus, which must be bit-identical in both runtimes;
   - id-based formula references across row and column inserts and deletes.
2. **Integration on a local test DHT:**
   - owner, editor and viewer plus a seeder;
   - offline edits converge;
   - the viewer cannot write;
   - a single-use invite fails the second time and after expiry;
   - a new device syncs from the seeder alone;
   - removal moves everyone except the removed person, who cannot open the new
     base;
   - plaintext scan of every core the seeder holds, writer and view cores both;
   - the seeder refuses cores from an unpaired device for an unknown sheet, and
     accepts an unpaired member's cores for a registered sheet;
   - a bad Yjs update is skipped the same way on every device;
   - the seeder deletes old cores a week after a move notice (with a test
     clock).
3. **Desktop, two real machines** (Linux dev box and the Mac Mini, then a
   Windows box): invite by link, edit live, one machine offline and then back,
   seeder pairing by QR, then sync while both members are offline except the
   seeder.
4. **Mobile phase:** an emulator first, then the TCL, per suite rules 6 and 15.

## Rollback

- **Before release:** no users. Revert the change.
- **After release:** the version fields let a later build refuse to write to a
  sheet it no longer handles safely, without corrupting it. Any sheet can be
  exported to .xlsx and re-imported into a fresh sheet as a last resort.
- A bad seeder build cannot damage sheets because it cannot write to them.
  Stopping it only loses availability while members are offline.
- If `blind-peer` misbehaves, fall back to PearCal's simpler seeder pattern
  (open cores by key and download them), which needs the same inputs and the
  same pairing.

## Open questions

Settled on 2026-10-03 and folded in above: the seeder stores only sheets a
paired device registered (section 8); each update is tested on a scratch copy
first (section 4); old copies are deleted a week after a move (section 8); no
relay in v1 (section 1).

Still open:

1. **Long-lived sheets.** Opening replays every update after the last local
   snapshot, and a new device replays everything, which may be slow after
   years of edits. A shared compaction step (the owner writes a full-state `y`
   op and members prune) can be added later without a format change. Measure
   during the desktop build before designing it.

## Changes after approval

Recorded here so the approved text stays readable. Pre-release, so no peers
are affected.

- 2026-10-03, engine scaffold: the topic is core's `topicForKey(topicKey)`,
  which is `blake2b(topicKey)`, instead of a PearSheet-prefixed hash. Core
  derives topics itself and the seeder still never gets `topicKey`.
- 2026-10-03, engine scaffold: formatting is stored one attribute per key,
  `fmt` `"<rowId>:<colId>:<attr>"` -> value, instead of one object per cell.
  With one object per cell, two people changing different attributes of the
  same cell at once would lose one change.
- 2026-10-03, invites: the invite record publishes an Ed25519 public key
  (`invitePub`, from the 32-byte secret used as a seed) instead of
  `blake2b(secret)`. The joiner signs its request and its claim with the
  secret. With only a hash in the view, an editor who read an unused invite
  record could have appended an `inviteUse` for anyone; with a public key,
  `apply` checks that the claim was signed by whoever holds the secret.
- 2026-10-03, invites: the `inviteUse` op carries two signed objects, the
  joiner's `claim` (signed with the invite secret) and its `device` proof
  (signed with its identity), so `apply` can check both without trusting the
  admitting writer.
- 2026-10-03, membership: new `name` op so a member can rename themselves.
  Signed by their identity, appended only by their own devices, with a version
  counter so an old rename cannot be replayed. Viewers cannot append, so they
  keep the name they joined with.
- 2026-10-03, membership: core's own `addWriter` ops are always refused and
  core never mints them. Writers are added only by `inviteUse` and `role`.
- 2026-10-03, joining: the joiner looks the topic up again every few seconds
  while a join is pending. Hyperswarm otherwise waits minutes before a second
  lookup, so a joiner who looked before any member announced sat idle.
- 2026-10-03, seeder: blind-peering dials with `peering.keyPair`, which it
  never sets, so connections used a random key per process and the seeder
  could not recognise paired devices. The app sets it to the device's swarm
  key, the one sent at pairing.
- 2026-10-03, seeder: blind-peering sends an Autobase in two batches, writer
  cores with the bootstrap key as referrer and then view cores with no
  referrer. The seeder accepts a referrer-less batch only on a connection that
  has already shown an allowed referrer. Otherwise the other members of a
  paired person's sheets were refused and disconnected.
- 2026-10-03, seeder: deleting old cores a week after a move is not built yet.
  It arrives with removal (section 7), since moves do not exist before that.
  Built 2026-10-04 with deleting sheets (proposals/2026-10-04-deleting-sheets.md):
  the device sends a `drop` request on `pearsheet/seeder/1` right after the
  move, and the seeder runs it 7 days later.
- 2026-10-03, removal: a move creates a sheet with a **new** sheet id, where
  section 7 kept the same one. Every signed op carries the sheet id, so with
  the same id a dishonest editor could copy the owner's old signed invites or
  role changes into the new sheet and, for example, let the removed person
  back in. The old sheet's `moved` record points to the new one; devices hide
  the old sheet once they have followed.
- 2026-10-03, removal: the whole move target (new sheet id, topic key,
  bootstrap and encryption key) is sealed to each remaining person; nothing
  about the new sheet is in clear in the old one.
- 2026-10-03, removal: the old sheet freezes in `apply` (every op after
  `moved` is ignored) instead of revoking every writer, since Autobase will
  not remove its last indexer. An edit made in the old copy by someone who
  had not yet seen the move is lost; the Share panel says so before removing.
- 2026-10-03, removal: two ops added. `member` may now also be an
  owner-signed record for someone else (used to carry members into the new
  sheet). `admit` lets an owner or editor register an existing member's
  device, carrying the device's own proof; it is how remaining members'
  devices become writers in the new sheet, and the same op will serve linked
  devices.
