# The PeerLoom blind relay in PearOffice

**Status:** draft, 2026-10-08. Asked for by Tim: the StartOS seeder should
work for devices on the home network, as the PearCircle and PearCal seeders
do on the same Start9.

**Goal:** a device that cannot connect directly to a seeder or another
member (a StartOS seeder from the home network, two phones behind carrier
NAT) connects through the suite's shared blind relay instead of not at all.

**Tier:** T3. PeerLoom-operated infrastructure carries PearOffice traffic,
which the no-servers principle governs. The relay sees ciphertext and which
two keys talk, never a file or a key.

## Why the other seeders work on the Start9 and PearOffice's does not

StartOS 0.4 runs each package in an LXC container behind a second NAT
(`lxcbr0`). A device on the home network cannot holepunch through it; one
on cellular can (proposals/2026-10-05-start9-seeder.md, measured with
PearOffice's own package). PearTune measured the same and showed a forwarded
port does not help (`peartune/proposals/2026-07-29-start9-bindportrange.md`).

PearCal, PearCircle, PearList, PearPetal and PearTune all fall back to the
shared PeerLoom blind relay when a direct connection fails
(`pearcircle/DECISIONS.md` 2026-07-23, `p2p-wiki/wiki/concepts/blind-relay-off-lan-backstop.md`).
Their home devices reach the Start9 seeder through it. PearOffice never
adopted the relay, so a direct attempt that cannot succeed is all it has.

## Design

Copy `pearlist/src/relay.js` (the suite's module, kept in step with
PearTune's, the same relay key) to `src/worklet/relay.js`.

1. **Members' swarm.** `relayThrough: relay.swarmRelayThrough`, a function,
   as in PearList. Hyperswarm tries direct first and asks for the relay only
   after `HOLEPUNCH_ABORTED`, `HOLEPUNCH_DOUBLE_RANDOMIZED_NATS` or
   `REMOTE_NOT_HOLEPUNCHABLE`, or from the start when this device's own NAT
   is randomized. This covers member to member, pairing with a seeder, own
   devices and presence.
2. **Seeder connections.** Backups (`blind-peering`) and requests to a
   seeder (`seeding.js` `askOver`: drop, keep, keyring) dial with
   `dht.connect` directly, outside Hyperswarm. Given a relay key there,
   hyperdht relays from the first attempt (`hyperdht/lib/connect.js`, line
   534). So these go through a small wrapper around `dht.connect` that is
   direct first per seeder: after a holepunch failure to that seeder, the
   next connects to it pass the relay key, until a restart.
3. **The seeder** sets no relay. Only the dialling side needs it; hyperdht's
   server follows the dialler's relay token (as decided in PearCircle).
4. **A switch**, on by default, in Settings: "Connect anywhere". Off means
   strictly device to device; a device on a network that blocks the direct
   link then does not sync or back up there. Text as PearList's, with
   "files" for "lists". The choice is read before the swarm is built, so an
   opted-out device never relays (`relay.hydrate`, as in PearList).
5. **The StartOS package.** With 1 to 3 in place, pick up the on-hold
   package (`start9/seeder/`), rename it from PearSheet, build it from the
   current seeder and test it on the Start9 from the home network.

## Risks

- **Metadata at the relay:** which two keys talk and how many bytes, as for
  the other apps. Nothing readable. The switch turns it off.
- **Relay load:** only connections that fail directly use it. A home user
  with a StartOS seeder backs up through it whenever they are at home, which
  is most of the time. Backups are small and incremental, but a large file
  with pictures goes through in full once.
- **Relay down:** connections that need it fail as they do today; direct
  ones are unaffected.

## Compat

No wire change. Old and new devices and seeders work together; an old
device just never relays. Rollback is removing the option.

## Verify

- Unit: the policy (direct first, relay after a holepunch failure, never
  when switched off or not yet read), as PearList's tests; the seeder dial
  wrapper per seeder.
- `npm run verify` as usual.
- The Start9: install the package, pair the desktop on the home network
  (it stalled before), back up a file, restore a phone from its phrase on
  the same Wi-Fi. Check on the relay box that the relay carried it and
  that a direct-capable connection (the Umbrel or this computer's seeder)
  stays off the relay.

## Order

1. `relay.js`, the members' swarm and the switch.
2. The seeder dial wrapper for backups and seeder requests.
3. The StartOS package and the test on the Start9.

## Open questions

1. The switch on by default, as in every other app? Recommended: yes.
2. Its name and place: "Connect anywhere" in Settings, next to "Keep files
   online"? Recommended: yes, same words as PearList.
3. Ship the StartOS seeder to the StartOS registry once it works from the
   home network, or keep it a sideload until the first release? Recommended:
   with the first release, alongside the Umbrel app.
