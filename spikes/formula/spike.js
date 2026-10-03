// Formula spike: are results identical across runtimes, timezones and edit
// orders? Evaluates one corpus with two MIT engines on top of a tiny recalc
// engine (dependency graph + memoized evaluation + cycle detection).
//
// Usage: node spike.js [seed]   or   bare spike.bundle [seed]
// Prints one JSON object. Run under several TZ values and diff the output.

require('./bare-globals')
if ((typeof Bare !== 'undefined' ? Bare.argv : process.argv).includes('--det')) require('./detmath')
const FastParser = require('fast-formula-parser')
const { DepParser } = require('fast-formula-parser')
const HotParser = require('hot-formula-parser').Parser
const formulajs = require('@formulajs/formulajs')

// fast-formula-parser ships empty stubs for these. Fill them from formulajs.
// Date functions are deliberately NOT taken from formulajs: they use the
// device's local timezone.
const FILL = ['COUNTIF', 'MAX', 'MIN', 'UPPER', 'STDEV', 'MATCH', 'SUMIFS', 'COUNTIFS', 'TEXTJOIN', 'PMT', 'FV', 'NPV', 'RATE', 'IRR']
function fillFunctions () {
  const fns = {}
  for (const name of FILL) {
    const impl = name === 'STDEV' ? formulajs.STDEV.S : formulajs[name]
    fns[name] = (...args) => {
      const r = impl(...args.map((a) => (a && typeof a === 'object' && 'value' in a ? a.value : a)))
      if (r instanceof Error) throw new Error(r.message || '#VALUE!')
      return r
    }
  }
  return fns
}

const argv = typeof Bare !== 'undefined' ? Bare.argv.slice(2) : process.argv.slice(2)
const seed = Number(argv[0] || 1)

// Inputs are what a CRDT cell would hold: raw strings, formulas start with '='.
const inputs = {
  A1: '1', A2: '2', A3: '3.1', A4: '0.1', A5: '0.2', A6: '-7.25', A7: '1e21', A8: 'apple', A9: 'Banana', A10: '',
  B1: '45292', // 2024-01-01 as an Excel serial
  B2: '45351', // 2024-02-29
  B3: '100000', B4: '0.05', B5: '30'
}

const formulas = {
  C1: '=SUM(A1:A6)',
  C2: '=A4+A5',
  C3: '=AVERAGE(A1:A6)',
  C4: '=ROUND(A3*A6, 2)',
  C5: '=A7*A7',
  C6: '=1/3',
  C7: '=SQRT(2)',
  C8: '=EXP(1)',
  C9: '=LN(10)',
  C10: '=SIN(1)',
  C11: '=POWER(1.1, 30)',
  C12: '=ATAN2(1, 2)',
  C13: '=STDEV(A1:A6)',
  C14: '=PRODUCT(A1:A6)',
  C15: '=MOD(-7, 3)',
  C16: '=1/0',
  C17: '=A8&" "&A9',
  C18: '=UPPER(A9)',
  C19: '=LEN(A8)',
  C20: '=IF(A1>A2, "yes", "no")',
  C21: '=VLOOKUP(2, A1:A6, 1, FALSE)',
  C22: '=MAX(A1:A6)-MIN(A1:A6)',
  C23: '=COUNTIF(A1:A9, ">1")',
  C24: '=SUMIF(A1:A6, ">0")',
  C25: '=YEAR(B2)',
  C26: '=MONTH(B2)',
  C27: '=DAY(B2)',
  C28: '=WEEKDAY(B1)',
  C29: '=DATE(2024, 3, 31)',
  C30: '=EOMONTH(B1, 1)',
  C31: '=DATEDIF(B1, B2, "D")',
  C32: '=TEXT(B1, "yyyy-mm-dd")',
  C33: '=DATEVALUE("2024-03-10")',
  C34: '=WEEKNUM(B2)',
  C35: '=PMT(B4/12, B5*12, -B3)',
  C36: '=FV(B4/12, 12, -100)',
  C37: '=NPV(0.1, A1:A3)',
  C38: '=C1*2',
  C39: '=C38+C1',
  C40: '=D1+1', // cycle with D1
  D1: '=C40+1',
  C41: '=SUM(A1:A6)/COUNT(A1:A6)',
  C42: '=EXACT(A8, "apple")',
  C43: '=A9<A8',
  C44: '=TRUNC(PI()*1000000)/1000000',
  C45: '=ISNUMBER(A10)',
  C46: '=A10+1',
  C47: '="10"+5',
  C48: '=SUMPRODUCT(A1:A3, A4:A6)',
  C49: '=RATE(36, -300, 10000)',
  C50: '=NOW()',
  C51: '=TODAY()',
  C52: '=RAND()'
}

const VOLATILE = new Set(['C50', 'C51', 'C52'])

function colToNum (s) { let n = 0; for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64); return n }
function numToCol (n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26) } return s }
function addr (row, col) { return numToCol(col) + row }
function parseAddr (a) { const m = /^([A-Z]+)(\d+)$/.exec(a); return { col: colToNum(m[1]), row: Number(m[2]) } }

function literal (raw) {
  if (raw === undefined || raw === '') return null
  const n = Number(raw)
  return raw.trim() !== '' && Number.isFinite(n) ? n : raw
}

