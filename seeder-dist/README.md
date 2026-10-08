# PearOffice seeder

An always-on helper that keeps an encrypted copy of your PearOffice files, so
the people in them can catch up when nobody else is online. It never gets a
file's key and cannot read your files.

For 64-bit Linux on x64 or arm64. The Bare runtime and the libraries it
needs come in the download; `update` also uses `curl`.

## Run it

    tar xzf pearoffice-seeder-*-linux-*.tar.gz
    mv pearoffice-seeder-*-linux-* ~/pearoffice-seeder
    ~/pearoffice-seeder/pearoffice-seeder

It prints a QR code and a pairing link that work for 5 minutes. In PearOffice,
open **Seeder** and paste the link (or scan the code on a phone). Type `pair`
for a new code and `status` to see how many devices and files it holds.

`devices` lists the paired devices and `forget <device key>` stops accepting
one (the first 6 or more characters of the key are enough). Files that no
other paired device backs up are deleted after 7 days. When it runs as a
service, start it once with `--forget <device key>` instead.

## Keep it running

See the comments at the top of `pearoffice-seeder.service` for a systemd user
service. Data lives in `~/.pearoffice-seeder` unless `PEAROFFICE_SEEDER_DATA`
says otherwise.

A service has no keyboard, so to pair a device, restart it and read the new
link (it works for 5 minutes) from its log:

    systemctl --user restart pearoffice-seeder && journalctl --user -u pearoffice-seeder -n 40

## Updates

A minute after it starts, and then once a day, it checks for a newer
release and prints a line when there is one. To install it:

    ~/pearoffice-seeder/pearoffice-seeder update

That downloads the release for this machine, checks it against its
published checksum, replaces the program and restarts the
`pearoffice-seeder` service if it is running. Your data is not touched. Set
`PEAROFFICE_NO_UPDATE_CHECK=1` to turn the check off.

## What it stores

Only files that a device paired with this seeder has registered, plus the
other members' copies of those files, and each paired person's encrypted
file list (which their recovery phrase uses to bring their files back).
Anything else is refused. It is never given the keys to read any of it.

## Licence

MIT, see `LICENSE.txt`. `THIRD-PARTY-NOTICES.txt` and `licenses/` cover
the libraries in the download.
