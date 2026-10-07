# Linked devices and their names

**Status:** draft, 2026-10-07. Asked for by Tim (as in PearCal and Keet);
he chose to keep the names in each file, like your name and picture.

**Goal:** a "Linked devices" list in the Devices panel: every device that
is you, which one you are on, and a name for each that you can change on
any of them.

**Tier:** T2. A new signed op and a new field in each file's view. No
change to roles, invites, linking, the join handshake or the seeder.

## What a device is

Inside a file, a device is a writer core (`device/<writerKey>`, with the
identity it belongs to), so one phone has a different writer key in every
file. Across files the same phone keeps one Hyperswarm key pair (linking
already uses it as the device's key), so the list groups by that:
`deviceKey`, the device's swarm public key.

## The op

`deviceName { sheetId, identity, deviceKey, writerKey, name, at, sig }`

- Signed by the identity (`pearoffice/device-name/v1`), like `name` and
  `avatar` (proposals/2026-10-04-profiles-with-avatars.md).
- Applied only if `writerKey` is a device of that identity in this file
  (`device/<writerKey>` names it), the name is 1 to 40 characters after
  trimming, and `at` is newer than the stored one. Stored on the device
  record: `device/<writerKey>.deviceKey`, `.name`, `.nameAt`.
- Any device of the identity may rename any other: the person owns all of
  them. The op carries the target's `deviceKey` and its `writerKey` in that
  file; a device that is not yet in a file gets the name when it is
  admitted there (the next reconcile copies it).
- Viewers' devices cannot append; as for names and pictures, a connected
  writer appends it for them (profiles.js does this already).

## Keeping it in step

profiles.js already compares this person's record with each file and
copies the newer one either way. Device names join that: localDb keeps
`devices:<deviceKey>` → `{ name, at }`; reconcile appends `deviceName` ops
where a file is older and copies newer names into localDb.

A device names itself the first time it runs this code, from its platform
("Linux computer", "Windows computer", "Mac", "Android phone", "iPhone"),
with `at` 0 so any name you choose wins.

## The list

Settings > Devices gets a "Linked devices" section above the linking
buttons:

- One row per `deviceKey` found in any of your files' device records for
  your identity, plus this device: its name, "This device" on the current
  one, and when it was last seen in any file (from presence, else blank).
- Tap a name to rename it (inline field, Enter saves, Esc cancels). The
  new name reaches your other devices with your files.
- No removing devices in this change (see open questions).

## Who sees the names

Everyone in a file can read the device records, so the names are readable
by the people you share files with, as your name is. The app shows them
only to you. Device names should not hold secrets; the rename field says
so in its placeholder ("e.g. Work laptop").

## Compat

Older builds skip an op type they do not know (sheetWire.js), so their
view has no names; they show nothing new. No file version bump; nothing is
released.

## Verify

- membership tests: a valid `deviceName` applies; a forged signature, a
  writer key of another identity, an empty or 41-character name and an
  older `at` are skipped.
- Engines over the test DHT: two linked devices; renaming on one shows on
  the other in every shared file; a viewer's rename is appended by a
  writer; a device admitted later gets the name.
- Smoke: the list shows this device, renaming works and survives a
  reopen.

## Rollback

Hide the section. Names stay in the files and are ignored.

## Open questions

1. Removing a lost device from the list (cutting it off) needs a new
   identity today (the Devices panel says so). Leave that for a later
   proposal? Recommended: yes.
