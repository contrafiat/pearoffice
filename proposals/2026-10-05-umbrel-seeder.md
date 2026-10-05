# PearSheet seeder as an Umbrel app

**Status:** approved by Tim 2026-10-05; revised the same day after the
Umbrel test (see "Network and login"), waiting for Tim.

**Goal:** install the PearSheet seeder from Tim's Umbrel app store
(`peerloom-umbrel-app-store/`) and pair it from a web page, like the PearCal
and PearCircle seeders.

**Tier:** T1 for the packaging; the dashboard login follows PearTune's
approved design (`peartune` proposal 2026-07-14-dashboard-auth). Packaging and a local dashboard. The seeder, its pairing link
and what it stores do not change, so nothing shared between devices changes.
It stays blind: the container holds the same encrypted blocks as the Linux
download.

## What gets built

| Piece | Where | What it does |
| --- | --- | --- |
| Dashboard server | `seeder-dist/umbrel/server.js` | Node HTTP server on port 8761, with a login page. Starts `bare seeder.bundle --data /data --ipc` through `desktop/seeder-process.js` (the same code the desktop app uses for "Run a seeder on this computer") and turns its four IPC methods into JSON routes. |
| Dashboard page | `seeder-dist/umbrel/index.html` | One page in the suite style: sheets held and paired devices; "Pair a device" shows the QR code and link for 5 minutes with a countdown; each device has Forget. QR drawn with `qrcode-generator`, already a dependency. Light and dark. |
| Image | `seeder-dist/umbrel/Dockerfile` | Builder stage runs `npm ci` and packs the seeder bundle for the target arch on the build machine (no emulation); runtime stage is `node:22-bookworm-slim` plus `libatomic1` (rocksdb). amd64 and arm64. Data in `/data`. |
| Build script | `scripts/build-umbrel-image.sh` | podman multi-arch build, pushed to `ghcr.io/peerloomllc/pearsheet-seeder:<version>`, as PearCircle's. `PUSH=0` builds without pushing. |
| Store entry | `peerloom-umbrel-app-store/peerloom-pearsheet-seeder/` | `umbrel-app.yml`, `docker-compose.yml` (pinned by digest), `icon.svg`. Its own PR in that repo. |

## Network and login (revised after testing on the Umbrel)

Measured 2026-10-05 on Tim's Umbrel with the real image, pairing a member
worklet from the LAN:

| Container network | Pairing |
| --- | --- |
| Docker bridge (`-p 8761:8761`), as the PearCal and PearCircle seeders | stalls, no connection in 150 s |
| `--network host` | paired in 955 ms, sheet backed up |

A device pairing with the PearSheet seeder dials in to it, and holepunching
does not survive the second NAT of Docker's bridge (PearTune measured the
same). So the app runs with `network_mode: host`.

Umbrel's app proxy cannot front a host-networked app, so the dashboard
needs its own login, as PearTune's does: `@peerloom/host/dashboard-auth`
(password, session cookie, lockout after 5 tries, refuses to listen beyond
loopback with no password). umbrelOS fills `SEEDER_PASSWORD` from
`${APP_PASSWORD}` and shows it next to the app (`deterministicPassword:
true`). Outside Umbrel, a password is made on first start and saved in the
data folder. On 127.0.0.1 no login is needed (tests, local use).

`dashboard-auth.js` currently pulls in `identity.js` (and with it hyperdht)
for one six-line helper. A small PR to `peerloom-host` moves that helper out,
so the image needs only `dashboard-auth.js` and `z32`.

## Checks

- `npm run verify` as usual, plus a new `test/umbrel-server.test.js`: start
  the server on a throwaway folder and check status, pairing link, devices and
  forget over HTTP.
- Build both arches here. Run the arm64 image under qemu and check it starts
  and serves a pairing link (the open TODO about arm64 being untested).
- Run the amd64 image on the Umbrel over SSH (`sudo docker run`) and pair the
  desktop app with it before anything is published.

## Needs Tim

- Pushing the image to ghcr.io and the app-store PR are public. I will ask
  before each.
- The store icon URL points at `peerloomllc.com/assets/`. Adding
  `icon-pearsheet-seeder.svg` there is a change to the website repo.
