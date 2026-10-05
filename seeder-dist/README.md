# PearSheet seeder

An always-on helper that keeps an encrypted copy of your PearSheet sheets, so
the people in them can catch up when nobody else is online. It never gets a
sheet's key and cannot read your sheets.

## Run it

    tar xzf pearsheet-seeder-*-linux-*.tar.gz
    mv pearsheet-seeder-*-linux-* ~/pearsheet-seeder
    ~/pearsheet-seeder/pearsheet-seeder

It prints a QR code and a pairing link that work for 5 minutes. In PearSheet,
open **Seeder** and paste the link (or scan the code on a phone). Type `pair`
for a new code and `status` to see how many devices and sheets it holds.

`devices` lists the paired devices and `forget <device key>` stops accepting
one (the first 6 or more characters of the key are enough). Sheets that no
other paired device backs up are deleted after 7 days. When it runs as a
service, start it once with `--forget <device key>` instead.

## Keep it running

See the comments at the top of `pearsheet-seeder.service` for a systemd user
service. Data lives in `~/.pearsheet-seeder` unless `PEARSHEET_SEEDER_DATA`
says otherwise.

## Updates

A minute after it starts, and then once a day, it checks for a newer
release and prints a line when there is one. To install it:

    ~/pearsheet-seeder/pearsheet-seeder update

That downloads the release for this machine, checks it against its
published checksum, replaces the program and restarts the
`pearsheet-seeder` service if it is running. Your data is not touched. Set
`PEARSHEET_NO_UPDATE_CHECK=1` to turn the check off.

## What it stores

Only sheets that a device paired with this seeder has registered, plus the
other members' copies of those sheets. Anything else is refused.
