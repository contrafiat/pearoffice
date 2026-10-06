// Functions fast-formula-parser lists but ships as empty stubs (or gets
// wrong), filled from @formulajs/formulajs. Never take date functions from
// formulajs: they use the device's local timezone, so two people in different
// timezones would see different answers. See spikes/formula/RESULTS.md.

const formulajs = require('@formulajs/formulajs')
const FormulaError = require('./vendor/fast-formula-parser/formulas/error')
const { FormulaHelpers: H, Criteria } = require('./vendor/fast-formula-parser/formulas/helpers')
const { Infix } = require('./vendor/fast-formula-parser/formulas/operators')
const engineering = require('./vendor/fast-formula-parser/formulas/functions/engineering')
const { newerFunctions } = require('./newer')
const { arrayFunctions } = require('./arrays')

// formulajs returns lists flat; the parser wants rows of cells.
function column (impl) {
  return (...args) => {
    const r = impl(...args)
    return Array.isArray(r) && !Array.isArray(r[0]) ? r.map((v) => [v]) : r
  }
}
function row (impl) {
  return (...args) => {
    const r = impl(...args)
    return Array.isArray(r) && !Array.isArray(r[0]) ? [r] : r
  }
}

// Excel's ...A functions ignore empty cells in a range (formulajs counts
// them as 0).
function skipEmpty (impl) {
  const clean = (a) => Array.isArray(a) ? a.map(clean).flat().filter((v) => v !== null && v !== undefined && v !== '') : a
  return (...args) => impl(...args.map(clean))
}

// name -> formulajs implementation
const FILLS = {
  COUNTIF: formulajs.COUNTIF, // upstream counts text against numeric criteria
  COUNTIFS: formulajs.COUNTIFS,
  SUMIFS: formulajs.SUMIFS,
  AVERAGEIFS: formulajs.AVERAGEIFS,
  MAX: formulajs.MAX,
  MIN: formulajs.MIN,
  MAXIFS: formulajs.MAXIFS,
  MINIFS: formulajs.MINIFS,
  UPPER: formulajs.UPPER,
  TEXTJOIN: formulajs.TEXTJOIN,
  STDEV: formulajs.STDEV.S,
  'STDEV.S': formulajs.STDEV.S,
  'STDEV.P': formulajs.STDEV.P,
  VAR: formulajs.VAR.S,
  'VAR.S': formulajs.VAR.S,
  'VAR.P': formulajs.VAR.P,
  PMT: formulajs.PMT,
  IPMT: formulajs.IPMT,
  PPMT: formulajs.PPMT,
  FV: formulajs.FV,
  PV: formulajs.PV,
  NPV: formulajs.NPV,
  NPER: formulajs.NPER,
  RATE: formulajs.RATE,
  IRR: formulajs.IRR,

  // Empty stubs upstream (found by test/fixtures/function-corpus.js,
  // 2026-10-04): every one of these returned #ERROR!.
  SWITCH: formulajs.SWITCH,
  SUBSTITUTE: formulajs.SUBSTITUTE,
  SUBTOTAL: formulajs.SUBTOTAL,
  AGGREGATE: formulajs.AGGREGATE,
  FREQUENCY: column(formulajs.FREQUENCY),
  LARGE: formulajs.LARGE,
  SMALL: formulajs.SMALL,
  MEDIAN: formulajs.MEDIAN,
  MAXA: skipEmpty(formulajs.MAXA),
  MINA: skipEmpty(formulajs.MINA),
  PERMUT: formulajs.PERMUT,
  PERMUTATIONA: formulajs.PERMUTATIONA,
  LINEST: row(formulajs.LINEST),
  TREND: column(formulajs.TREND),
  'MODE.MULT': column(formulajs.MODE.MULT),
  'MODE.SNGL': formulajs.MODE.SNGL,
  PEARSON: formulajs.PEARSON,
  RSQ: formulajs.RSQ,
  SLOPE: formulajs.SLOPE,
  STEYX: formulajs.STEYX,
  'PERCENTILE.EXC': formulajs.PERCENTILE.EXC,
  'PERCENTILE.INC': formulajs.PERCENTILE.INC,
  'PERCENTRANK.EXC': formulajs.PERCENTRANK.EXC,
  'PERCENTRANK.INC': formulajs.PERCENTRANK.INC,
  PROB: formulajs.PROB,
  'QUARTILE.EXC': formulajs.QUARTILE.EXC,
  'QUARTILE.INC': formulajs.QUARTILE.INC,
  'RANK.AVG': formulajs.RANK.AVG,
  'RANK.EQ': formulajs.RANK.EQ,
  SKEW: formulajs.SKEW,
  'SKEW.P': formulajs.SKEW.P,
  STDEVA: skipEmpty(formulajs.STDEVA),
  STDEVPA: skipEmpty(formulajs.STDEVPA),
  VARA: skipEmpty(formulajs.VARA),
  VARPA: skipEmpty(formulajs.VARPA),
  TRIMMEAN: formulajs.TRIMMEAN,
  'Z.TEST': formulajs.Z.TEST,

  // Wrong answers upstream: SEARCH was case-sensitive, TRIM kept inner
  // runs of spaces, TRUNC ignored its digits, AVERAGEA skipped TRUE.
  TRIM: formulajs.TRIM,
  TRUNC: formulajs.TRUNC,
  AVERAGEA: skipEmpty(formulajs.AVERAGEA),

  // Not in fast-formula-parser at all.
  COUNTA: formulajs.COUNTA,
  COUNTBLANK: formulajs.COUNTBLANK,
  ISODD: formulajs.ISODD,
  VALUE: formulajs.VALUE,
  LOOKUP: formulajs.LOOKUP,
  SLN: formulajs.SLN,
  SYD: formulajs.SYD,
  DB: formulajs.DB,
  DDB: formulajs.DDB,
  EFFECT: formulajs.EFFECT,
  NOMINAL: formulajs.NOMINAL,
  CUMIPMT: formulajs.CUMIPMT,
  CUMPRINC: formulajs.CUMPRINC,
  MIRR: formulajs.MIRR
}

