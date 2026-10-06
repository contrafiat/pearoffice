# Vendored: fast-formula-parser 1.0.19

MIT, by Lester Lyu (https://github.com/LesterLyu/fast-formula-parser). Copied
from the npm release because upstream has not shipped since 2023 and PearOffice
needs local changes. See `DECISIONS.md` (formula engine) and
`spikes/formula/RESULTS.md`.

Changes from upstream:

- Every `**` replaced. The `**` operator gives different low bits on different
  V8 versions and cannot be patched, unlike `Math.pow` (see
  `src/shared/formula/detmath.js`). Integer powers of constants became
  literals, squares became `x * x`, the rest became `Math.pow`.
- `grammar/diagram.js` removed (dev-only).
- `OFFSET` added to `funsNeedContextAndNoDataRetrieve` in `grammar/hooks.js`,
  so PearOffice's OFFSET (in `src/shared/formula/newer.js`) gets the reference
  itself rather than its values.

- Spilling formulas (proposals/2026-10-04-spilling-formulas.md):
  `grammar/utils.js` applies operators value by value when either side is an
  array, with Excel's broadcasting; `grammar/hooks.js` lets a reference to a
  cell holding an error return that error when arrays are allowed;
  `ROWS` and `COLUMNS` in `formulas/functions/reference.js` count arrays.

`test/formula-vendor.test.js` fails if a `**` comes back.
