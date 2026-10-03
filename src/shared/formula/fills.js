// Functions fast-formula-parser lists but ships as empty stubs (or gets
// wrong), filled from @formulajs/formulajs. Never take date functions from
// formulajs: they use the device's local timezone, so two people in different
// timezones would see different answers. See spikes/formula/RESULTS.md.

const formulajs = require('@formulajs/formulajs')
const FormulaError = require('./vendor/fast-formula-parser/formulas/error')

// name -> formulajs implementation
const FILLS = {
  COUNTIF: formulajs.COUNTIF, // upstream counts text against numeric criteria
  COUNTIFS: formulajs.COUNTIFS,
  SUMIFS: formulajs.SUMIFS,
  AVERAGEIF: formulajs.AVERAGEIF,
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
  IRR: formulajs.IRR
}

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
  const out = { MATCH }
  for (const [name, impl] of Object.entries(FILLS)) {
    if (typeof impl !== 'function') throw new Error('formulajs has no ' + name)
    out[name] = wrap(name, impl)
  }
  return out
}

module.exports = { fillFunctions, FILLS }
