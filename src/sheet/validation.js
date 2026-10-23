// Data validation (proposals/2026-10-04-sheet-tools.md): what a rule allows
// in a cell, and rules to and from .xlsx. Pure functions, used by the
// worklet (marks for values that break a rule), the UI (checking what is
// typed) and the .xlsx export and import.

const KINDS = ['list', 'whole', 'decimal', 'date', 'time', 'length']
const OPS = ['between', 'notBetween', 'eq', 'ne', 'gt', 'lt', 'ge', 'le']
const XLSX_TYPE = { list: 'list', whole: 'whole', decimal: 'decimal', date: 'date', time: 'time', length: 'textLength' }
const XLSX_OP = { between: 'between', notBetween: 'notBetween', eq: 'equal', ne: 'notEqual', gt: 'greaterThan', lt: 'lessThan', ge: 'greaterThanOrEqual', le: 'lessThanOrEqual' }
const MAX_ITEMS = 500
// Coloured chips (proposals/2026-10-22-dropdown-chips.md): a list rule's
// `chips` draws each value as a pill, `colors` maps an item to one of these.
// Each has a light fill and text for files; the app draws its own shades
// for each theme.
const CHIP_COLORS = {
  grey: ['#e8eaed', '#3c4043'],
  red: ['#ffcfc9', '#b10202'],
  orange: ['#ffc8aa', '#753800'],
  yellow: ['#ffe5a0', '#473821'],
  green: ['#d4edbc', '#11734b'],
  teal: ['#c6efe9', '#0a5249'],
  blue: ['#bfe1f6', '#0a53a8'],
  purple: ['#e6cff2', '#5a3286'],
  pink: ['#f9cfe6', '#8a1c5c'],
  brown: ['#e6d5c9', '#5c3b23']
}
const CHIP_NAMES = Object.keys(CHIP_COLORS)

// A typed bound -> number: dates as yyyy-mm-dd or a serial, times as
// hh:mm[:ss] or a fraction of a day, the rest as numbers. NaN if neither.
function bound (kind, text) {
  const t = String(text === undefined || text === null ? '' : text).trim()
  if (kind === 'date') {
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t)
    if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000 + 25569
  }
  if (kind === 'time') {
    const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(t)
    if (m) return (+m[1] * 3600 + +m[2] * 60 + +(m[3] || 0)) / 86400
  }
  return t === '' ? NaN : Number(t)
}

// Check and tidy a rule from the UI or a file. Throws on a bad one.
function normalize (rule) {
  if (!rule || !KINDS.includes(rule.kind)) throw new Error('Pick what to allow')
  const out = { kind: rule.kind, onBad: rule.onBad === 'warn' ? 'warn' : 'stop' }
  if (rule.message) out.message = String(rule.message).slice(0, 255)
  if (rule.kind === 'list') {
    if (rule.source) out.source = String(rule.source).replace(/^=/, '').trim()
    else {
      const items = (Array.isArray(rule.items) ? rule.items : String(rule.items || '').split(/[\n,]/)).map((x) => String(x).trim()).filter(Boolean)
      if (!items.length) throw new Error('Add at least one item to the list')
      out.items = [...new Set(items)].slice(0, MAX_ITEMS)
    }
    out.dropdown = rule.dropdown !== false
    if (rule.chips === true) { out.chips = true; out.dropdown = true }
    // A colour for a typed item must be for one of its items; a list from a
    // range is only known when drawn.
    if (rule.colors && typeof rule.colors === 'object' && !Array.isArray(rule.colors)) {
      const colors = {}
      for (const [item, name] of Object.entries(rule.colors)) {
        if (Object.keys(colors).length >= MAX_ITEMS) break
        if (!CHIP_NAMES.includes(name) || item === '__proto__' || item.length > 255) continue
        if (out.items && !out.items.includes(item)) continue
        colors[item] = name
      }
      if (Object.keys(colors).length) out.colors = colors
    }
    return out
  }
  out.op = OPS.includes(rule.op) ? rule.op : 'between'
  out.a = String(rule.a === undefined || rule.a === null ? '' : rule.a).trim()
  if (Number.isNaN(bound(rule.kind, out.a))) throw new Error('The value to compare with is not a ' + (rule.kind === 'date' ? 'date (yyyy-mm-dd)' : rule.kind === 'time' ? 'time (hh:mm)' : 'number'))
  if (out.op === 'between' || out.op === 'notBetween') {
    out.b = String(rule.b === undefined || rule.b === null ? '' : rule.b).trim()
    if (Number.isNaN(bound(rule.kind, out.b))) throw new Error('The second value is not a ' + (rule.kind === 'date' ? 'date (yyyy-mm-dd)' : rule.kind === 'time' ? 'time (hh:mm)' : 'number'))
  }
  return out
}

