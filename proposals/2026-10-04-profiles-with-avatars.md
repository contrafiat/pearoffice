# Profiles with avatars

**Status:** approved by Tim 2026-10-04 with the recommended answer to each
open question: pictures inside the sheet, viewers change theirs through a
writer, 128 x 128 with a 16 KB cap.

**Goal:** a profile picture next to your name, as in the other suite apps.
The people you share a sheet with see it in the share panel and member
lists. Later items (the owner badge in the sheet list, avatars in the
toolbar) build on it.

**Tier:** T2. A new signed op and two new view keys in every sheet, plus a
new message on the join channel. Old builds ignore the op and the message, so old and
new peers still talk; old builds simply show no pictures.

## Scope

### Changes

- **An `avatar` op** in each sheet, carrying a small picture.
- **Viewers can update their name and picture** by handing a signed op to a
  writer, who appends it for them. Today viewers keep the name they joined
  with.
- **Linked devices pick up a rename or a new picture** made on another of
  the person's devices.
- **UI:** pick, change or remove a picture next to "Your name"; show
  avatars, or initials when there is none, in the share panel.

### Unchanged

The join handshake, invites, roles, removal by key move, the seeder and its
pairing. The `member/<identity>` record keeps its fields and gains one.

## 1. Where the picture lives

Inside the sheet's own encrypted Autobase, as an op. Not in a separate blob
store.

PearList and PearPetal keep the bytes in a per-device Hyperblobs core and
put only a `{ key, id }` reference on the member row. That does not fit
PearSheet:

- A Hyperblobs core is not encrypted with the sheet key, and the blind
  seeder never holds it. A picture would only load while its owner is
  online, which breaks the "a member can catch up from the seeder alone"
  promise for pictures.
- The sheet's Autobase is already encrypted and already held by the
  seeder, blind. A picture in it travels the same way as every edit.

The cost is size, so the picture is kept small: the UI crops it square,
scales it to 128 x 128 and encodes JPEG at quality 0.8, which is about
5 to 10 KB. `apply` refuses anything over 16 KB of image data. Every
sheet you are in holds one copy per change of picture, so ten sheets and
five changes is about 0.5 MB in total, spread over those sheets.

JPEG everywhere: WKWebView cannot encode WebP and falls back to a much
larger PNG (found in PearList). Drawing through a canvas also drops EXIF,
location included.

## 2. The op

    { type: 'avatar', avatar: signValue({ purpose: 'pearsheet/avatar/v1', sheetId, identity, data, mime, hash, n }, identity) }

- `data`: base64 JPEG or PNG, or empty to remove the picture.
- `mime`: `image/jpeg` or `image/png`.
- `hash`: blake2b-256 of the bytes, hex. Lets the UI cache by content and
  lets a device skip appending a picture the sheet already has.
- `n`: version counter, as for the `name` op, so an old signed picture
  cannot be appended again to bring it back.

`apply` accepts it when:

- the signature is good and `sheetId` matches;
- `identity` is a member;
- `n` is the member's `avatarN + 1` (0 when unset);
- `data` decodes to at most 16 KB, starts with the JPEG or PNG magic bytes
  and matches `hash`.

It then writes:

    avatar/<identity>   { data, mime, hash }        (deleted when data is empty)
    member/<identity>   { ...member, avatarHash: hash or null, avatarN: n }

The bytes live under their own key so the member list stays small. The UI
fetches a picture by identity only when it is not already cached by hash.

## 3. Who may append it, and the change for viewers

Today `apply` takes a `name` op only from a device of the person renaming.
Viewers cannot append at all, so they keep the name they joined with.

New rule, for both `name` and `avatar`: **any writer device may append it**,
because the signature already proves the person wrote it and `n` stops
replays. Nobody can change someone else's name or picture without their
identity key.

A viewer's device sends its signed op on the existing join channel
(`pearsheet/join/1`) to every connected member device:

    { t: 'profile', sheetId, op }

