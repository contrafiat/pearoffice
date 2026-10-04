// Excel functions fast-formula-parser and formulajs lack, or get wrong for
// PearSheet: XLOOKUP, XMATCH, TEXTBEFORE, TEXTAFTER, OFFSET, INDIRECT, XNPV,
// XIRR and the database functions (DSUM...). Single answers only: a result
// that would spill into neighbouring cells shows its first value (see
// TODO.md, spilling).
//
// Functions here take the parser's raw arguments ({ value, omitted }), so
// they can tell a left-out argument from an empty one. Everything is a pure
// function of its arguments: no dates through the JS Date object, no locale.

const FormulaError = require('./vendor/fast-formula-parser/formulas/error')
const { FormulaHelpers: H, Criteria } = require('./vendor/fast-formula-parser/formulas/helpers')
const { Infix } = require('./vendor/fast-formula-parser/formulas/operators')
const { colToNum, MAX_ROWS, MAX_COLS } = require('../a1')

const val = (a) => (a && typeof a === 'object' && !Array.isArray(a) && 'value' in a ? a.value : a)
const left = (a) => a === undefined || a === null || (typeof a === 'object' && a.omitted === true)
const num = (a, dflt) => {
  if (left(a)) return dflt
  const v = val(a)
  if (Array.isArray(v)) throw FormulaError.VALUE
  const n = typeof v === 'boolean' ? Number(v) : typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  if (typeof n !== 'number' || !isFinite(n)) throw FormulaError.VALUE
  return n
}
const text = (a) => {
  const v = val(a)
  if (v === null || v === undefined) return ''
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  return String(v)
}
const grid = (a) => {
  const v = val(a)
  if (!Array.isArray(v)) return [[v]]
  return v.map((r) => (Array.isArray(r) ? r : [r]))
}

// Excel orders numbers < text < booleans and compares text without case.
// Same rules as MATCH in fills.js.
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

// --- lookups -----------------------------------------------------------------

// Position (0-based) of `lookup` in `list`, or -1. matchMode: 0 exact,
// -1 exact or next smaller, 1 exact or next larger, 2 wildcard. searchMode:
// 1 first to last, -1 last to first; 2 and -2 (binary search on sorted data)
// give the same answer as 1 and -1 on sorted data, so they scan too.
function find (lookup, list, matchMode, searchMode) {
  if (![0, -1, 1, 2].includes(matchMode) || ![1, -1, 2, -2].includes(searchMode)) throw FormulaError.VALUE
  const order = []
  if (searchMode > 0) for (let i = 0; i < list.length; i++) order.push(i)
  else for (let i = list.length - 1; i >= 0; i--) order.push(i)
  const re = matchMode === 2 && typeof lookup === 'string' ? wildcard(lookup) : null
  let best = -1
  for (const i of order) {
    const v = list[i]
    if (v === null || v === undefined) continue
    if (re) { if (typeof v === 'string' && re.test(v)) return i; continue }
    if (rank(v) !== rank(lookup)) continue
    const c = compare(v, lookup)
    if (c === 0) return i
    if (matchMode === -1 && c < 0 && (best === -1 || compare(v, list[best]) > 0)) best = i
    if (matchMode === 1 && c > 0 && (best === -1 || compare(v, list[best]) < 0)) best = i
  }
  return best
}

function vector (a) {
  const g = grid(a)
  if (g.length === 1) return { list: g[0], across: true }
  if (g.every((r) => r.length === 1)) return { list: g.map((r) => r[0]), across: false }
  throw FormulaError.VALUE
}

function XLOOKUP (lookup, lookupArray, returnArray, ifNotFound, matchMode, searchMode) {
  const { list, across } = vector(lookupArray)
  const i = find(val(lookup), list, num(matchMode, 0), num(searchMode, 1))
  if (i === -1) {
    if (!left(ifNotFound)) return val(ifNotFound)
    throw FormulaError.NA
  }
  const out = grid(returnArray)
  if (across) {
    if (out[0].length !== list.length) throw FormulaError.VALUE
    return out.length === 1 ? out[0][i] : out.map((r) => [r[i]])
  }
  if (out.length !== list.length) throw FormulaError.VALUE
  return out[i].length === 1 ? out[i][0] : [out[i]]
}

