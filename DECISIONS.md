# PearSheet - Decisions

Append-only, newest on top. Per Constitution §4.

## 2026-10-03 - PearSheet ships its own seeder
Tier: T2
Context: the suite-wide shared seeder proposal
(`/home/tim/peerloomllc/proposals/2026-07-21-shared-seeder.md`) is on hold.
Choice: PearSheet builds its own seeder and does not wait on that proposal.
Alternatives: wait for the shared seeder (rejected - no date, and it would block v1).
Consequences: a blind seeder runs no app engine, so it is a good first candidate
if the shared seeder proposal is revived.

## 2026-10-03 - The seeder is blind
Tier: T3
Context: with no server, a sheet only syncs while two collaborators are online
together. An always-on seeder fixes that.
Choice: the seeder stores and relays encrypted blocks only and never receives
the sheet's encryption key (holepunchto/blind-peer style).
Alternatives: a full-engine seeder that can read the data, as in PearCal and
PearCircle (rejected - sheets hold finances and other private data, and a
readable copy on a box breaks the pitch).
Consequences: the seeder cannot apply edits or evaluate formulas. Devices do all
merging and computing. The wire protocol must define what the seeder gets at
pairing and show it cannot decrypt.

## 2026-10-03 - Sheets first, docs later
Tier: T0 (product scope)
Context: a 2026-10-03 web search found partial P2P competitors for documents
(Anytype, Delta Chat editors, hobby projects) but no P2P spreadsheet with
formulas for regular users.
Choice: v1 is shared spreadsheets. Shared documents are phase 2 and absorb the
former PearNote idea.
Consequences: competitor list lives in `/home/tim/peerloomllc/APP-IDEAS.md`.

## 2026-10-03 - App name = PearSheet
Tier: T0 (branding, no wire effect)
Choice: PearSheet, kept from the APP-IDEAS placeholder. Repo
github.com/peerloomllc/pearsheet (private for now).
