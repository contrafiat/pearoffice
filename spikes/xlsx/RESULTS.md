# Spike: .xlsx import and export

Run 2026-10-03. `spike.js` writes a small workbook (values, a SUM formula, a
date) with each library, reads it back with both, under Node and Bare.

| | SheetJS CE 0.20.3 (cdn.sheetjs.com) | ExcelJS 4.4.0 (npm) |
| --- | --- | --- |
| License | Apache-2.0 | MIT |
| Formulas and cached values round-trip | yes | yes |
| Reads the other library's file | yes | yes |
| Runs under Bare | yes, using `dist/xlsx.full.min.js` | no, needs Node `stream`, `assert`, `fs` |
| Runs in a browser / WebView | yes | yes (dist bundle) |
| Writes cell styles | no (Pro only) | yes |
| Size | 0.95 MB full, 0.28 MB mini | 0.93 MB min |
| Last release | 2024 on the CDN | 2024-12; `npm audit` flags a moderate `uuid` advisory |

The npm `xlsx` package is stuck at 0.18.5, which has known security advisories
(prototype pollution, ReDoS). Never install it from npm.

## Recommendation

SheetJS CE 0.20.3, pinned as a tarball checked into the repo with its checksum,
so builds do not depend on the CDN being up. It runs in every layer we have.
v1 imports and exports values and formulas but not formatting, which matches
the "import and export, not perfect round-trips" scope. If formatting export
becomes a must, revisit ExcelJS in the UI layer only.
