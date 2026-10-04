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

## Keep it running

See the comments at the top of `pearsheet-seeder.service` for a systemd user
service. Data lives in `~/.pearsheet-seeder` unless `PEARSHEET_SEEDER_DATA`
says otherwise.

## What it stores

Only sheets that a device paired with this seeder has registered, plus the
other members' copies of those sheets. Anything else is refused.
