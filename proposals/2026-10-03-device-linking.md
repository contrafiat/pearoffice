# Linking a person's devices (amends section 6)

**Goal:** let one person use PearSheet on several devices as one member, with
a recovery phrase, without @peerloom/device-link.

**Tier:** T3 (identity and key handling, a new pairing flow).

**Why not device-link:** section 6 of the wire protocol proposal named
`@peerloom/device-link`. Checked on 2026-10-03: it has no consumers (PearList
and PearPetal ship with it switched off), the piece PearSheet needs most (a
newly linked device getting write access on existing groups) is a listed gap,
and its identity comes from a recovery phrase, so every existing PearSheet
identity and sheet would have to move. Tim chose a PearSheet-native design on
2026-10-03.

## Scope

### Changes

- A new device can take on an existing device's identity through a one-time
  link (or QR code), and joins every sheet that identity is in.
- A 24-word recovery phrase for the identity, and restoring from it on a new
  install.

### Unchanged

- The sheet wire format. New devices become known in each sheet through the
  existing `admit` op (proposal changes after approval, 2026-10-03, removal).
- Roles, invites, removal and the seeder.

## 1. Identity and the recovery phrase

The identity stays @peerloom/core's Ed25519 keypair in the local Hyperbee
(`identity` → `{ publicKey, secretKey }`). Its first 32 bytes are the seed.

- **Recovery phrase:** the seed as 24 BIP39 English words (256 bits plus an
  8-bit checksum). Shown on request in the app, with a warning that anyone
  with the words is you.
- **Restore:** on an install with no sheets, the phrase gives back the seed.
  `crypto_sign_seed_keypair` gives the same keypair, which replaces the local
  identity, and the worklet restarts. Sheets come back by linking from another
  device or by the people in them sending a new invite. The phrase holds the
  identity, not the sheet keys.

Existing installs keep their identity; nothing migrates.

## 2. Linking flow

Device A already has the identity. Device B is new: it has no sheets.

1. A mints `rv` (32 random bytes) and `secret` (32 random bytes, an Ed25519
   seed). It shows
   `pearsheet://link?rv=<rv>&k=<secret>&a=<A's swarm public key>&v=1`, valid
   for 5 minutes, and joins `blake2b("pearsheet/link/v1" + rv)` as a server.
2. B joins the same topic as a client and talks only to a connection whose
   remote public key equals `a`. On channel `pearsheet/link/1` (id `rv`) it
   sends `hello { deviceKey, proof }`. `deviceKey` is B's swarm key, and
   `proof` signs `{ purpose: 'pearsheet/link/v1', rv, deviceKey }` with the
   keypair from `secret`.
3. A checks the proof against the public key from `secret`, checks that
   `deviceKey` is the connection's remote key and that the link has not
   expired or been used. It then sends
   `welcome { seed, name, sheets: [{ sheetId, groupKey, encryptionKey, bootstrap, name }], seeders: [seederKey] }`
   over the Noise-encrypted connection and marks the link used.
4. B stores the identity from `seed`, its name and its paired seeders, then
   restarts its worklet with the new identity.
5. On start, B opens each sheet with core's join path and sends its device
   proof on `pearsheet/join/1` until a writer appends `admit` for it. This is
   the same path members use after a key move. B becomes a writer where the
   identity is an owner or editor, and a reader where it is a viewer.

B refuses a link if it already has sheets. Merging two identities is out of
scope for v1.

## 3. What can go wrong

- **A leaked link or phrase hands over the identity.** The link works once,
  for 5 minutes, and the app says to open it only on your own device. The
  phrase is shown only on request, behind a warning.
- **A lost or stolen device cannot be cut off in v1.** It holds the identity
  secret, so it can sign new device proofs and be admitted again. The remedy
  is the existing removal: the owner removes that identity from each sheet,
  which moves the sheet to new keys, and the person rejoins under a fresh
  identity. This is stated in the app's device settings. A per-device key
  scheme is possible later; it needs every sheet to track devices rather than
  identities.

## Compat

- **Sheets:** no change. `admit` and `device` records already exist.
- **The link protocol:** new, only between a person's own devices.
- **Older builds:** they cannot open a `pearsheet://link` link and say so.

## Verify

- **Unit:**
  - phrase round trip;
  - restored seed gives the same public key;
  - the checksum rejects a mistyped word.
- **Testnet integration:**
  - link A to B: B ends up with the identity, every sheet and edit rights
    matching A's roles in each;
  - the owner's linked device can invite and remove;
  - a viewer's linked device stays read-only;
  - an expired link and a wrong secret are refused;
  - B with existing sheets refuses a link;
  - restore from phrase gives the same identity.
- **Two machines:** link the Linux desktop to the Android emulator, then edit
  from both.

## Rollback

Behind a setting until verified on two machines. Turning it off hides the link
and phrase screens. Devices already linked keep working, since they are
ordinary members.

## Settled

- The recovery phrase lives in settings, with a one-time reminder after the
  first sheet is created or joined (Tim, 2026-10-03).
