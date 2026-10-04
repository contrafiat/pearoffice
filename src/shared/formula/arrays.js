// Excel's array functions, whose answers spill into neighbouring cells
// (proposals/2026-10-04-spilling-formulas.md): FILTER, SORT, SORTBY, UNIQUE,
// SEQUENCE, TEXTSPLIT, TAKE, DROP, VSTACK, HSTACK, TOCOL, TOROW, CHOOSEROWS,
// CHOOSECOLS, WRAPROWS, WRAPCOLS, EXPAND and RANDARRAY.
//
// Arguments are the parser's raw ones ({ value, omitted }), as in newer.js.
// Results are rows of values. Everything is a pure function of the
// arguments except RANDARRAY, which is device-local like RAND. Sorting and
// matching compare text with a fixed rule (newer.js `compare`), never with
// the device's language.

const FormulaError = require('./vendor/fast-formula-parser/formulas/error')
const { helpers } = require('./newer')

const { val, left, num, text, grid, compare } = helpers
const CALC = new FormulaError('#CALC!')
const MAX_CELLS = 10000000

const isErr = (v) => v instanceof FormulaError
const blank = (v) => v === null || v === undefined
const width = (g) => Math.max(...g.map((r) => r.length))
// A block with every row the same length, short rows padded.
function square (g, pad = FormulaError.NA) {
  const w = width(g)
  return g.map((r) => (r.length === w ? r : r.concat(Array(w - r.length).fill(pad))))
}
const transpose = (g) => g[0].map((_, c) => g.map((r) => r[c]))
const int = (a, dflt) => Math.trunc(num(a, dflt))
const bool = (a, dflt) => {
  if (left(a)) return dflt
  const v = val(a)
  if (Array.isArray(v)) throw FormulaError.VALUE
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  if (blank(v)) return false
  throw FormulaError.VALUE
}
// The values of a list of arguments, each possibly a block, read row by row.
function flat (args) {
  const out = []
  for (const a of args) for (const r of grid(a)) for (const v of r) out.push(v)
  return out
}
function checkSize (rows, cols) {
  if (rows * cols > MAX_CELLS) throw FormulaError.NUM
}

// Excel orders numbers, text, booleans, then errors; blanks go last.
function order (a, b) {
  const ab = blank(a)
  const bb = blank(b)
  if (ab || bb) return ab === bb ? 0 : ab ? 1 : -1
  if (isErr(a) || isErr(b)) return isErr(a) === isErr(b) ? 0 : isErr(a) ? 1 : -1
  return compare(a, b)
}

// Equal as UNIQUE sees it: same type, text without case.
function same (a, b) {
  if (blank(a) || blank(b)) return blank(a) && blank(b)
  if (isErr(a) || isErr(b)) return isErr(a) && isErr(b) && a.error === b.error
  if (typeof a !== typeof b) return false
  if (typeof a === 'string') return a.toUpperCase() === b.toUpperCase()
  return a === b
}

function truthy (v) {
  if (isErr(v)) throw v
  if (blank(v)) return false
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  throw FormulaError.VALUE
}

function FILTER (array, include, ifEmpty) {
  const g = square(grid(array))
  const inc = grid(include)
  let keep
  if (inc.every((r) => r.length === 1) && inc.length === g.length) {
    keep = inc.map((r) => truthy(r[0]))
    const out = g.filter((_, i) => keep[i])
    if (out.length) return out
  } else if (inc.length === 1 && inc[0].length === g[0].length) {
    keep = inc[0].map(truthy)
    const out = g.map((r) => r.filter((_, i) => keep[i]))
    if (out[0].length) return out
  } else throw FormulaError.VALUE
  if (!left(ifEmpty)) return val(ifEmpty)
  throw CALC
}

// Sort rows (or columns, byCol) by the given keys: [{ key: index or vector, desc }].
function sortBlock (g, keys, byCol) {
  const lines = byCol ? transpose(g) : g
  const idx = lines.map((_, i) => i)
  idx.sort((i, j) => {
    for (const k of keys) {
      const a = k.vector ? k.vector[i] : lines[i][k.index]
      const b = k.vector ? k.vector[j] : lines[j][k.index]
      const c = order(a, b)
      if (c !== 0) return k.desc ? -c : c
    }
    return 0
  })
  const out = idx.map((i) => lines[i])
  return byCol ? transpose(out) : out
}

function sortOrder (v) {
  if (v === 1) return false
  if (v === -1) return true
  throw FormulaError.VALUE
}

function SORT (array, sortIndex, sortOrderArg, byColArg) {
  const g = square(grid(array))
  const byCol = bool(byColArg, false)
  const span = byCol ? g.length : g[0].length
  const indexes = left(sortIndex) ? [1] : flat([sortIndex]).map((v) => Math.trunc(num(v)))
  const orders = left(sortOrderArg) ? [1] : flat([sortOrderArg]).map((v) => num(v))
  if (orders.length !== 1 && orders.length !== indexes.length) throw FormulaError.VALUE
  const keys = indexes.map((n, i) => {
    if (n < 1 || n > span) throw FormulaError.VALUE
    return { index: n - 1, desc: sortOrder(orders.length === 1 ? orders[0] : orders[i]) }
  })
  return sortBlock(g, keys, byCol)
}