A writer device that receives it checks the signature, that the signer is a
member and that `n` is next, then appends it. If two writers both append
it, the second is skipped as stale. The viewer resends on each new
connection until its member record shows the new `n`.

Editors and owners keep appending their own ops directly.

**Mixed versions.** An old build still applies the old `name` rule, so it
skips a viewer's rename appended by someone else. That old device keeps
showing the viewer's old name until it updates. Membership checks never
read names or pictures, so nothing else depends on it.

## 4. Linked devices

All of a person's linked devices share one identity, so every sheet already
has one member record for them. What goes stale is each device's own copy
of the profile in `localDb`: a rename on the laptop does not reach the
phone's copy, and the phone uses the old name for the next sheet it creates
or joins.

Fix: when a device sees its own `member/<identity>` record with a higher
`n` or `avatarN` than its local profile records, it copies the name or
picture into `localDb`. No new sync path is needed, because linked devices
already share every sheet.

The linking `welcome` message already carries the name. It also gains the
picture (`avatar: { data, mime, hash }`), so a newly linked device starts
with it. An older device sending the welcome omits it; the new device then
picks it up from its first sheet.

## 5. Setting a picture

`app:setAvatar { data, mime }` (or `{ data: '' }` to remove) saves it in
`localDb` `profile` and appends an `avatar` op to every sheet where the
picture differs: directly where this device is a writer, through the relay
in section 3 where it is a viewer.

New sheets and joins: once a device can append to a sheet it has just
created or joined, it appends its picture there if it has one. A viewer
relays it.

## UI

- **Your name** (sidebar today, Settings later): a round picture or
  initials, with "Add a photo" / "Change photo" / "Remove photo". The UI
  crops and scales before calling the worklet.
- **Share panel:** each person's picture or initials before their name.
- **Initials:** first letter of the first two words of the name, on a
  colour picked from the identity, so the same person has the same colour
  on every device.
- `sheet:members` gains `avatarHash` per person; a new
  `sheet:avatar { sheetId, identity }` returns `{ data, mime, hash }`.

## Compat

- Old build, new op: unknown op types are skipped, so old builds show no
  pictures. They keep working.
- Old build, viewer rename appended by a writer: skipped there (section 3).
- Old build, new join-channel message: ignored (older builds drop message
  types they do not know), so a viewer's change waits for a newer writer.
- The seeder needs no change. It stores encrypted blocks as before.

## Verify

- `npm run verify` green.
- Unit: a signed `avatar` op is applied; one over 16 KB, with a wrong hash,
  a bad signature, a stale `n` or for a non-member is skipped.
- Unit: an editor appends a viewer's signed rename and picture, and the
  viewer's name and picture change on every device. A forged one (signed by
  someone else) is skipped.
- Unit: a picture set on one engine reaches a member who syncs only from
  the seeder.
- Unit: a linked device copies a rename and a picture from its own member
  record.
- Desktop smoke: set a picture, see it in the share panel.
- Emulator (Android) and Simulator (iOS): pick a picture from the photo
  library; check the WebView file picker opens and returns.

## Rollback

Revert the UI and the `avatar` handling. Pictures already appended stay in
each log as unused `avatar/` keys, and member records keep an unused
`avatarHash`. Nothing reads them, and no other rule changes. The relaxed
`name` rule can stay or be reverted on its own.

## Changes after approval

- 2026-10-04, build: a viewer's change travels as a `profile` message on the
  join channel, which already carries `device` messages for the same
  purpose, instead of on a new `pearsheet/profile/1` channel. Older builds
  ignore message types they do not know.
- 2026-10-04, build: `name` and `avatar` ops carry `at`, the time the person
  made the change, and `apply` stores it on the member record (`nameAt`,
  `avatarAt`). A device copies its own member record into `localDb` only
  when the record's time is later than its own copy's, and pushes its own
  copy only when that is later. Without the times, a linked device with an
  old name could push it back over a newer one. A device with no name or
  picture of its own (restored from the recovery phrase) takes the record's.
- 2026-10-04, build: the UI shrinks a picture through a `data:` URL, since the
  page's content policy allows no `blob:` images.
