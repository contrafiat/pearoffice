# Vendored packages

## xlsx-0.20.3.tgz

SheetJS Community Edition 0.20.3 (Apache-2.0), downloaded 2026-10-03 from
https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz. Checked in so builds do
not depend on the SheetJS CDN, which is the only place current versions are
published (npm's `xlsx` is stuck at 0.18.5, which has known advisories).

    sha256  8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8

The UI uses `xlsx/dist/xlsx.mini.min.js` (about 280 KB), which covers .xlsx
and .csv with formulas and number formats. See DECISIONS.md (.xlsx library).