// --- functions written here ----------------------------------------------

const flatNumbers = (a) => [].concat(...[].concat(a).map((r) => [].concat(r))).filter((v) => typeof v === 'number')

// The parser hands CHOOSE a context first (it is one of its special cases).
function CHOOSE (context, index, ...values) {
  const i = Math.trunc(Number(unwrap(index)))
  if (!(i >= 1 && i <= values.length)) throw FormulaError.VALUE
  return unwrap(values[i - 1])
}

// Also special: gets the context and unresolved references, like upstream
// SUMIF. Averages the tested range when no average range is given.
function AVERAGEIF (context, range, criteria, averageRange) {
  const ranges = H.retrieveRanges(context, range, averageRange)
  const tested = ranges[0]
  const values = ranges[1]
  criteria = H.retrieveArg(context, criteria)
  const isArray = criteria.isArray
  criteria = Criteria.parse(H.accept(criteria))
  let sum = 0
  let n = 0
  tested.forEach((r, i) => r.forEach((v, j) => {
    const x = values[i] && values[i][j]
    if (typeof x !== 'number') return
    const hit = criteria.op === 'wc' ? criteria.match === criteria.value.test(v) : Infix.compareOp(v, criteria.op, criteria.value, Array.isArray(v), isArray)
    if (hit) { sum += x; n++ }
  }))
  if (n === 0) throw FormulaError.DIV0
  return sum / n
}

// Case-insensitive, with Excel's * ? ~ wildcards.
function SEARCH (find, within, start) {
  find = String(unwrap(find))
  within = String(unwrap(within))
  start = start === undefined || unwrap(start) === undefined ? 1 : Math.trunc(Number(unwrap(start)))
  if (!(start >= 1 && start <= within.length + 1)) throw FormulaError.VALUE
  const src = wildcard(find).source.slice(1, -1) // unanchored
  const re = new RegExp(src, 'i')
  const m = re.exec(within.slice(start - 1))
  if (!m) throw FormulaError.VALUE
  return m.index + start
}

// LOGEST as Excel does it: a straight line through ln(y). formulajs rounds
// its answer to 6 digits.
function LOGEST (knownY, knownX) {
  const y = flatNumbers(unwrap(knownY))
  const x = knownX === undefined ? y.map((_, i) => i + 1) : flatNumbers(unwrap(knownX))
  if (y.length !== x.length || y.length < 2 || y.some((v) => v <= 0)) throw FormulaError.NUM
  const ly = y.map(Math.log)
  const n = x.length
  const mx = x.reduce((a, b) => a + b, 0) / n
  const my = ly.reduce((a, b) => a + b, 0) / n
  let sxy = 0
  let sxx = 0
  for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (ly[i] - my); sxx += (x[i] - mx) * (x[i] - mx) }
  if (sxx === 0) throw FormulaError.DIV0
  const slope = sxy / sxx
  return [[Math.exp(slope), Math.exp(my - slope * mx)]]
}