function compare (op, x, a, b) {
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  switch (op) {
    case 'between': return x >= lo && x <= hi
    case 'notBetween': return x < lo || x > hi
    case 'eq': return x === a
    case 'ne': return x !== a
    case 'gt': return x > a
    case 'lt': return x < a
    case 'ge': return x >= a
    case 'le': return x <= a
    default: return true
  }
}

// What a typed, non-formula entry becomes (the engine's literal()).
const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i
function typed (raw) {
  if (raw === undefined || raw === null || raw === '') return { kind: 'empty', display: '' }
  if (raw[0] === "'") return { kind: 'text', display: raw.slice(1) }
  const t = raw.trim()
  if (NUMBER.test(t)) return { kind: 'number', num: Number(t), display: t }
  if (t.toUpperCase() === 'TRUE' || t.toUpperCase() === 'FALSE') return { kind: 'bool', display: t.toUpperCase() }
  return { kind: 'text', display: raw }
}

// Does a cell ({ kind, num, display }) pass a rule? Blank cells always do.
// items: the list's items when they come from a range.
function allows (rule, cell, items = rule.items) {
  if (!cell || cell.kind === 'empty' || cell.display === '') return true
  if (rule.kind === 'list') {
    const want = String(cell.display).toLowerCase()
    return (items || []).some((x) => String(x).toLowerCase() === want)
  }
  if (rule.kind === 'length') return compare(rule.op, String(cell.display).length, bound('length', rule.a), bound('length', rule.b))
  if (cell.kind !== 'number' || typeof cell.num !== 'number') return false
  let x = cell.num
  if (rule.kind === 'whole' && !Number.isInteger(x)) return false
  if (rule.kind === 'time') x = x - Math.floor(x)
  return compare(rule.op, x, bound(rule.kind, rule.a), bound(rule.kind, rule.b))
}

// The message shown when a typed value breaks a rule.
function explain (rule) {
  if (rule.message) return rule.message
  if (rule.kind === 'list') return 'Pick a value from the list.'
  const what = { whole: 'a whole number', decimal: 'a number', date: 'a date', time: 'a time', length: 'text whose length is' }[rule.kind]
  const words = { between: 'between ' + rule.a + ' and ' + rule.b, notBetween: 'not between ' + rule.a + ' and ' + rule.b, eq: 'equal to ' + rule.a, ne: 'not equal to ' + rule.a, gt: 'greater than ' + rule.a, lt: 'less than ' + rule.a, ge: rule.a + ' or more', le: rule.a + ' or less' }[rule.op]
  return 'Enter ' + what + ' ' + words + '.'
}

// --- .xlsx ---------------------------------------------------------------

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const unesc = (s) => String(s).replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
const xlsxBound = (kind, text) => { const n = bound(kind, text); return Number.isNaN(n) ? '0' : String(n) }

