# Your devices keep the same files

**Status:** approved by Tim 2026-10-07. Tim linked his Linux desktop and Pixel,
made a document on the desktop and it never appeared on the Pixel.

**Goal:** a file you make, join or are invited to on one of your devices
shows up on the others within seconds when both are online, and as soon as
they next meet otherwise.

**Tier:** T3. File keys travel between devices (only your own), over a new
channel on a new topic.

## Why it happens today

Linking (proposals/2026-10-03-device-linking.md) sends the file list once,
in the welcome. Nothing tells your devices about files made afterwards:
each device only learns of a file through its own join or create. The
other device is already you, so it would be let in automatically (the
existing `admit` path); it just never hears the file exists.

## Design

### Finding each other

All your devices hold your identity seed (linking hands it over). From it:

- topic `T = H(seed, 'pearoffice/own-devices/topic/1')` (keyed BLAKE2b),
  which only your devices can work out. Every device joins `T` as client
  and server whenever it runs.

### Proving it is you

On a connection found through `T`, a Protomux channel
`pearoffice/own-devices/1`. Each side sends
`hello { identity, device, at, sig }`, signed by the identity over both
devices' keys and the time (`pearoffice/own-devices/v1`), and closes the
channel unless the other's hello is signed by **its own** identity and is
recent. A stranger who somehow reached `T` learns nothing.

### Sharing the file list

After both hellos:

- Each sends `files [{ sheetId, groupKey, encryptionKey, bootstrap, name,
  kind }]` for every file it is in, the same entries the linking welcome
  carries (linking.js `memberships`), minus frozen copies.
- Each opens any file it does not have, exactly as a linked device does
  after its restart (linking.js `resume`: `joinGroup` with the keys), and
  the existing admission (moves.js) lets the device in as you.
- While the channel is open, a device sends `file { ... }` as soon as it
  creates, joins or follows a file to new keys (moves), so the other has it
  in seconds.

### What does not travel

- **Removing a file from one device stays local.** A file you removed on
  one device (`removed:<sheetId>`) is not added back to it by the others,
  and its removal is not pushed to them. Deleting for everyone already
  reaches every device.
- **Being removed from a file:** the file moves to new keys others hold;
  your devices only hold the frozen old copy, so nothing leaks.
- Seeders are not involved and learn nothing new.

## Risks

- A linked device you lost gets every file you make from then on, not only
  the ones you had when it was linked. It already holds your identity, so
  this widens what it reads rather than what it can do. Cutting a device
  off is the next proposal (proposals/2026-10-07-device-names.md, open
  question 1); until then the Devices panel's advice stands.
- Every device stays on one more topic, a small cost on phones; the swarm
  is already running.

## Compat

Older builds never join `T`, so a mixed pair behaves as today. No change
inside files; nothing is released.

## Verify

- Engines over the test DHT: two linked devices; a file made on one is
  listed on the other within a few seconds and can be edited there; a file
  made while the other was offline arrives when it comes back; a file
  removed on one is not re-added to it; a third device with a different
  identity on the same topic (forced in the test) gets no hello accepted
  and no files.
- Phones: the Pixel or TCL and the desktop, as Tim tried.

## Rollback

Stop joining `T`. Files already shared stay; nothing else depends on it.

## Order

1. Topic, channel, hellos, file list exchange on connect.
2. Live `file` messages on create, join and move.
3. Tests and the phone check.

## Decided 2026-10-07

1. "Remove from all my devices" is left for later.

## Open questions

None.
