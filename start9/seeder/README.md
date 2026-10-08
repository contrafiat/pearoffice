# PearOffice seeder for StartOS 0.4

A native StartOS 0.4 package of the PearOffice seeder. Devices on the same
network as the Start9 reach it through the PeerLoom blind relay, as the
other apps' seeders do (proposals/2026-10-08-blind-relay.md); first built and
put on hold on 2026-10-05 (`../../proposals/2026-10-05-start9-seeder.md`).
Tested on 2026-10-08: a desktop on the home network paired and backed up,
and an Android emulator restored a file from its phrase. To be published
with the first release.

The image is the Umbrel one. Until it is published, build it here first:
`podman build --platform linux/amd64 -t ghcr.io/peerloomllc/pearoffice-seeder:0.1.0 -f seeder-dist/umbrel/Dockerfile dist/umbrel`
(after `node scripts/stage-umbrel.js`), from the repo root.

Build: `npm install && make` (needs `start-cli-1.1.0` and a signing
workspace in `../.startos`). Install on a box the CLI is logged in to:
`start-cli-1.1.0 -H https://<box>.local package install -s pearoffice-seeder_x86_64.s9pk`.
