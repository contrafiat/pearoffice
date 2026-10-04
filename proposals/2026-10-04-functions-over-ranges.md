# Single-value functions over a range

**Status:** approved by Tim 2026-10-04. Follow-up to
proposals/2026-10-04-spilling-formulas.md.

**Goal:** a function that takes one value, given a range or array there,
runs once per value and spills the answers, as in Excel 365.
`=UPPER(A1:A3)` fills three cells; `=IF(B2:B9>100, "big", "small")` fills
eight; `=ROUND(C2:C9*1.2, 2)` fills eight.

**Tier:** T2. Nothing stored changes, but these formulas compute something
different: today they take the first value of the range. Old and new builds
show different values for them until the old ones update.

## Which arguments

Each function's arguments are either single-value (a number, text, a
condition) or range-taking (SUM's numbers, VLOOKUP's table, INDEX's
array). Only single-value arguments are run per value.

- A table in `src/shared/formula/lift.js` lists, per function, which
  argument positions are single-value. It starts from the catalog's
  argument names (`number`, `text`, `logical_test`, `value_if_true`,
  `serial_number`... are single-value; `array`, `range`, `ref`,
  `number1, [number2, ...]` are not) and is then corrected by hand.
- Functions with no single-value arguments (SUM, COUNT, AVERAGE, the
  statistics and the new array functions) are not in the table and do not
  change.
- Lookups lift only their lookup value: `=XLOOKUP(E2:E5, A:A, B:B)` gives
  four answers.

## How

- In the parser's function call, one new step: if the function is in the
  table and any of its single-value arguments is a block of more than one
  value, call it once per position. A single value, row or column repeats
  across the others; mismatched sizes give `#N/A` there, as the operators
  already do. Errors in one position stay in that position.
- IF, IFERROR and IFNA keep evaluating only the branch they need for a
  single value; for a block, each position picks its branch.
- The result is a block, so it spills by the existing rules.

## Compat

Formulas that give a range to a single-value argument change from "first
value" to "one answer per value", which may now spill or be blocked
(`#SPILL!`). Before shipping, run every corpus formula and list the ones
whose answer changes; none of the existing corpus cases do this on purpose.
.xlsx files from Excel 365 already expect this behaviour. Files from older
Excel that relied on implicit intersection (one value from the row the
formula is on) are not handled; they would now spill. Excel marks those with
`@` in 365, which PearSheet does not support yet.

## Verify

- `npm run verify` green.
- A lifted corpus: for every function in the table, one case with a small
  range in a single-value position, checked as a whole block against
  LibreOffice (array formulas lift there too), with Excel's answer recorded
  by hand where they differ.
- Existing formula, function and spill golden files unchanged, or each
  change listed and explained.
- Unit: IF per position does not evaluate the other branch's errors; a row
  and a column broadcast into a grid; errors stay in place.

## Rollback

Revert. Nothing stored changes.

## Changes after approval

- 2026-10-04, build: the database functions (DSUM and the rest) are not run
  per value. LibreOffice does not do it either (Err:504) and Excel's
  behaviour could not be checked, so they keep taking the first value.
- 2026-10-04, build: the parser evaluates every argument before calling a
  function, so IF has no lazy branch to keep; per position it picks the
  answer from the branch its condition chooses.
- 2026-10-04, build: the lifted corpus is generated from the function
  corpus (263 cases, each turning one literal single-value argument into a
  two-value column). All match LibreOffice 26.2, or Excel where the
  function corpus already records Excel's answer.