function SORTBY (array, ...rest) {
  const g = square(grid(array))
  if (!rest.length) throw FormulaError.VALUE
  const keys = []
  let byCol = null
  for (let i = 0; i < rest.length; i += 2) {
    const by = grid(rest[i])
    let vector
    let cols
    if (by.every((r) => r.length === 1)) { vector = by.map((r) => r[0]); cols = false } else if (by.length === 1) { vector = by[0]; cols = true } else throw FormulaError.VALUE
    if (by.length === 1 && by[0].length === 1) cols = byCol === null ? g.length === 1 && g[0].length > 1 : byCol
    if (byCol === null) byCol = cols
    if (cols !== byCol || vector.length !== (byCol ? g[0].length : g.length)) throw FormulaError.VALUE
    keys.push({ vector, desc: sortOrder(left(rest[i + 1]) ? 1 : num(rest[i + 1])) })
  }
  return sortBlock(g, keys, byCol)
}

function UNIQUE (array, byColArg, exactlyOnceArg) {
  const g = square(grid(array))
  const byCol = bool(byColArg, false)
  const exactlyOnce = bool(exactlyOnceArg, false)
  const lines = byCol ? transpose(g) : g
  const groups = []
  for (const line of lines) {
    const hit = groups.find((x) => x.line.length === line.length && x.line.every((v, i) => same(v, line[i])))
    if (hit) hit.count++
    else groups.push({ line, count: 1 })
  }
  const out = groups.filter((x) => !exactlyOnce || x.count === 1).map((x) => x.line)
  if (!out.length) throw CALC
  return byCol ? transpose(out) : out
}

function SEQUENCE (rowsArg, colsArg, startArg, stepArg) {
  const rows = int(rowsArg, 1)
  const cols = int(colsArg, 1)
  const start = num(startArg, 1)
  const step = num(stepArg, 1)
  if (rows < 0 || cols < 0) throw FormulaError.VALUE
  if (rows === 0 || cols === 0) throw CALC
  checkSize(rows, cols)
  const out = []
  for (let r = 0; r < rows; r++) {
    const line = []
    for (let c = 0; c < cols; c++) line.push(start + (r * cols + c) * step)
    out.push(line)
  }
  return out
}

// Where the delimiters (longest first at each position) split s.
function splitBy (s, delims, caseless) {
  const ds = delims.filter((d) => d.length)
  if (!ds.length) return [s]
  const hay = caseless ? s.toUpperCase() : s
  const cmp = ds.map((d) => (caseless ? d.toUpperCase() : d))
  const out = []
  let from = 0
  for (let i = 0; i < s.length;) {
    let hit = 0
    for (const d of cmp) if (d.length > hit && hay.startsWith(d, i)) hit = d.length
    if (hit) { out.push(s.slice(from, i)); i += hit; from = i } else i++
  }
  out.push(s.slice(from))
  return out
}

function TEXTSPLIT (t, colDelim, rowDelim, ignoreEmptyArg, matchModeArg, padWith) {
  if (Array.isArray(val(t))) throw FormulaError.VALUE
  const s = text(t)
  const colDs = left(colDelim) ? [] : flat([colDelim]).map((v) => text({ value: v }))
  const rowDs = left(rowDelim) ? [] : flat([rowDelim]).map((v) => text({ value: v }))
  if (!colDs.some((d) => d.length) && !rowDs.some((d) => d.length)) throw FormulaError.VALUE
  const ignoreEmpty = bool(ignoreEmptyArg, false)
  const mode = int(matchModeArg, 0)
  if (mode !== 0 && mode !== 1) throw FormulaError.VALUE
  const pad = left(padWith) ? FormulaError.NA : val(padWith)
  let lines = rowDs.length ? splitBy(s, rowDs, mode === 1) : [s]
  if (ignoreEmpty) lines = lines.filter((l) => l !== '')
  let out = lines.map((l) => {
    let parts = colDs.length ? splitBy(l, colDs, mode === 1) : [l]
    if (ignoreEmpty) parts = parts.filter((p) => p !== '')
    return parts
  })
  out = out.filter((r) => r.length)
  if (!out.length) throw CALC
  return square(out, pad)
}

function TAKE (array, rowsArg, colsArg) {
  const g = square(grid(array))
  let out = g
  if (!left(rowsArg)) {
    const n = int(rowsArg)
    if (n === 0) throw CALC
    out = n > 0 ? out.slice(0, n) : out.slice(Math.max(0, out.length + n))
  }
  if (!left(colsArg)) {
    const n = int(colsArg)
    if (n === 0) throw CALC
    out = out.map((r) => (n > 0 ? r.slice(0, n) : r.slice(Math.max(0, r.length + n))))
  }
  return out
}