function XMATCH (lookup, lookupArray, matchMode, searchMode) {
  const { list } = vector(lookupArray)
  const i = find(val(lookup), list, num(matchMode, 0), num(searchMode, 1))
  if (i === -1) throw FormulaError.NA
  return i + 1
}

// --- text --------------------------------------------------------------------

// Where the n-th delimiter starts and ends (n < 0 counts from the end), or
// null. With matchEnd the start and end of the text count as delimiters.
function delimiterAt (s, delims, n, caseless, matchEnd) {
  const hay = caseless ? s.toUpperCase() : s
  const ds = delims.map((d) => (caseless ? d.toUpperCase() : d))
  const hits = []
  for (let i = 0; i < hay.length;) {
    let hit = null
    for (const d of ds) if (d.length && hay.startsWith(d, i) && (!hit || d.length > hit.length)) hit = d
    if (hit) { hits.push({ start: i, end: i + hit.length }); i += hit.length } else i++
  }
  if (matchEnd) {
    if (n > 0) hits.push({ start: s.length, end: s.length })
    else hits.unshift({ start: 0, end: 0 })
  }
  const k = n > 0 ? n - 1 : hits.length + n
  return k >= 0 && k < hits.length ? hits[k] : null
}

function textSplitArgs (t, delimiter, instance, matchMode, matchEnd) {
  const s = text(t)
  const dv = val(delimiter)
  const delims = (Array.isArray(dv) ? [].concat(...dv.map((r) => [].concat(r))) : [dv]).map((d) => text(d))
  const n = Math.trunc(num(instance, 1))
  if (n === 0 || Math.abs(n) > s.length + 1) throw FormulaError.VALUE
  return { s, at: delimiterAt(s, delims, n, num(matchMode, 0) === 1, num(matchEnd, 0) === 1), emptyDelim: delims.every((d) => d === '') }
}

function TEXTBEFORE (t, delimiter, instance, matchMode, matchEnd, ifNotFound) {
  const { s, at, emptyDelim } = textSplitArgs(t, delimiter, instance, matchMode, matchEnd)
  if (emptyDelim) return num(instance, 1) > 0 ? '' : s
  if (!at) { if (!left(ifNotFound)) return val(ifNotFound); throw FormulaError.NA }
  return s.slice(0, at.start)
}

function TEXTAFTER (t, delimiter, instance, matchMode, matchEnd, ifNotFound) {
  const { s, at, emptyDelim } = textSplitArgs(t, delimiter, instance, matchMode, matchEnd)
  if (emptyDelim) return num(instance, 1) > 0 ? s : ''
  if (!at) { if (!left(ifNotFound)) return val(ifNotFound); throw FormulaError.NA }
  return s.slice(at.end)
}

// --- references --------------------------------------------------------------

function refBox (ref) {
  if (!ref || !ref.ref) throw FormulaError.VALUE
  const r = ref.ref
  if (r.from) return { top: r.from.row, left: r.from.col, rows: r.to.row - r.from.row + 1, cols: r.to.col - r.from.col + 1 }
  return { top: r.row, left: r.col, rows: 1, cols: 1 }
}

function makeRef (sheet, top, left, rows, cols) {
  if (top < 1 || left < 1 || rows < 1 || cols < 1 || top + rows - 1 > MAX_ROWS || left + cols - 1 > MAX_COLS) throw FormulaError.REF
  const ref = rows === 1 && cols === 1
    ? { row: top, col: left }
    : { from: { row: top, col: left }, to: { row: top + rows - 1, col: left + cols - 1 } }
  if (sheet) ref.sheet = sheet
  return { ref }
}

// OFFSET gets its reference unresolved (see vendor/README.md).
function OFFSET (context, reference, rows, cols, height, width) {
  if (!reference || !reference.ref) throw FormulaError.VALUE
  const arg = (a, dflt) => (a === undefined || a === null ? dflt : num({ value: context.utils.extractRefValue(a).val }, dflt))
  const box = refBox(reference)
  const h = Math.trunc(arg(height, box.rows))
  const w = Math.trunc(arg(width, box.cols))
  return makeRef(reference.ref.sheet, box.top + Math.trunc(arg(rows, 0)), box.left + Math.trunc(arg(cols, 0)), h, w)
}