// T.TEST: type 1 paired, 2 equal variance, 3 unequal variance (Welch).
// formulajs ignores the type.
function TTEST (a, b, tails, type) {
  const x = flatNumbers(unwrap(a))
  const y = flatNumbers(unwrap(b))
  tails = Math.trunc(Number(unwrap(tails)))
  type = Math.trunc(Number(unwrap(type)))
  if ((tails !== 1 && tails !== 2) || type < 1 || type > 3) throw FormulaError.NUM
  const mean = (v) => v.reduce((p, q) => p + q, 0) / v.length
  const svar = (v) => { const m = mean(v); return v.reduce((p, q) => p + (q - m) * (q - m), 0) / (v.length - 1) }
  let t, df
  if (type === 1) {
    if (x.length !== y.length) throw FormulaError.NA
    const d = x.map((v, i) => v - y[i])
    t = mean(d) / Math.sqrt(svar(d) / d.length)
    df = d.length - 1
  } else if (type === 2) {
    df = x.length + y.length - 2
    const sp = ((x.length - 1) * svar(x) + (y.length - 1) * svar(y)) / df
    t = (mean(x) - mean(y)) / Math.sqrt(sp * (1 / x.length + 1 / y.length))
  } else {
    const vx = svar(x) / x.length
    const vy = svar(y) / y.length
    t = (mean(x) - mean(y)) / Math.sqrt(vx + vy)
    df = (vx + vy) * (vx + vy) / (vx * vx / (x.length - 1) + vy * vy / (y.length - 1))
  }
  if (!isFinite(t) || !(df > 0)) throw FormulaError.DIV0
  const at = Math.abs(t)
  return tails === 1 ? formulajs.T.DIST.RT(at, df) : formulajs.T.DIST['2T'](at, df)
}

function squareMatrix (arg) {
  const m = unwrap(arg)
  const rows = Array.isArray(m) ? m.map((r) => [].concat(r)) : [[m]]
  if (!rows.length || rows.some((r) => r.length !== rows.length || r.some((v) => typeof v !== 'number'))) throw FormulaError.VALUE
  return rows.map((r) => r.slice())
}

// Determinant by elimination with partial pivoting. Upstream extended the
// rule of Sarrus past 3x3, which is wrong there.
function MDETERM (arg) {
  const a = squareMatrix(arg)
  const n = a.length
  let det = 1
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r
    if (a[p][c] === 0) return 0
    if (p !== c) { const t = a[p]; a[p] = a[c]; a[c] = t; det = -det }
    det *= a[c][c]
    for (let r = c + 1; r < n; r++) {
      const k = a[r][c] / a[c][c]
      for (let j = c; j < n; j++) a[r][j] -= k * a[c][j]
    }
  }
  return det
}

// Inverse by Gauss-Jordan elimination with partial pivoting.
function MINVERSE (arg) {
  const a = squareMatrix(arg)
  const n = a.length
  const inv = a.map((_, i) => a.map((__, j) => (i === j ? 1 : 0)))
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r
    if (a[p][c] === 0) throw FormulaError.NUM
    let t = a[p]; a[p] = a[c]; a[c] = t
    t = inv[p]; inv[p] = inv[c]; inv[c] = t
    const d = a[c][c]
    for (let j = 0; j < n; j++) { a[c][j] /= d; inv[c][j] /= d }
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      const k = a[r][c]
      if (k === 0) continue
      for (let j = 0; j < n; j++) { a[r][j] -= k * a[c][j]; inv[r][j] -= k * inv[c][j] }
    }
  }
  return inv
}

