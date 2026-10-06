// Which arguments of which functions take a single value, so a range there
// runs the function once per value (proposals/2026-10-04-functions-over-ranges.md):
// =UPPER(A1:A3) fills three cells, as in Excel 365.
//
// Built from the catalog's argument names, then corrected by hand. A name in
// RANGE_ARGS takes a whole range; so does every argument from a `...` list on
// (SUM's number1, number2 and so on are totalled, not run per value).
// Everything else is single-value.

const { FUNCTIONS } = require('./catalog')

const RANGE_ARGS = new Set(['array', 'range', 'ref', 'reference', 'values', 'criteria_range', 'database', 'known_ys', 'known_xs',
  'holidays', 'lookup_array', 'array_x', 'array_y', 'average_range', 'new_xs', 'table_array', 'sum_range', 'vector', 'dates',
  'actual_range', 'expected_range', 'data_array', 'bins_array', 'lookup_vector', 'result_vector', 'max_range', 'min_range',
  'x_range', 'prob_range', 'coefficients', 'by_array', 'return_array', 'include', 'if_empty', 'lambda', 'field'])

// Functions that are never run per value: they take references, return
// arrays themselves, or total their arguments whatever their names say.
const NEVER = new Set(['ROW', 'ROWS', 'COLUMN', 'COLUMNS', 'INDEX', 'OFFSET', 'INDIRECT', 'AREAS', 'ANCHORARRAY', 'ISREF',
  'ISFORMULA', 'FORMULATEXT', 'CELL', 'INFO', 'NOW', 'TODAY', 'RAND', 'RANDBETWEEN', 'RANDARRAY', 'AND', 'OR', 'XOR',
  'CONCAT', 'TEXTJOIN', 'CHOOSE', 'IFS', 'SWITCH', 'TRANSPOSE', 'MMULT', 'MINVERSE', 'MDETERM', 'MUNIT', 'FREQUENCY',
  'LINEST', 'LOGEST', 'TREND', 'GROWTH', 'SUMPRODUCT', 'SERIESSUM', 'AGGREGATE', 'SUBTOTAL', 'N', 'T',
  'FILTER', 'SORT', 'SORTBY', 'UNIQUE', 'SEQUENCE', 'TEXTSPLIT', 'TAKE', 'DROP', 'VSTACK', 'HSTACK', 'TOCOL', 'TOROW',
  'CHOOSEROWS', 'CHOOSECOLS', 'WRAPROWS', 'WRAPCOLS', 'EXPAND', 'XLOOKUP', 'XMATCH',
  // The database functions: LibreOffice does not run them per value either.
  'DSUM', 'DAVERAGE', 'DCOUNT', 'DCOUNTA', 'DGET', 'DMAX', 'DMIN', 'DPRODUCT', 'DSTDEV', 'DSTDEVP', 'DVAR', 'DVARP'])

// Corrections where a name alone gives the wrong answer: positions (0-based)
// that are single-value.
const BY_HAND = {
  // Only the value looked up; the search and return ranges stay whole.
  XLOOKUP: [0, 3, 4, 5],
  XMATCH: [0, 2, 3],
  CHOOSE: [0],
  // SUMIF/COUNTIF-style: only the criteria.
  SUMIF: [1], AVERAGEIF: [1], COUNTIF: [1]
}

function buildTable () {
  const table = {}
  for (const f of FUNCTIONS) {
    if (NEVER.has(f.name) && !(f.name in BY_HAND)) continue
    if (f.name in BY_HAND) { table[f.name] = BY_HAND[f.name]; continue }
    const args = (f.args || '').split(/,\s*/).filter(Boolean)
    const out = []
    for (let i = 0; i < args.length; i++) {
      const a = args[i]
      if (a.includes('...')) break // the rest are a list
      const name = a.replace(/[[\]]/g, '').replace(/\d+$/, '').trim()
      // number1, [number2]: a list written out without the dots
      if (/\d$/.test(a.replace(/[[\]]/g, '').trim()) && args.slice(i + 1).some((b) => b.includes('...'))) break
      if (!RANGE_ARGS.has(name)) out.push(i)
    }
    if (out.length) table[f.name] = out
  }
  return table
}

const LIFT = buildTable()

module.exports = { LIFT }