const A1 = /^\$?([A-Za-z]{1,3})\$?(\d+)$/
const R1C1 = /^R(\d+)C(\d+)$/i
function cellFrom (part, a1) {
  const m = a1 ? A1.exec(part) : R1C1.exec(part)
  if (!m) throw FormulaError.REF
  return a1 ? { row: Number(m[2]), col: colToNum(m[1].toUpperCase()) } : { row: Number(m[1]), col: Number(m[2]) }
}

function INDIRECT (context, refText, a1) {
  let s = text(refText).trim()
  const useA1 = left(a1) ? true : !!val(a1)
  let sheet = null
  const bang = s.lastIndexOf('!')
  if (bang !== -1) {
    sheet = s.slice(0, bang)
    if (sheet[0] === "'" && sheet[sheet.length - 1] === "'") sheet = sheet.slice(1, -1).replace(/''/g, "'")
    s = s.slice(bang + 1)
  }
  const parts = s.split(':')
  if (parts.length > 2 || !parts[0]) throw FormulaError.REF
  const a = cellFrom(parts[0], useA1)
  const b = parts.length === 2 ? cellFrom(parts[1], useA1) : a
  const top = Math.min(a.row, b.row)
  const lft = Math.min(a.col, b.col)
  return makeRef(sheet, top, lft, Math.abs(a.row - b.row) + 1, Math.abs(a.col - b.col) + 1)
}

// --- money with dates ----------------------------------------------------------

// Dates are serial numbers (whole days); never JS Dates, whose arithmetic
// depends on the device's timezone.
function cashflows (values, dates) {
  const v = [].concat(...grid(values)).filter((x) => x !== null && x !== undefined)
  const d = [].concat(...grid(dates)).filter((x) => x !== null && x !== undefined).map((x) => (typeof x === 'number' ? Math.trunc(x) : NaN))
  if (v.length !== d.length || v.length < 2 || v.some((x) => typeof x !== 'number') || d.some((x) => !isFinite(x))) throw FormulaError.VALUE
  if (d.some((x) => x < d[0])) throw FormulaError.NUM
  return { v, d }
}

function npvAt (rate, v, d) {
  let sum = 0
  for (let i = 0; i < v.length; i++) sum += v[i] / Math.pow(1 + rate, (d[i] - d[0]) / 365)
  return sum
}

function XNPV (rate, values, dates) {
  const r = num(rate)
  if (r <= -1) throw FormulaError.NUM
  const { v, d } = cashflows(values, dates)
  return npvAt(r, v, d)
}

// Newton's method from the guess, as Excel does; bisection if it wanders.
function XIRR (values, dates, guess) {
  const { v, d } = cashflows(values, dates)
  if (!v.some((x) => x > 0) || !v.some((x) => x < 0)) throw FormulaError.NUM
  const deriv = (rate) => {
    let s = 0
    for (let i = 1; i < v.length; i++) { const t = (d[i] - d[0]) / 365; s -= t * v[i] / Math.pow(1 + rate, t + 1) }
    return s
  }
  let r = num(guess, 0.1)
  for (let k = 0; k < 100; k++) {
    const f = npvAt(r, v, d)
    if (Math.abs(f) < 1e-10) return r
    const fd = deriv(r)
    if (fd === 0 || !isFinite(fd)) break
    const next = r - f / fd
    if (!isFinite(next) || next <= -1) break
    if (Math.abs(next - r) < 1e-12) return next
    r = next
  }
  // Bisection over (-0.999999, 10).
  let lo = -0.999999
  let hi = 10
  let flo = npvAt(lo, v, d)
  if (flo * npvAt(hi, v, d) > 0) throw FormulaError.NUM
  for (let k = 0; k < 200; k++) {
    const mid = (lo + hi) / 2
    const fm = npvAt(mid, v, d)
    if (Math.abs(fm) < 1e-10 || hi - lo < 1e-14) return mid
    if (flo * fm < 0) hi = mid
    else { lo = mid; flo = fm }
  }
  return (lo + hi) / 2
}

