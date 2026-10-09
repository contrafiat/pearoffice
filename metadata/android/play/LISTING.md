# Google Play listing for PearOffice

Everything Play asks for, ready to paste or upload. Play uploads in the suite
are done by hand in the Play Console (there are no API credentials).

## 1. Create the app

Play Console > Create app: name **PearOffice**, default language English (US),
**App**, **Free**, accept the declarations.

## 2. Store listing (Grow > Store presence > Main store listing)

- App name: PearOffice
- Short description: `short-description.txt` (80 characters)
- Full description: `full-description.txt`
- App icon: `icon-512.png`
- Feature graphic: `feature-graphic.jpg` (1024 x 500)
- Phone screenshots: `../../store/android/01-files.png` to `05-sharing.png`
- Category: Productivity. Contact email: peerloomllc@proton.me.
  Website: https://peerloomllc.com/pearoffice/

## 3. App content (Policy > App content)

- Privacy policy: https://peerloomllc.com/pearoffice/privacy
- Ads: no ads
- App access: all functionality is available without special access
- Content rating (IARC): category **Utility, Productivity, Communication or
  Other**. No violence, sexual content, language, drugs or gambling. Users
  can share content with people they invite: **yes**. Shares location: no.
  Digital purchases: no.
- Target audience: 18 and over (13 and over is also fine; not for children)
- Data safety: **No** data collected and **no** data shared. Files sync
  directly between users' devices, encrypted, and never reach PeerLoom.
  (Data in transit is encrypted.)
- Government app: no. Financial features: none. Health: no.

## 4. Release

Testing > Internal testing (or Closed testing) > Create release, upload
`dist/android/pearoffice-0.1.0.aab` (scripts/build-android-release.sh), notes
from `notes/release-0.1.0-android.md`. Use Play App Signing (the default):
the 'pearoffice' key in the shared keystore is the upload key.

A new personal developer account must run a closed test with 12 testers for
14 days before production; PearCircle used a Google Group tester list.