// Recalc engine shared by both parsers. evaluateCell is memoized per pass and
// detects cycles, so results do not depend on the order cells are visited.
function makeEngine (sheet, evaluateFormula) {
  const cache = new Map()
  const visiting = new Set()
  function value (a) {
    if (cache.has(a)) return cache.get(a)
    const raw = sheet[a]
    if (typeof raw !== 'string' || raw[0] !== '=') { const v = literal(raw); cache.set(a, v); return v }
    if (visiting.has(a)) return { error: '#CIRCULAR' }
    visiting.add(a)
    let v
    try { v = evaluateFormula(raw.slice(1), parseAddr(a), value) } catch (err) { v = { error: '#ERR:' + (err.message || String(err)).slice(0, 40) } }
    visiting.delete(a)
    // A cell that reads a cycle is itself in error.
    cache.set(a, v)
    return v
  }
  return { value }
}

function fastEvaluate (fill = false) {
  let current = null
  const parser = new FastParser({
    functions: fill ? fillFunctions() : {},
    onCell: ({ row, col }) => current(addr(row, col)),
    onRange: (ref) => {
      const rows = []
      for (let r = ref.from.row; r <= ref.to.row; r++) {
        const row = []
        for (let c = ref.from.col; c <= ref.to.col; c++) row.push(current(addr(r, c)))
        rows.push(row)
      }
      return rows
    }
  })
  return (formula, pos, value) => {
    const prev = current
    current = (a) => { const v = value(a); if (v && v.error) throw new Error(v.error); return v }
    try {
      return parser.parse(formula, { row: pos.row, col: pos.col, sheet: 'Sheet1' })
    } finally { current = prev }
  }
}

function hotEvaluate () {
  const parser = new HotParser()
  let current = null
  parser.on('callCellValue', (coord, done) => done(current(addr(coord.row.index + 1, coord.column.index + 1))))
  parser.on('callRangeValue', (start, end, done) => {
    const rows = []
    for (let r = start.row.index; r <= end.row.index; r++) {
      const row = []
      for (let c = start.column.index; c <= end.column.index; c++) row.push(current(addr(r + 1, c + 1)))
      rows.push(row)
    }
    done(rows)
  })
  return (formula, pos, value) => {
    const prev = current
    current = (a) => { const v = value(a); if (v && v.error) return v.error; return v }
    try {
      const { error, result } = parser.parse(formula)
      return error ? { error } : result
    } finally { current = prev }
  }
}

function normalize (v) {
  if (v instanceof Date) return { date: v.toISOString() }
  if (v && typeof v === 'object' && 'error' in v) return { error: String(v.error) }
  if (v && typeof v === 'object' && v.constructor && v.constructor.name === 'FormulaError') return { error: v.error || String(v) }
  if (typeof v === 'number') return Object.is(v, -0) ? 0 : v
  return v
}

function shuffle (arr, s) {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) { s = (s * 1103515245 + 12345) % 2147483648; const j = s % (i + 1); [a[i], a[j]] = [a[j], a[i]] }
  return a
}

function run (name, makeEval) {
  // Build the sheet in a seed-dependent insertion order and visit cells in a
  // seed-dependent order, to show neither affects the result.
  const sheet = {}
  for (const k of shuffle(Object.keys({ ...inputs, ...formulas }), seed)) sheet[k] = inputs[k] ?? formulas[k]
  const engine = makeEngine(sheet, makeEval())
  const results = {}
  const t = Date.now()
  for (const k of shuffle(Object.keys(formulas), seed + 7)) results[k] = normalize(engine.value(k))
  const ms = Date.now() - t
  const sorted = {}
  for (const k of Object.keys(results).sort((x, y) => parseAddr(x).row - parseAddr(y).row || x.localeCompare(y))) {
    sorted[k] = VOLATILE.has(k) ? '(volatile)' : results[k]
  }
  return { ms, results: sorted, volatileSample: { C50: results.C50, C51: results.C51, C52: results.C52 } }
}

// Dependency extraction (needed to recalc only what changed after a remote edit).
function deps () {
  const dp = new DepParser({ onVariable: () => null })
  return dp.parse('SUM(A1:A3)+C1*B2', { row: 9, col: 9, sheet: 'Sheet1' })
}

// Throughput: a 10,000-cell column of =A{n-1}+1 chains, fast parser only.
function bench () {
  const sheet = { A1: '1' }
  for (let r = 2; r <= 2000; r++) sheet['A' + r] = '=A' + (r - 1) + '+1'
  const engine = makeEngine(sheet, fastEvaluate())
  const t = Date.now()
  // Walk upward so the memo fills bottom-first without blowing the stack.
  for (let r = 2; r <= 2000; r++) engine.value('A' + r)
  return { cells: 2000, ms: Date.now() - t, last: engine.value('A2000') }
}

let tz = null
try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone } catch { tz = 'no-Intl' }
const out = {
  runtime: typeof Bare !== 'undefined' ? 'bare ' + Bare.platform : 'node ' + process.version,
  tz,
  tzOffsetMin: new Date(2024, 0, 1).getTimezoneOffset(),
  seed,
  fast: run('fast', fastEvaluate),
  hot: run('hot', hotEvaluate),
  combo: run('combo', () => fastEvaluate(true)),
  fastFunctionCount: new FastParser().supportedFunctions().length,
  deps: deps(),
  bench: bench()
}
console.log(JSON.stringify(out, null, 1))