// --- database functions ----------------------------------------------------------

// Database: a range whose first row names the fields. Criteria: a range whose
// first row names fields and whose other rows are alternatives; within a row
// every filled cell must hold. Plain text matches entries that start with it,
// as in Excel's advanced filter; "=text" matches exactly.
function matchesCell (value, crit) {
  if (crit === null || crit === undefined || crit === '') return true
  if (typeof crit === 'string' && !/^(<=|>=|<>|=|<|>)/.test(crit)) {
    return typeof value === 'string' && wildcard(crit + '*').test(value)
  }
  const c = Criteria.parse(H.accept({ value: crit, isArray: false }))
  if (c.op === 'wc') return c.match === c.value.test(value)
  return Infix.compareOp(value, c.op, c.value, false, false)
}

function selected (database, field, criteria) {
  const db = grid(database)
  const cr = grid(criteria)
  if (db.length < 1 || cr.length < 2) throw FormulaError.VALUE
  const heads = db[0].map((h) => text(h).toUpperCase())
  const fv = val(field)
  let col
  if (typeof fv === 'number') col = Math.trunc(fv) - 1
  else col = heads.indexOf(text(fv).toUpperCase())
  if (col < 0 || col >= heads.length) throw FormulaError.VALUE
  const crHeads = cr[0].map((h) => heads.indexOf(text(h).toUpperCase()))
  const out = []
  for (let r = 1; r < db.length; r++) {
    const rowHit = cr.slice(1).some((crow) => crow.every((c, j) => (crHeads[j] === -1 ? (c === null || c === undefined || c === '') : matchesCell(db[r][crHeads[j]], c))))
    if (rowHit) out.push(db[r][col])
  }
  return out
}

const numbersOf = (list) => list.filter((x) => typeof x === 'number')
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length
const sumsq = (xs) => { const m = mean(xs); return xs.reduce((a, b) => a + (b - m) * (b - m), 0) }

const DB = {
  DSUM: (db, f, c) => numbersOf(selected(db, f, c)).reduce((a, b) => a + b, 0),
  DAVERAGE: (db, f, c) => { const xs = numbersOf(selected(db, f, c)); if (!xs.length) throw FormulaError.DIV0; return mean(xs) },
  DCOUNT: (db, f, c) => numbersOf(selected(db, f, c)).length,
  DCOUNTA: (db, f, c) => selected(db, f, c).filter((x) => x !== null && x !== undefined && x !== '').length,
  DGET: (db, f, c) => { const xs = selected(db, f, c); if (xs.length === 0) throw FormulaError.VALUE; if (xs.length > 1) throw FormulaError.NUM; return xs[0] },
  DMAX: (db, f, c) => { const xs = numbersOf(selected(db, f, c)); return xs.length ? Math.max(...xs) : 0 },
  DMIN: (db, f, c) => { const xs = numbersOf(selected(db, f, c)); return xs.length ? Math.min(...xs) : 0 },
  DPRODUCT: (db, f, c) => { const xs = numbersOf(selected(db, f, c)); return xs.length ? xs.reduce((a, b) => a * b, 1) : 0 },
  DSTDEV: (db, f, c) => { const xs = numbersOf(selected(db, f, c)); if (xs.length < 2) throw FormulaError.DIV0; return Math.sqrt(sumsq(xs) / (xs.length - 1)) },
  DSTDEVP: (db, f, c) => { const xs = numbersOf(selected(db, f, c)); if (!xs.length) throw FormulaError.DIV0; return Math.sqrt(sumsq(xs) / xs.length) },
  DVAR: (db, f, c) => { const xs = numbersOf(selected(db, f, c)); if (xs.length < 2) throw FormulaError.DIV0; return sumsq(xs) / (xs.length - 1) },
  DVARP: (db, f, c) => { const xs = numbersOf(selected(db, f, c)); if (!xs.length) throw FormulaError.DIV0; return sumsq(xs) / xs.length }
}

function newerFunctions () {
  return { XLOOKUP, XMATCH, TEXTBEFORE, TEXTAFTER, OFFSET, INDIRECT, XNPV, XIRR, ...DB }
}

module.exports = { newerFunctions }
