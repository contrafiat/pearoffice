# Deleting sheets

**Goal:** let people free the storage a sheet uses. Anyone can remove a sheet
from their own device; the owner can delete it for everyone, including the
seeder's copy.

**Tier:** T2 (a new signed op and a new seeder request; old builds ignore both).

Tim chose both kinds on 2026-10-04. This also covers the open item from the
wire protocol proposal's changes after approval: the seeder deleting a moved
sheet's old copy after a week.

## Scope

### Changes

- **Remove from this device.** Any member. Local only.
- **Delete for everyone.** Owner only. A new `delete` op.
- **Drop requests to the seeder.** Paired devices ask the seeder to drop a
  sheet after a grace period. Used by delete for everyone and by key moves.

### Unchanged

Invites, roles, removal by key move and the existing seeder rules.

## 1. Remove from this device

1. Leave the sheet's topic and close its base.
2. Free every local core of the sheet: the writer cores, the view, the system
   core and the snapshot core, each cleared with `core.clear(0, length)`.
3. Delete the membership record, any pending join or move records and the
   snapshot pointer.
4. Remember `removed:<sheetId>` locally, so the app does not reopen it from a
   stale record.

This does not change the sheet for anyone else and sends nothing. The person
stays a member and can be invited back.

## 2. Delete for everyone

The owner appends:

    { type: 'delete', delete: signValue({ purpose: 'pearsheet/delete/v1', sheetId, by }, owner) }

`apply` accepts it only if it is signed by `sheet.owner` and appended by one of
the owner's devices. It then puts `deleted { by }` in the view. From then on
the sheet is frozen, exactly as after a `move`: no op applies.

Every device that sees `deleted`:

- removes the sheet from itself (section 1);
- keeps a local `deleted:<sheetId>` record, so the UI can say "deleted by the
  owner";
- if it is paired with a seeder listed in the sheet, sends that seeder a drop
  request with the 7-day grace period (section 3).

**Limits:**

- **No undo.** The app asks for confirmation first.
- **A modified app could keep its copy.** Deletion in a peer-to-peer app
  depends on the other devices cooperating. The confirmation says so.
- **Members offline for more than 7 days lose the delete message.** They
  never see it. Their copy stays frozen until they remove it themselves, and
  they cannot reach anyone through it anyway.

## 3. Drop requests to the seeder

A new channel, `pearsheet/seeder/1`, carries one message from a paired device
to the seeder:

    { t: 'drop', bootstrap, afterMs }

`bootstrap` names the sheet. The seeder accepts it only from a paired device
and only for a sheet on its allowed list.

The seeder records which cores belong to which sheet as they are added (the
referrer on each `add-core`). It stores `drop/<bootstrap>` with a due time and
checks hourly. When a drop is due, it clears and forgets each of those cores,
using blind-peer's own deletion steps, and removes the sheet from the allowed
list.

`afterMs` is 7 days for delete for everyone and for the old sheet after a key
move. That is long enough for offline members to sync once and see the
`deleted` or `move` record. The seeder caps it between 0 and 30 days.

**After a move:** 7 days after a device follows a move, if it is paired with
the old sheet's seeder, it sends the drop for the old bootstrap and removes the
frozen old copy from itself.

## Compat

- **Builds without this change** ignore the `delete` op (an unknown type), so
  for them the sheet stays live, and they keep syncing with each other. Every
  current build includes this change once it ships, since there are no
  releases yet.
- **Seeders without this change** never open `pearsheet/seeder/1`, so drop
  requests to them do nothing and they keep the data. Their storage is still
  bounded by what paired devices registered.

## Verify

- **Unit:** `delete` accepted only from the owner's device with the owner's
  signature; ops after it are ignored.
- **Testnet:**
  - local remove frees the cores and the sheet does not come back after a
    restart;
  - an owner delete reaches an editor and a viewer, who both remove it;
  - a forged delete from an editor is skipped;
  - the seeder drops the sheet's cores when the grace period ends (test
    clock) and refuses drops from unpaired devices;
  - after a move, the old sheet is dropped and removed locally once the
    period ends.
- **Desktop smoke:** remove a sheet from the device through the UI.

## Rollback

Hide the two menu items. Already-deleted sheets stay deleted; frozen ones stay
frozen. A seeder drop that has not run yet can be cancelled by deleting its
`drop/` record on the seeder.