// rules: [{ range: 'A1:B5', ...rule }] -> <dataValidations>, or ''.
function toXlsx (rules) {
  const parts = rules.map((r) => {
    const attrs = ['type="' + XLSX_TYPE[r.kind] + '"']
    if (r.kind !== 'list' && r.op !== 'between') attrs.push('operator="' + XLSX_OP[r.op] + '"')
    if (r.onBad === 'warn') attrs.push('errorStyle="warning"')
    attrs.push('allowBlank="1"')
    if (r.kind === 'list' && r.dropdown === false) attrs.push('showDropDown="1"') // Excel's flag means "hide"
    attrs.push('showErrorMessage="1"')
    if (r.message) attrs.push('error="' + esc(r.message) + '"')
    attrs.push('sqref="' + String(r.range).replace(/\$/g, '') + '"')
    let f = ''
    if (r.kind === 'list') f = '<formula1>' + (r.source ? esc(r.source) : esc('"' + r.items.join(',').replace(/"/g, '""') + '"')) + '</formula1>'
    else {
      f = '<formula1>' + xlsxBound(r.kind, r.a) + '</formula1>'
      if (r.op === 'between' || r.op === 'notBetween') f += '<formula2>' + xlsxBound(r.kind, r.b) + '</formula2>'
    }
    return '<dataValidation ' + attrs.join(' ') + '>' + f + '</dataValidation>'
  })
  return parts.length ? '<dataValidations count="' + parts.length + '">' + parts.join('') + '</dataValidations>' : ''
}

// Bounds read from a file are numbers; show dates and times readably.
function fromSerial (kind, n) {
  if (kind === 'date' && Number.isInteger(n)) { const d = new Date((n - 25569) * 86400000); return d.toISOString().slice(0, 10) }
  if (kind === 'time' && n >= 0 && n < 1) { const s = Math.round(n * 86400); return String(Math.floor(s / 3600)).padStart(2, '0') + ':' + String(Math.floor(s / 60) % 60).padStart(2, '0') }
  return String(n)
}

// A worksheet's XML -> [{ range, ...rule }] for the kinds PearOffice has.
function fromXlsx (xml) {
  const out = []
  const kindOf = Object.fromEntries(Object.entries(XLSX_TYPE).map(([k, v]) => [v, k]))
  const opOf = Object.fromEntries(Object.entries(XLSX_OP).map(([k, v]) => [v, k]))
  for (const m of String(xml).matchAll(/<dataValidation\s([^>]*?)(?:\/>|>([\s\S]*?)<\/dataValidation>)/g)) {
    const attr = (name) => { const a = new RegExp('(?:^|\\s)' + name + '="([^"]*)"').exec(m[1]); return a ? unesc(a[1]) : undefined }
    const kind = kindOf[attr('type')]
    const sqref = attr('sqref')
    if (!kind || !sqref) continue
    const f1 = /<formula1>([\s\S]*?)<\/formula1>/.exec(m[2] || '')
    const f2 = /<formula2>([\s\S]*?)<\/formula2>/.exec(m[2] || '')
    const rule = { kind, onBad: attr('errorStyle') === 'warning' || attr('errorStyle') === 'information' ? 'warn' : 'stop' }
    if (attr('error')) rule.message = attr('error')
    if (kind === 'list') {
      const text = f1 ? unesc(f1[1]).trim() : ''
      if (/^".*"$/.test(text)) rule.items = text.slice(1, -1).replace(/""/g, '"').split(',')
      else if (text) rule.source = text
      else continue
      rule.dropdown = attr('showDropDown') !== '1' && attr('showDropDown') !== 'true'
    } else {
      rule.op = opOf[attr('operator')] || 'between'
      const n1 = f1 ? Number(unesc(f1[1])) : NaN
      if (Number.isNaN(n1)) continue // a formula as the bound: not supported
      rule.a = fromSerial(kind, n1)
      if (rule.op === 'between' || rule.op === 'notBetween') {
        const n2 = f2 ? Number(unesc(f2[1])) : NaN
        if (Number.isNaN(n2)) continue
        rule.b = fromSerial(kind, n2)
      }
    }
    for (const range of sqref.split(/\s+/).filter(Boolean)) {
      try { out.push({ range, ...normalize(rule) }) } catch {}
    }
  }
  return out
}

// A cell's chip colour under a rule, or null when it is not drawn as a chip:
// no chip rule, empty, or a value not in the list. Matched without case, as
// allows() does. items: the list's items when they come from a range.
function chipColor (rule, cell, items = rule && rule.items) {
  if (!rule || rule.kind !== 'list' || !rule.chips || !cell || cell.display === '' || cell.kind === 'empty') return null
  const want = String(cell.display).toLowerCase()
  const item = (items || []).find((x) => String(x).toLowerCase() === want)
  if (item === undefined) return null
  const name = rule.colors && Object.prototype.hasOwnProperty.call(rule.colors, item) ? rule.colors[item] : null
  return CHIP_NAMES.includes(name) ? name : 'grey'
}

// The colour for the n-th item of a fresh list: every colour but grey in
// turn, so a new list comes out coloured.
const chipColorAt = (n) => CHIP_NAMES[1 + (n % (CHIP_NAMES.length - 1))]

// Colour rules that show a chip rule's colours in Excel and LibreOffice:
// one per coloured item, the fill and text when the cell equals it.
function chipRules (rules) {
  const out = []
  for (const r of rules) {
    if (r.kind !== 'list' || !r.chips) continue
    for (const item of r.items || []) {
      const name = (r.colors && Object.prototype.hasOwnProperty.call(r.colors, item) && r.colors[item]) || 'grey'
      const [fill, color] = CHIP_COLORS[name] || CHIP_COLORS.grey
      out.push({ kind: 'eq', a: item, style: { fill, color }, range: r.range, r1: r.r1, c1: r.c1, r2: r.r2, c2: r.c2 })
    }
  }
  return out
}

// The rule for a cell: the newest one whose range holds it.
function ruleFor (rules, row, col) {
  let found = null
  for (const r of rules) if (row >= r.r1 && row <= r.r2 && col >= r.c1 && col <= r.c2) found = r
  return found
}

module.exports = { KINDS, OPS, CHIP_COLORS, CHIP_NAMES, chipColor, chipColorAt, chipRules, bound, fromSerial, normalize, typed, allows, explain, ruleFor, toXlsx, fromXlsx }
