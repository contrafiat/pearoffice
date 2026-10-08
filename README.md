# PearOffice

**Spreadsheets, documents and slides you share and edit together, device to device.**

PearOffice is an office app with no accounts, no servers and no cloud. You
make a file and send a link to the few people who should have it, then
everyone edits it live. The file lives only on your devices and theirs,
and no company holds a copy.

Part of the [PeerLoom](https://peerloomllc.com) suite of account-free,
peer-to-peer apps.

Status: before the first release. Downloads will be on
[pearoffice-releases](https://github.com/peerloomllc/pearoffice-releases)
once it is published. The phone apps are not in the app stores yet.

---

## Features

- **Spreadsheets** - formulas (around 400 functions, including XLOOKUP,
  FILTER and other spilling formulas), charts, filters, comments, cell
  formats, colour rules, data validation and named ranges
- **Documents** - headings, lists, tables, pictures, links and an outline
- **Slides** - layouts, text boxes, shapes, pictures, charts and four themes;
  present full screen, with a presenter view on a second display
- **Live together** - see who else has a file open and where they are in it
- **Sharing by link** - each invite link works once and expires after 24
  hours. People join as editors or viewers, and the owner can remove them
- **Import and export** - .xlsx, .csv and .json for spreadsheets, .docx,
  Markdown, text and HTML for documents, .pptx for slides, and PDF for all
  three
- **Your devices together** - link your phone and computers once and they
  keep the same files
- **Recovery phrase** - 12 words bring your identity back on a new device,
  and your files too if you use a seeder
- **No accounts** - your identity is a key pair made on your device, not an
  email address or phone number
- **Optional seeder** - an always-on device you own keeps an encrypted copy
  so people can catch up when nobody else is online. It cannot read your
  files

Desktop: Linux, macOS (Apple silicon and Intel) and Windows. Phones: Android
and iOS, including iPad.

---

## How it works

PearOffice is built on [Holepunch](https://holepunch.to)'s peer-to-peer
stack (Hypercore, Autobase and Hyperswarm), the same as the other PeerLoom
apps.

### No central server

Excel, Google Docs, Proton, Collabora and OnlyOffice all share and co-edit
through a server. PearOffice sends each edit straight to the other devices in
the file. Every device merges the edits in the same way, so everyone ends up
with the same file whatever order the edits arrive in.

### Encrypted

Each file has its own key, held only by its members. Everything sent between
devices is encrypted, and so is everything a seeder stores.

### Optional blind seeder

A seeder is a device you leave running: a home server, a Start9 or Umbrel,
or your own computer. It stores your files' encrypted data and passes it on,
so a file stays reachable while everyone's phones are asleep. It is never
given a file's key, so it cannot read what it holds. Ways to run one:

- **On your computer** - in the desktop app, Settings > Seeder > Run this
  computer as a seeder
- **On a Linux server** - the `pearoffice-seeder` download (x64 and arm64);
  see [seeder-dist/README.md](seeder-dist/README.md)
- **On Umbrel or StartOS** - a packaged app with a web dashboard

You pair a device with a seeder by scanning its QR code or pasting its link.

### The connection relay

Some networks stop two devices from connecting directly. When that happens,
PearOffice can fall back to a relay that PeerLoom runs. It passes encrypted
data along, cannot read your files and stores nothing. It sees only that two
devices are talking and how much data went by. **Connect anywhere** in
Settings turns it off.

---

## Privacy

- No accounts or sign-up
- No analytics, tracking or telemetry
- Your files are stored only on your devices, your collaborators' devices and
  any seeders you choose
- The desktop app checks GitHub once an hour for a new version. That request
  carries nothing about you or your files
- Android leaves your files and keys out of Google's cloud backup

---

## Known limitations

- **Someone has to be online.** Edits reach others when both devices are
  online at once, or through a seeder
- **Keep your recovery phrase.** There is no account to reset. If you lose
  every device and the phrase, your identity is gone, and so are files nobody
  else shares with you
- **Office files are converted, not copied exactly.** Imports and exports of
  .xlsx, .docx and .pptx keep the content but can lose some formatting.
  Word and PowerPoint imports tell you what they left out
- **Phones edit slides lightly.** On a phone you can edit text, speaker notes
  and slide order. Tablets and computers have the full slide editor
- **Windows shows a warning on install.** The Windows installer is not
  signed. Choose More info, then Run anyway

---

## Building from source

Needs Node.js 22.

```
npm install && npm install --prefix desktop && npm run desktop
```

`npm run verify` runs the tests and the desktop smoke test.
`npm run dist:linux` builds the Linux installers and `npm run dist:seeder`
the seeder download. The macOS, Windows, Android and iOS builds are
described in [CLAUDE.md](CLAUDE.md).

---

## License

[MIT](LICENSE) © 2026 PeerLoom LLC. The desktop app and the seeder downloads
include `THIRD-PARTY-NOTICES.txt` with the licences of the libraries they
bundle.

---

## Feedback and bug reports

Please open an [issue](../../issues). Include your device, its system
version and what happened.
