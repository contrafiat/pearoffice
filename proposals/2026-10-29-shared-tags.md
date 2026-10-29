# Sharing tags with a file

**Status:** approved by Tim 2026-10-29: received tags are added without
asking, and turning sharing off leaves them with the others. A tester (TODO.md, tester feedback
2026-10-29): "where i share a document/folder to another account, that it
also gets the tag with it. for example before i send the link i can give
the right to also send over the tag i have it under. so the person also
get it, like a shopping list. maybe we both send each other shopping list
and food recommendations back and forth."

**Goal:** when you share a file, you can send your tags on it along, so the
other person finds it under the same tags without tagging it themselves.

**Tier:** T2. One new key in a file's `meta` and one new IPC method. Tags
stay personal records (proposals/2026-10-28-file-tags.md); no keys,
crypto, membership or wire format change.

## How it works

- **The file carries the shared tags.** `meta.tags` in the file's Yjs doc:
  a list of up to 20 `{ name, color }`, names up to 40 characters, colours
  from the tag set. It is inside the file, so it is encrypted with it and
  the seeder cannot read it. Everyone in the file sees it, including
  people who join later.
- **Each person still has their own tags.** When a device sees a shared
  tag on a file for the first time, it tags the file with its own tag of
  that name (ignoring case), making the tag in the shared colour if it has
  none. From then on it is an ordinary personal tag: renaming, removing or
  deleting it only affects you.
- **Once per file and name.** A device keeps the shared names it has seen
  per file (`sharedTags:<sheetId>` in localDb). A name already seen is not
  applied again, so a tag you took off the file does not come back. Your
  other devices skip a name when the file already has a tagged record for
  a tag of that name, on or off, so removing it on one device holds on the
  others.
- **Who can share:** the owner and editors (it writes the file). Viewers
  receive shared tags but cannot change them.

## Where it shows

- **Share panel:** when the file has your tags, a line under the invite:
  "Send my tags with this file" and the pills, with a switch. On writes
  your current tags on the file to `meta.tags`; off clears it. Changing
  your tags on the file later updates the shared list while the switch is
  on.
- **Tags... panel:** shared tags on the file are marked "Shared with
  everyone in this file".
- The person receiving sees the file under the tag on the file list, as if
  they had tagged it.

## Templates and moves

- A file made from a template (proposals/2026-10-18-templates.md) gets the
  template's `meta.tags` like the rest of `meta`, so its people get the
  tags. Your own tags on the template are offered as now (PR #281).
- A file that moves to fresh keys keeps `meta` and so its shared tags.

## Out of scope

- Sharing a folder. Folders are personal and cannot be shared; a shared tag
  is the way to group shared files.
- Per-invite choices: the shared tags belong to the file, the same for
  every invite.

## Compat

Older builds ignore `meta.tags`. They neither show nor apply it, and keep
it when they write the file.

## Verify

- Unit: `meta.tags` checks (count, name length, colour, duplicates by
  case), applying a shared tag to an existing tag of the same name or a new
  one, a seen name not applied again, a tagged-off record skipping it.
- Engines over the test DHT: the owner shares a tag, an editor who joins
  later gets it; the editor removes it and it stays off after a restart and
  a new shared tag; a viewer cannot share.
- Desktop smoke `tags`: the switch in Share, the pills, the mark in Tags...
- Android emulator: the switch and a received tag on the file list.
- `npm run verify`.

## Rollback

Revert the PR. `meta.tags` stays in files as an ignored key; tags already
applied stay as personal tags.

## Decided

1. A received tag is added without asking.
2. Turning sharing off does not take the tag off for the others; they keep
   it as their own.
