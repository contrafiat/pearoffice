# Stop backing up to a seeder

**Goal:** let people stop a seeder from holding a sheet, from either end. A
member takes a seeder off a sheet or stops using it altogether; a seeder's
operator forgets a paired device. In each case the seeder wipes what it no
longer needs after the 7-day grace period.

**Tier:** T2 (a new signed op and two new seeder requests; old builds ignore
them).

Tim settled the choices on 2026-10-04: wipe after 7 days, the owner or
whoever added a seeder can take it off and the seeder side can forget a
device.

## Scope

### Changes

- **Take a seeder off a sheet.** A new `seederOff` op.
- **Stop using a seeder.** A device unpairs and takes that seeder off every
  sheet where it is allowed to.
- **Forget a device on the seeder.** The seeder's screen lists paired devices
  with a Forget button.
- **Keep requests to the seeder**, which cancel a pending drop when a seeder
  is listed again.

### Unchanged

Pairing, the `seeder` op's checks, drop requests and the drop sweep
(proposals/2026-10-04-deleting-sheets.md).

## 1. Taking a seeder off a sheet

    { type: 'seederOff', seederOff: signValue({ purpose: 'pearsheet/seeder-off/v1', sheetId, seederKey, identity }, identity) }

`apply` accepts it when the appending device belongs to `identity`, the
seeder is listed and `identity` is the owner or the person in the listing's
`addedBy`. It deletes `seeder/<key>` and puts `seederOff/<key> { by }`.

The `seeder` op works as before and also deletes `seederOff/<key>`, so a
seeder can be listed again.

**Automatic listing.** Today every device lists each seeder it is paired with
in every sheet it can edit. It now skips sheets with `seederOff/<key>`, so a
seeder taken off is not put straight back by another member's device. Listing
it again is an explicit choice in the sheet's share panel.

**Each device that sees `seederOff`:**

- stops sending that sheet to the seeder. blind-peering has no way to forget
  one base, so the device closes and recreates its blind-peering instance and
  registers its sheets again;
- if it is paired with that seeder, sends a drop request for the sheet with
  the 7-day grace period.

## 2. Stop using a seeder

In the Seeder panel, "Stop using this seeder" does, for each sheet:

- if this device's person is the owner or added the seeder: append
  `seederOff` (section 1, which sends the drop);
- otherwise leave the listing alone, since it is someone else's backup.

Then it deletes the local `seeders:<key>` record. Sheets listed by other
people keep backing up to the seeder through their devices.

## 3. Forgetting a device on the seeder

The seeder now records every paired device that registered a sheet:
`sheet/<bootstrap> { by: [deviceKey, ...] }`, where it kept only the first.

"Forget" on the seeder:

1. removes `device/<key>`, drops the key from the paired set and from
   blind-peer's trusted keys, so its requests and new sheets are refused;
2. removes the device from each sheet's `by` list;
3. schedules a 7-day drop for every sheet whose list is now empty.

Other members of a dropped sheet who are not paired lose that backup. That is
the intent: the seeder holds a sheet only for the people paired with it.

## 4. Keep requests

A new message on `pearsheet/seeder/1`:

    { t: 'keep', bootstrap }

From a paired device, it cancels a pending drop for that sheet and adds the
device to its `by` list. A device sends it when it lists a seeder it is
paired with (an explicit add, or automatic listing on a sheet without
`seederOff`). A paired device registering a sheet with a pending drop also
cancels the drop.

Without this, listing a seeder again within the week would let the drop wipe
a sheet that is in use.

## UI

- **Share panel:** a "Backed up to" list of the sheet's seeders, each with
  "Stop" for the owner and the person who added it plus "Back up to my
  seeder" when this device is paired with a seeder the sheet does not list.
- **Seeder panel (device):** "Stop using this seeder", with a confirm that
  says which sheets will stop backing up and which stay backed up by others.
- **Seeder panel (seeder running here) and the server's terminal:** paired
  devices with Forget. The server download gets a `--forget <deviceKey>`
  flag.

## Compat

- **Builds without this change** ignore `seederOff`, so they keep sending the
  sheet to the seeder. The seeder still drops it when due, then accepts it
  again from those devices if they are paired. There are no releases yet, so
  every build gets this change.
- **Seeders without this change** ignore `keep` and drop requests, and keep
  the data.

## Verify

- **Unit:** `seederOff` accepted from the owner and from the adder, refused
  from another editor and a viewer; the `seeder` op lists it again.
- **Testnet:**
  - taking a seeder off stops new data reaching it, and it drops the sheet
    at day 8 (test clock);
  - another member's device does not list it again automatically;
  - listing it again within the week sends `keep` and the drop does not run;
  - stop using a seeder takes it off the sheets this person added it to and
    leaves the others listed;
  - forgetting a device drops only the sheets no other paired device
    registered, and that device's requests are refused afterwards.
- **Desktop smoke:** take a seeder off a sheet in the share panel.

## Rollback

Hide the buttons. Listings already removed stay removed and can be added back
with the share panel's button. Pending drops can be cancelled by deleting
their `drop/` records on the seeder.

## Changes after approval

- 2026-10-04, keep requests: a device sends `keep` only when it lists a seeder
  (an explicit add, or automatic listing after pairing again), not whenever
  it registers a sheet. A device that has not yet seen a `seederOff` still
  registers the sheet for a moment, and that must not cancel the drop.
- 2026-10-04, the server download: `forget <key>` and `devices` are also
  typed commands, and `forget` takes a unique start of the key. The
  `--forget` flag forgets on start and then runs as usual.
