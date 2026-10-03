# Spike: formula engine

Run 2026-10-03 on the Linux dev box, under Node 22 (V8 12.4) and Bare 1.34.1
(V8 14.8), in four timezones (UTC, America/Los_Angeles, Pacific/Kiritimati,
Asia/Kolkata).

`spike.js` evaluates a 52-formula corpus (maths, text, lookups, dates,
financial, errors, a cycle, volatile functions) through a small recalc engine
(memoized evaluation, cycle detection) with each candidate, building the sheet
and visiting cells in a shuffled order per run. `score.py` compares results
with what Excel returns.

## Candidates

| Engine | License | Result |
| --- | --- | --- |
| HyperFormula 3.4 | GPL-3.0 or paid | Not tested. GPL is not compatible with shipping an MIT app through the app stores. Paid licence is an option if the plan below fails. |
| IronCalc 0.8 | MIT/Apache | Not tested. Rust compiled to WebAssembly, same iOS problem as Automerge. |
| hot-formula-parser 4.0 (uses formulajs) | MIT | 41/50 match Excel. Wrong MOD, ATAN2, ROUND; no VLOOKUP, DATEDIF, TEXT. **Date results change with the device timezone.** |
| fast-formula-parser 1.0.19 | MIT | 42/50. Claims 280 functions but MAX, MIN, UPPER, MATCH, SUMIFS, COUNTIFS, STDEV and the financial functions are empty stubs. COUNTIF counts text. Dates are timezone-stable. Last release 2023. |
| **fast-formula-parser + formulajs fills** | MIT + MIT | **50/50.** Same results in every timezone and visiting order. |

## Determinism findings

1. **Edit order never changed a result** (shuffled insert and visit orders).
2. **formulajs date functions use local time.** In Los Angeles, `DAY` of
   2024-02-29 returns 28 and `EOMONTH` is off by a month. Never take date
   functions from formulajs.
3. **`Math.pow`, `Math.sin` and `Math.cos` differ in the last bits between V8
   12.4 and V8 14.8.** Desktop (Electron), phones (BareKit) and future app
   versions will run different V8s. `RATE` differed in the 13th digit because
   of this. Replacing those three with pure-JS fdlibm ports
   (`@stdlib/math-base-special-pow|sin|cos`, Apache-2.0) made Node and Bare
   bit-identical across the whole corpus. 13 other Math functions already
   matched.
4. **The `**` operator differs too and cannot be patched.** fast-formula-parser
   uses it for the `^` operator and `POWER` (`operators.js:153`,
   `math.js:443`) and a few other places. The vendored copy must replace it.
5. formulajs uses `localeCompare` in its lookup functions, which sorts by the
   device language. Replace with a fixed comparison.
6. `NOW`, `TODAY`, `RAND` and `RANDBETWEEN` cannot match across devices.

## Recommendation

Vendor fast-formula-parser into the repo (MIT, unmaintained, so own the code),
and:

- fill the stubbed functions from `@formulajs/formulajs`, never its date ones;
- replace every `**` and every `Math.pow/sin/cos` with the deterministic ports,
  and lint against them;
- replace `localeCompare` with a fixed comparison;
- treat `NOW`, `TODAY`, `RAND`, `RANDBETWEEN` as device-local and say so in
  the UI;
- show numbers rounded to 15 significant digits, as Excel does;
- keep this corpus as a golden-file test that runs under both Node and Bare.

Throughput: a 2000-cell dependency chain recalculates in about 20 ms under Bare.

## Re-run

```
npm install && chmod +x node_modules/bare-runtime-linux-x64/bin/bare
TZ=UTC node spike.js 1 --det > nd.json && python3 score.py nd.json
npx bare-pack --host linux-x64 --offload-addons --imports bare-imports.js -o pack/spike.bundle spike.js
TZ=America/Los_Angeles node_modules/bare-runtime-linux-x64/bin/bare pack/spike.bundle 4 --det > bd.json
```