// Complex numbers as Excel writes them: each part to 15 significant digits.
function excelNumber (x) {
  if (x === 0) return '0'
  return String(Number(x.toPrecision(15)))
}
function formatComplex (text) {
  if (typeof text !== 'string') return text
  const m = /^([+-]?[0-9.]+(?:e[+-]?\d+)?)?(?:([+-][0-9.]*(?:e[+-]?\d+)?)([ij]))?$/i.exec(text)
  if (!m || (!m[1] && !m[3])) return text
  const re = m[1] !== undefined ? Number(m[1]) : 0
  const imText = m[3] ? (m[2] === '+' || m[2] === '' ? '1' : m[2] === '-' ? '-1' : m[2]) : null
  const im = imText === null ? 0 : Number(imText)
  const unit = m[3] || 'i'
  const r = excelNumber(re)
  if (im === 0) return r
  const i = excelNumber(im)
  const iPart = (i === '1' ? '' : i === '-1' ? '-' : i) + unit
  if (re === 0) return iPart
  return r + (im > 0 ? '+' : '') + iPart
}
function complexOut (impl) {
  return (...args) => formatComplex(impl(...args))
}

const COMPLEX_RESULTS = ['COMPLEX', 'IMCONJUGATE', 'IMCOS', 'IMCOSH', 'IMCOT', 'IMCSC', 'IMCSCH', 'IMDIV', 'IMEXP', 'IMLN',
  'IMLOG10', 'IMLOG2', 'IMPOWER', 'IMPRODUCT', 'IMSEC', 'IMSECH', 'IMSIN', 'IMSINH', 'IMSQRT', 'IMSUB', 'IMSUM', 'IMTAN']

const ERRORS = new Set(['#NULL!', '#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#NUM!', '#N/A'])

function unwrap (arg) {
  return arg && typeof arg === 'object' && 'value' in arg ? arg.value : arg
}

function wrap (name, impl) {
  return (...args) => {
    const result = impl(...args.map(unwrap))
    if (result instanceof Error) {
      const code = ERRORS.has(result.message) ? result.message : '#VALUE!'
      throw new FormulaError(code)
    }
    return result
  }
}

// Excel orders mixed values numbers < text < booleans, and compares text
// without regard to case. Uses code-unit order on upper-cased text, never
// localeCompare (which follows the device language). formulajs's MATCH uses
// localeCompare, so MATCH is implemented here.
function rank (v) {
  if (typeof v === 'number') return 0
  if (typeof v === 'string') return 1
  if (typeof v === 'boolean') return 2
  return 3
}

function compare (a, b) {
  const ra = rank(a)
  const rb = rank(b)
  if (ra !== rb) return ra - rb
  if (ra === 1) {
    const ua = a.toUpperCase()
    const ub = b.toUpperCase()
    return ua < ub ? -1 : ua > ub ? 1 : 0
  }
  return a < b ? -1 : a > b ? 1 : 0
}

function wildcard (pattern) {
  let re = ''
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]
    if (ch === '~' && i + 1 < pattern.length) re += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    else if (ch === '*') re += '.*'
    else if (ch === '?') re += '.'
    else re += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp('^' + re + '$', 'i')
}

function MATCH (lookup, array, type) {
  lookup = unwrap(lookup)
  const list = [].concat(...[].concat(unwrap(array)).map((r) => [].concat(r)))
  type = type === undefined ? 1 : Number(unwrap(type))
  if (type === 0) {
    const re = typeof lookup === 'string' && /[*?~]/.test(lookup) ? wildcard(lookup) : null
    for (let i = 0; i < list.length; i++) {
      const v = list[i]
      if (re ? typeof v === 'string' && re.test(v) : compare(v, lookup) === 0 && rank(v) === rank(lookup)) return i + 1
    }
    throw FormulaError.NA
  }
  // Approximate match on a sorted list: last position that does not pass the
  // lookup value (ascending for 1, descending for -1).
  let found = -1
  for (let i = 0; i < list.length; i++) {
    const v = list[i]
    if (v === null || v === undefined || rank(v) !== rank(lookup)) continue
    const c = compare(v, lookup)
    if (type > 0 ? c <= 0 : c >= 0) found = i
    else break
  }
  if (found === -1) throw FormulaError.NA
  return found + 1
}

function fillFunctions () {
  const out = { MATCH, CHOOSE, AVERAGEIF, SEARCH, SEARCHB: SEARCH, LOGEST, 'T.TEST': TTEST, MDETERM, MINVERSE }
  for (const name of COMPLEX_RESULTS) out[name] = complexOut(engineering[name])
  Object.assign(out, newerFunctions(), arrayFunctions())
  for (const [name, impl] of Object.entries(FILLS)) {
    if (typeof impl !== 'function') throw new Error('formulajs has no ' + name)
    out[name] = wrap(name, impl)
  }
  return out
}

module.exports = { fillFunctions, FILLS }
