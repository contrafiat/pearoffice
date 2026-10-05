# PearSheet seeder for StartOS 0.4: on hold

**Status:** on hold (Tim, 2026-10-05). Tested, not shipped.

**Goal:** the PearSheet seeder as a native StartOS 0.4 package (not the
legacy 0.3.5 format), like the Umbrel app.

## What was built

`start9/seeder/` is a native StartOS 0.4 package (`@start9labs/start-sdk`
2.0.9), adapted from PearTune's `start9/probe-04`. It runs the public
`ghcr.io/peerloomllc/pearsheet-seeder:0.1.0` image (the Umbrel app's), binds
the dashboard on 8761 as an http interface and has a "Show password" action
that reads the dashboard password from the data volume. `make` in that
folder builds `pearsheet-seeder_x86_64.s9pk` (82 MB) with the 0.4 CLI
(`start-cli-1.1.0`) and the signing workspace in `start9/.startos`
(gitignored, copied from `~/.start9-workspace/.startos`).

## What was measured

On Tim's Start9 (StartOS 0.4.0.1), the package installed by sideload and
the seeder and dashboard came up (dashboard on the box's https port).

| Device | Pairing |
| --- | --- |
| Desktop on the same LAN (`pairtest`, a member worklet) | stalled, nothing in 180 s |
| Pixel on cellular (Google Fi, Wi-Fi off) | paired in about 1 s and backed up a sheet |

The same split as PearCircle's seeder on this box. StartOS 0.4 runs every
package in an LXC container on `lxcbr0`, a second NAT the package cannot
leave (no host networking in the SDK). A device on the home network cannot
holepunch through it; one on cellular can. PearTune measured the same in
`peartune/proposals/2026-07-29-start9-bindportrange.md`: a forwarded port
lets packets in, but outbound UDP does not keep its port, so holepunching
still fails and only a relay carries the traffic.

So on StartOS a home user's devices could only back up while away from
home. Not worth shipping.

## What would fix it

- **The home network:** have the seeder tell devices on the LAN to use the
  box's own address and a port StartOS forwards into the package
  (`bindPortRange`). Incoming packets do arrive that way. Needs a change to
  what the seeder announces, inside hyperdht; uncertain, needs a proposal.
- **A relay** for PearSheet, which fixes this and any other network where
  holepunching fails. A bigger decision.

Until one of those, the Umbrel app, "Run a seeder on this computer" and the
Linux download are the always-on seeders.
