# Vendored: fast-formula-parser 1.0.19

MIT, by Lester Lyu (https://github.com/LesterLyu/fast-formula-parser). Copied
from the npm release because upstream has not shipped since 2023 and PearSheet
needs local changes. See `DECISIONS.md` (formula engine) and
`spikes/formula/RESULTS.md`.

Changes from upstream:

- Every `**` replaced. The `**` operator gives different low bits on different
  V8 versions and cannot be patched, unlike `Math.pow` (see
  `src/shared/formula/detmath.js`). Integer powers of constants became
  literals, squares became `x * x`, the rest became `Math.pow`.
- `grammar/diagram.js` removed (dev-only).
- `OFFSET` added to `funsNeedContextAndNoDataRetrieve` in `grammar/hooks.js`,
  so PearSheet's OFFSET (in `src/shared/formula/newer.js`) gets the reference
  itself rather than its values.

`test/formula-vendor.test.js` fails if a `**` comes back.
