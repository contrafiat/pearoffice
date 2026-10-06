# PearOffice

Private, peer-to-peer shared spreadsheets. No accounts, no servers, no cloud.
Share a sheet with family or a small team and edit it together, device to
device. Shared documents are planned as a later phase.

Part of the [PeerLoom](https://peerloomllc.com) suite of account-free P2P apps.

## Status

Pre-scaffold. No wire protocol or code yet. See [`DECISIONS.md`](DECISIONS.md)
for the decisions made so far.

## Why P2P

Excel, Google Sheets, Proton, Collabora and OnlyOffice all share and co-edit
through a server. PearOffice syncs edits directly between the people sharing a
sheet. An optional blind seeder (an always-on device you own) keeps an
encrypted copy so collaborators do not need to be online at the same time, and
it cannot read the sheets it holds.