function DROP (array, rowsArg, colsArg) {
  const g = square(grid(array))
  let out = g
  if (!left(rowsArg)) {
    const n = int(rowsArg)
    out = n >= 0 ? out.slice(n) : out.slice(0, Math.max(0, out.length + n))
  }
  if (!left(colsArg)) {
    const n = int(colsArg)
    out = out.map((r) => (n >= 0 ? r.slice(n) : r.slice(0, Math.max(0, r.length + n))))
  }
  if (!out.length || !out[0].length) throw CALC
  return out
}

function VSTACK (...arrays) {
  const out = []
  for (const a of arrays) for (const r of square(grid(a))) out.push(r)
  return square(out)
}

function HSTACK (...arrays) {
  const parts = arrays.map((a) => square(grid(a)))
  const rows = Math.max(...parts.map((p) => p.length))
  const out = []
  for (let r = 0; r < rows; r++) {
    const line = []
    for (const p of parts) line.push(...(r < p.length ? p[r] : Array(p[0].length).fill(FormulaError.NA)))
    out.push(line)
  }
  return out
}

function listOf (array, ignoreArg, byColArg) {
  const g = square(grid(array))
  const ignore = int(ignoreArg, 0)
  if (ignore < 0 || ignore > 3) throw FormulaError.VALUE
  const lines = bool(byColArg, false) ? transpose(g) : g
  const out = []
  for (const r of lines) {
    for (const v of r) {
      if ((ignore & 1) && blank(v)) continue
      if ((ignore & 2) && isErr(v)) continue
      out.push(v)
    }
  }
  if (!out.length) throw CALC
  return out
}

const TOCOL = (array, ignore, byCol) => listOf(array, ignore, byCol).map((v) => [v])
const TOROW = (array, ignore, byCol) => [listOf(array, ignore, byCol)]

function pick (count, nums) {
  return flat(nums).map((v) => {
    const n = Math.trunc(num({ value: v }))
    if (n === 0 || Math.abs(n) > count) throw FormulaError.VALUE
    return n > 0 ? n - 1 : count + n
  })
}

function CHOOSEROWS (array, ...nums) {
  const g = square(grid(array))
  if (!nums.length) throw FormulaError.VALUE
  return pick(g.length, nums).map((i) => g[i])
}

function CHOOSECOLS (array, ...nums) {
  const g = square(grid(array))
  if (!nums.length) throw FormulaError.VALUE
  const idx = pick(g[0].length, nums)
  return g.map((r) => idx.map((i) => r[i]))
}

function wrap (vector, countArg, padWith) {
  const g = grid(vector)
  if (g.length !== 1 && !g.every((r) => r.length === 1)) throw FormulaError.VALUE
  const list = g.length === 1 ? g[0] : g.map((r) => r[0])
  const n = int(countArg)
  if (n < 1) throw FormulaError.NUM
  const pad = left(padWith) ? FormulaError.NA : val(padWith)
  const out = []
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n))
  return square(out, pad)
}

const WRAPROWS = (vector, count, pad) => wrap(vector, count, pad)
const WRAPCOLS = (vector, count, pad) => transpose(wrap(vector, count, pad))

function EXPAND (array, rowsArg, colsArg, padWith) {
  const g = square(grid(array))
  const rows = left(rowsArg) ? g.length : int(rowsArg)
  const cols = left(colsArg) ? g[0].length : int(colsArg)
  if (rows < g.length || cols < g[0].length) throw FormulaError.VALUE
  checkSize(rows, cols)
  const pad = left(padWith) ? FormulaError.NA : val(padWith)
  const out = []
  for (let r = 0; r < rows; r++) {
    const line = []
    for (let c = 0; c < cols; c++) line.push(r < g.length && c < g[0].length ? g[r][c] : pad)
    out.push(line)
  }
  return out
}

// Device-local, like RAND (marked volatile in index.js).
function RANDARRAY (rowsArg, colsArg, minArg, maxArg, integerArg) {
  const rows = int(rowsArg, 1)
  const cols = int(colsArg, 1)
  const min = num(minArg, 0)
  const max = num(maxArg, 1)
  const integer = bool(integerArg, false)
  if (rows < 0 || cols < 0 || min > max) throw FormulaError.VALUE
  if (rows === 0 || cols === 0) throw CALC
  if (integer && (min !== Math.trunc(min) || max !== Math.trunc(max))) throw FormulaError.VALUE
  checkSize(rows, cols)
  const out = []
  for (let r = 0; r < rows; r++) {
    const line = []
    for (let c = 0; c < cols; c++) line.push(integer ? min + Math.floor(Math.random() * (max - min + 1)) : min + Math.random() * (max - min))
    out.push(line)
  }
  return out
}

function arrayFunctions () {
  return { FILTER, SORT, SORTBY, UNIQUE, SEQUENCE, TEXTSPLIT, TAKE, DROP, VSTACK, HSTACK, TOCOL, TOROW, CHOOSEROWS, CHOOSECOLS, WRAPROWS, WRAPCOLS, EXPAND, RANDARRAY }
}

module.exports = { arrayFunctions }
