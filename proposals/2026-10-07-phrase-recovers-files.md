# The recovery phrase brings your files back

**Status:** draft, 2026-10-07. Asked for by Tim after reviewing what the
phrase does (PR #138, `test/recovery.test.js`).

**Goal:** someone who loses every device gets their files back with their
24 words, not only their identity.

**Tier:** T3. Key handling (file keys leave the device, encrypted), a new
seeder feature and a new restore flow. A leaked phrase becomes more
damaging (see Risks).

## What happens today

Checked with real engines in `test/recovery.test.js`:

- The phrase restores the identity (same public key) and nothing else.
- The restored device has no files: the phrase holds no file keys.
- A file someone else owns: the owner sends a new invite, and the person is
  back as the same member; their name comes back with it.
- A file the person owned: nobody else can invite (only owners can), so it
  cannot come back. A solo file is gone.

The app now says this (Devices panel, onboarding), and linking a second
device is the only protection for files you own.

## Design

Two parts: an encrypted list of your files kept by your seeders, and a
restore that uses it.

### 1. The keyring

Every device of an identity keeps a **keyring**: for each file it is in,
the file id, group key, encryption key, bootstrap key, kind, title and
role, plus the keys of its paired seeders. About 320 bytes a file, so
1,000 files is about 320 KB; the limit is 1 MB.

Everything is derived from the identity seed with BLAKE2b (the existing
`sodium.crypto_generichash`, keyed, one purpose string each):

| Name | Derived as | Used for |
| --- | --- | --- |
| locator `L` | `H(seed, 'pearoffice/keyring/locator/1')` | the address of the keyring at a seeder |
| topic `T` | `H(L, 'pearoffice/keyring/topic/1')` | where a restoring device finds seeders that hold it |
| sign key `S` | Ed25519 from `H(seed, 'pearoffice/keyring/sign/1')` | signs each keyring version |
| box key `B` | `H(seed, 'pearoffice/keyring/box/1')` | encrypts it (XChaCha20-Poly1305, random nonce) |

A device writes the keyring when its files change (joined, created,
removed, moved), at most once a minute: it fetches the current version
first, merges (files from both, removals kept as tombstones for 30 days),
encrypts with `B`, signs `{ L, seq, ciphertext }` with `S` and sends it to
each paired seeder. Higher `seq` wins.

### 2. The seeder keeps it

A new message on the seeder's existing request channel
(`pearoffice/seeder/1`, src/worklet/seeding.js `ask`):

- `keyring-put { L, seq, ciphertext, sig, signKey }` from a **paired device
  only**. The first put for `L` fixes `signKey`; later puts must be signed
  by it and have a higher `seq`. At most 1 MB, at most 4 keyrings per
  paired device.
- `keyring-get { L }` from anyone who knows `L`: returns the latest signed
  version, or nothing.

The seeder joins topic `T` for every keyring it holds, so a restoring
device that knows only its phrase can find it. The seeder stays blind: it
holds ciphertext under a key derived from the seed and never sees a file
key. It learns a keyring's size and when it changes.

### 3. Restore

After `app:restorePhrase` and the restart, before anything else:

1. Derive `L`, `T`, `S` and `B`; join `T`; ask every seeder found for
   `keyring-get`. Take the highest `seq` whose signature checks against
   `S` and that decrypts with `B`.
2. Store the seeder keys as paired (the device can then back up there too,
   once re-paired by the seeder's own rules; see open question 2).
3. For each file: open it with its keys. Then, as a linked device does
   today (linking.js `resume`, moves.js admission), it asks to be admitted
   as a new device of an existing member.
   - **Another owner or editor is online:** their device admits it; the
     person is back, same role, nothing else changes.
   - **Nobody else can write** (a solo file, or only viewers): the device
     can still read everything from the seeder, so it offers to **make a
     copy you own** with fresh keys, as tidy up does (moves.js). Viewers of
     the old file are invited again by hand.
4. The file list shows each recovered file as "Waiting for someone to let
   this device in" or "Make a copy you own", and a banner says how many
   came back.

Without a seeder, nothing changes from today: the keyring lives only on
your seeders.

## Risks

- **A leaked phrase hands over every file.** Today a leaked phrase lets
  someone act as you, but they still need an invite or a link to read a
  file. With a keyring they can read everything your seeders hold. The
  phrase screens already warn; the warning grows. See open question 1.
- **Two devices writing the keyring at once** lose nothing: each merges
  before writing; the loser's next write merges again.
- **A removed person's keyring** still lists the old file's keys, but a
  removal moves the file to fresh keys (moves.js), so they only reach the
  frozen old copy. Same as a removed person's own device today.
- **Seeder storage:** 1 MB and 4 keyrings per paired device.

## Compat

- Older seeders refuse the new messages; the app says "This seeder needs an
  update to keep your file list" and recovery works only with updated
  seeders (desktop, Linux download, Umbrel and StartOS images all update).
- Older app builds ignore keyrings. Nothing in a file changes, so no file
  version bump and no wire change for members.
- Nothing has been released, so there are no old keyrings to migrate.

## Verify

- Unit: the derivations are stable and differ by purpose; put rules (paired
  only, first key fixed, seq must grow, size cap); merge with tombstones.
- Engines over the test DHT with a real seeder:
  - Ed loses his only device; restores; his files come back from the
    seeder; a file Olive owns admits his new device while Olive is online;
    his own solo file offers a copy he owns, which has the same content.
  - A device without the phrase cannot read or replace the keyring.
  - The seeder holds only ciphertext (the picture tests' marker check).
  - Two devices writing at once both end up in the merged keyring.
- Phones: restore on the TCL from a desktop identity, with the seeder on the
  Umbrel.

## Rollback

Stop writing keyrings and hide the restore steps. Seeders keep what they
have until a paired device forgets them; nothing else depends on it.

## Order

1. Derivations, keyring format, merge (worklet, no network).
2. Seeder `keyring-put` and `keyring-get`, topic joins, limits.
3. Devices write keyrings; Settings shows "Your file list is backed up to N
   seeders".
4. Restore flow, admission waits, "make a copy you own", UI.

## Open questions

1. Keyring on by default, or a switch ("Back up my file list so my phrase
   can bring files back")? Recommended: on by default when you have a
   seeder, with the phrase warning made stronger.
2. A restored device finds your seeders through topic `T`, but the seeders
   accept new cores only from paired devices. Recommended: a seeder treats
   a device that proves it holds `S` for a keyring it keeps as paired (the
   seeder already trusts that keyring's owner).
3. Should a viewer-only or solo file's copy keep the old title with
   "(recovered)", or the same title?
