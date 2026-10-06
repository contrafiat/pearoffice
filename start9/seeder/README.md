# PearOffice seeder for StartOS 0.4 (on hold)

A native StartOS 0.4 package of the PearOffice seeder. Built and tested on
2026-10-05, not shipped: devices on the same network as the Start9 cannot
reach it. See `../../proposals/2026-10-05-start9-seeder.md`.

Build: `npm install && make` (needs `start-cli-1.1.0` and a signing
workspace in `../.startos`). Install on a box the CLI is logged in to:
`start-cli-1.1.0 -H https://<box>.local package install -s pearoffice-seeder_x86_64.s9pk`.
