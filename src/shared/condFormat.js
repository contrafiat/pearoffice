// Conditional formatting (proposals/2026-10-04-sheet-tools.md): which cells
// a tab's rules colour, worked out on each device from the merged values,
// and the rules to and from .xlsx. Pure functions.
//
// A rule: { range, kind, ...params, style } where style is { color, fill,
// b, i, s }, or for kind 'scale' { colors: [low, (mid,) high] } and for
// kind 'bar' { color }. Rules come in priority order (first wins, attribute
// by attribute, as in Excel).

const KINDS = ['gt', 'lt', 'between', 'eq', 'text', 'date', 'dup', 'unique', 'top', 'bottom', 'above', 'below', 'blank', 'notBlank', 'scale', 'bar']
const TEXT_OPS = ['contains', 'notContains', 'begins', 'ends']
const PERIODS = ['yesterday', 'today', 'tomorrow', 'last7', 'lastWeek', 'thisWeek', 'nextWeek', 'lastMonth', 'thisMonth', 'nextMonth']
const HEX = /^#[0-9a-f]{6}$/i
const STYLE_KEYS = ['color', 'fill', 'b', 'i', 's']
const MAX_BLANK_SCAN = 20000

function cleanStyle (style) {
  const out = {}
  for (const k of ['color', 'fill']) if (style && HEX.test(style[k] || '')) out[k] = style[k].toLowerCase()
  for (const k of ['b', 'i', 's']) if (style && style[k] === true) out[k] = true
  return out
}

// Check and tidy a rule. Throws on a bad one.
function normalize (rule) {
  if (!rule || !KINDS.includes(rule.kind)) throw new Error('Pick a kind of rule')
  const out = { kind: rule.kind }
  const num = (v, what) => { const n = Number(String(v === undefined || v === null ? '' : v).trim()); if (String(v === undefined || v === null ? '' : v).trim() === '' || !Number.isFinite(n)) throw new Error(what + ' must be a number'); return n }
  switch (rule.kind) {
    case 'gt': case 'lt': case 'eq': out.a = String(rule.a === undefined ? '' : rule.a).trim(); if (out.a === '') throw new Error('Enter a value'); break
    case 'between': out.a = num(rule.a, 'The first value'); out.b = num(rule.b, 'The second value'); break
    case 'text': out.op = TEXT_OPS.includes(rule.op) ? rule.op : 'contains'; out.text = String(rule.text || ''); if (!out.text) throw new Error('Enter the text to look for'); break
    case 'date': out.period = PERIODS.includes(rule.period) ? rule.period : 'today'; break
    case 'top': case 'bottom': out.n = Math.max(1, Math.min(1000, Math.round(num(rule.n, 'How many')))); out.percent = rule.percent === true; break
    case 'scale': {
      const colors = (rule.colors || []).filter((c) => HEX.test(c)).map((c) => c.toLowerCase())
      if (colors.length !== 2 && colors.length !== 3) throw new Error('A colour scale needs two or three colours')
      out.colors = colors
      return out
    }
    case 'bar': if (!HEX.test(rule.color || '')) throw new Error('Pick a colour for the bars'); out.color = rule.color.toLowerCase(); return out
  }
  out.style = cleanStyle(rule.style)
  if (!Object.keys(out.style).length) throw new Error('Pick how matching cells look')
  return out
}

// --- matching ------------------------------------------------------------

const isBlank = (c) => !c || c.display === '' || c.kind === 'empty'
const numOf = (c) => (c && c.kind === 'number' && typeof c.num === 'number' ? c.num : null)
const textOf = (c) => (c ? String(c.display) : '')

// Is a date serial in a period, given today's serial? Weeks start Sunday.
function inPeriod (period, day, today) {
  const d = Math.floor(day)
  const weekday = (t) => ((t - 1) % 7 + 7) % 7 // 0 = Sunday (serial 1 was a Sunday)
  const sunday = today - weekday(today)
  const ym = (t) => { const x = new Date((t - 25569) * 86400000); return x.getUTCFullYear() * 12 + x.getUTCMonth() }
  switch (period) {
    case 'yesterday': return d === today - 1
    case 'today': return d === today
    case 'tomorrow': return d === today + 1
    case 'last7': return d > today - 7 && d <= today
    case 'lastWeek': return d >= sunday - 7 && d < sunday
    case 'thisWeek': return d >= sunday && d < sunday + 7
    case 'nextWeek': return d >= sunday + 7 && d < sunday + 14
    case 'lastMonth': return ym(d) === ym(today) - 1
    case 'thisMonth': return ym(d) === ym(today)
    case 'nextMonth': return ym(d) === ym(today) + 1
    default: return false
  }
}

// Compare a cell with a typed value: as numbers when both are, else as text
// ignoring case.
function cmp (cell, a) {
  const n = numOf(cell)
  const an = Number(String(a).trim())
  if (n !== null && String(a).trim() !== '' && Number.isFinite(an)) return n - an
  const x = textOf(cell).toLowerCase()
  const y = String(a).toLowerCase()
  return x < y ? -1 : x > y ? 1 : 0
}

// The cells of a range: [{ row, col, cell }]. Blank-matching rules look at
// every position (up to a limit); the rest only at cells with something.
function cellsIn (range, cells, withBlanks) {
  const out = []
  const area = (range.r2 - range.r1 + 1) * (range.c2 - range.c1 + 1)
  if (withBlanks && area <= MAX_BLANK_SCAN) {
    for (let r = range.r1; r <= range.r2; r++) for (let c = range.c1; c <= range.c2; c++) out.push({ row: r, col: c, cell: cells.get(r + ',' + c) || null })
    return out
  }
  for (const [key, cell] of cells) {
    if (cell.row >= range.r1 && cell.row <= range.r2 && cell.col >= range.c1 && cell.col <= range.c2) out.push({ row: cell.row, col: cell.col, cell, key })
  }
  return out
}

// Which cells of its range one rule matches: Set of "row,col".
function matches (rule, items, today) {
  const hit = new Set()
  const add = (x) => hit.add(x.row + ',' + x.col)
  const nums = () => items.map((x) => numOf(x.cell)).filter((n) => n !== null)
  switch (rule.kind) {
    case 'gt': for (const x of items) if (!isBlank(x.cell) && cmp(x.cell, rule.a) > 0) add(x); break
    case 'lt': for (const x of items) if (!isBlank(x.cell) && cmp(x.cell, rule.a) < 0) add(x); break
    case 'eq': for (const x of items) if (!isBlank(x.cell) && cmp(x.cell, rule.a) === 0) add(x); break
    case 'between': {
      const lo = Math.min(rule.a, rule.b)
      const hi = Math.max(rule.a, rule.b)
      for (const x of items) { const n = numOf(x.cell); if (n !== null && n >= lo && n <= hi) add(x) }
      break
    }
    case 'text': {
      const t = rule.text.toLowerCase()
      for (const x of items) {
        if (isBlank(x.cell) && rule.op !== 'notContains') continue
        const s = textOf(x.cell).toLowerCase()
        const ok = rule.op === 'contains' ? s.includes(t) : rule.op === 'notContains' ? !s.includes(t) : rule.op === 'begins' ? s.startsWith(t) : s.endsWith(t)
        if (ok) add(x)
      }
      break
    }
    case 'date': for (const x of items) { const n = numOf(x.cell); if (n !== null && inPeriod(rule.period, n, today)) add(x) } break
    case 'dup': case 'unique': {
      const count = new Map()
      for (const x of items) if (!isBlank(x.cell)) { const k = textOf(x.cell).toLowerCase(); count.set(k, (count.get(k) || 0) + 1) }
      for (const x of items) if (!isBlank(x.cell)) { const c = count.get(textOf(x.cell).toLowerCase()); if (rule.kind === 'dup' ? c > 1 : c === 1) add(x) }
      break
    }
    case 'top': case 'bottom': {
      const sorted = nums().sort((p, q) => (rule.kind === 'top' ? q - p : p - q))
      if (!sorted.length) break
      const k = rule.percent ? Math.max(1, Math.floor(sorted.length * rule.n / 100)) : rule.n
      const cut = sorted[Math.min(k, sorted.length) - 1]
      for (const x of items) { const n = numOf(x.cell); if (n !== null && (rule.kind === 'top' ? n >= cut : n <= cut)) add(x) }
      break
    }
    case 'above': case 'below': {
      const list = nums()
      if (!list.length) break
      let sum = 0
      for (const n of list) sum += n
      const avg = sum / list.length
      for (const x of items) { const n = numOf(x.cell); if (n !== null && (rule.kind === 'above' ? n > avg : n < avg)) add(x) }
      break
    }
    case 'blank': for (const x of items) if (isBlank(x.cell)) add(x); break
    case 'notBlank': for (const x of items) if (!isBlank(x.cell)) add(x); break
  }
  return hit
}

const mix = (a, b, t) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - t) + parseInt(b.slice(i, i + 2), 16) * t).toString(16).padStart(2, '0')).join('')

// rules: in priority order, each with r1, c1, r2, c2. cells: Map "row,col"
// -> { row, col, kind, num, display }. today: today's date serial.
// Returns Map "row,col" -> { color, fill, b, i, s, bar: { from, to, color } }.
function evaluate (rules, cells, today) {
  const out = new Map()
  const put = (key, k, v) => {
    let s = out.get(key)
    if (!s) { s = {}; out.set(key, s) }
    if (s[k] === undefined) s[k] = v
  }
  for (const rule of rules) {
    const items = cellsIn(rule, cells, rule.kind === 'blank' || (rule.kind === 'text' && rule.op === 'notContains'))
    if (rule.kind === 'scale' || rule.kind === 'bar') {
      const withNum = items.filter((x) => numOf(x.cell) !== null)
      if (!withNum.length) continue
      let lo = Infinity
      let hi = -Infinity
      for (const x of withNum) { const n = numOf(x.cell); if (n < lo) lo = n; if (n > hi) hi = n }
      for (const x of withNum) {
        const n = numOf(x.cell)
        const key = x.row + ',' + x.col
        if (rule.kind === 'bar') {
          // Bars grow from zero, or from the lowest value when all are above it.
          const base = Math.min(0, lo)
          const top = Math.max(0, hi)
          const span = top - base || 1
          put(key, 'bar', { from: (Math.min(0, n) - base) / span, to: (Math.max(0, n) - base) / span, color: rule.color })
          continue
        }
        const t = hi === lo ? 0.5 : (n - lo) / (hi - lo)
        const c = rule.colors
        put(key, 'fill', c.length === 2 ? mix(c[0], c[1], t) : t <= 0.5 ? mix(c[0], c[1], t * 2) : mix(c[1], c[2], (t - 0.5) * 2))
      }
      continue
    }
    for (const key of matches(rule, items, today)) for (const k of STYLE_KEYS) if (rule.style[k] !== undefined) put(key, k, rule.style[k])
  }
  return out
}

// A short description of a rule, for the list of rules.
function describe (rule) {
  const pct = rule.percent ? '%' : ''
  switch (rule.kind) {
    case 'gt': return 'Greater than ' + rule.a
    case 'lt': return 'Less than ' + rule.a
    case 'eq': return 'Equal to ' + rule.a
    case 'between': return 'Between ' + rule.a + ' and ' + rule.b
    case 'text': return { contains: 'Contains', notContains: 'Does not contain', begins: 'Starts with', ends: 'Ends with' }[rule.op] + ' "' + rule.text + '"'
    case 'date': return 'A date ' + { yesterday: 'yesterday', today: 'today', tomorrow: 'tomorrow', last7: 'in the last 7 days', lastWeek: 'last week', thisWeek: 'this week', nextWeek: 'next week', lastMonth: 'last month', thisMonth: 'this month', nextMonth: 'next month' }[rule.period]
    case 'dup': return 'Duplicate values'
    case 'unique': return 'Unique values'
    case 'top': return 'Top ' + rule.n + pct
    case 'bottom': return 'Bottom ' + rule.n + pct
    case 'above': return 'Above average'
    case 'below': return 'Below average'
    case 'blank': return 'Blank'
    case 'notBlank': return 'Not blank'
    case 'scale': return 'Colour scale'
    case 'bar': return 'Data bars'
    default: return rule.kind
  }
}

// --- .xlsx ---------------------------------------------------------------

const esc = (x) => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const unesc = (x) => String(x).replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
const quote = (t) => '"' + String(t).replace(/"/g, '""') + '"'
const argb = (hex) => 'FF' + hex.slice(1).toUpperCase()
const XLSX_PERIOD = { yesterday: 'yesterday', today: 'today', tomorrow: 'tomorrow', last7: 'last7Days', lastWeek: 'lastWeek', thisWeek: 'thisWeek', nextWeek: 'nextWeek', lastMonth: 'lastMonth', thisMonth: 'thisMonth', nextMonth: 'nextMonth' }
const TEXT_TYPE = { contains: 'containsText', notContains: 'notContainsText', begins: 'beginsWith', ends: 'endsWith' }
const TEXT_OP = { contains: 'containsText', notContains: 'notContains', begins: 'beginsWith', ends: 'endsWith' }

// Excel's formulas for each time period, for the top-left cell `a`.
function periodFormula (p, a) {
  const d = 'FLOOR(' + a + ',1)'
  const r = 'ROUNDDOWN(' + a + ',0)'
  switch (p) {
    case 'yesterday': return d + '=TODAY()-1'
    case 'today': return d + '=TODAY()'
    case 'tomorrow': return d + '=TODAY()+1'
    case 'last7': return 'AND(TODAY()-' + d + '<=6,' + d + '<=TODAY())'
    case 'lastWeek': return 'AND(TODAY()-' + r + '>=(WEEKDAY(TODAY())),TODAY()-' + r + '<(WEEKDAY(TODAY())+7))'
    case 'thisWeek': return 'AND(TODAY()-' + r + '<=WEEKDAY(TODAY())-1,' + r + '-TODAY()<=7-WEEKDAY(TODAY()))'
    case 'nextWeek': return 'AND(' + r + '-TODAY()>(7-WEEKDAY(TODAY())),' + r + '-TODAY()<(15-WEEKDAY(TODAY())))'
    case 'lastMonth': return 'AND(MONTH(' + a + ')=MONTH(EDATE(TODAY(),0-1)),YEAR(' + a + ')=YEAR(EDATE(TODAY(),0-1)))'
    case 'thisMonth': return 'AND(MONTH(' + a + ')=MONTH(TODAY()),YEAR(' + a + ')=YEAR(TODAY()))'
    case 'nextMonth': return 'AND(MONTH(' + a + ')=MONTH(EDATE(TODAY(),0+1)),YEAR(' + a + ')=YEAR(EDATE(TODAY(),0+1)))'
  }
  return 'FALSE'
}

// A rule's look as an Excel dxf (the differential style a rule applies).
function dxfXml (style) {
  const font = (style.b ? '<b/>' : '') + (style.i ? '<i/>' : '') + (style.s ? '<strike/>' : '') + (style.color ? '<color rgb="' + argb(style.color) + '"/>' : '')
  return '<dxf>' + (font ? '<font>' + font + '</font>' : '') + (style.fill ? '<fill><patternFill><bgColor rgb="' + argb(style.fill) + '"/></patternFill></fill>' : '') + '</dxf>'
}

// rules (priority order, with range and r1/c1) -> <conditionalFormatting>
// elements. dxfId(style) gives each style's number in styles.xml.
function toXlsx (rules, dxfId) {
  return rules.map((r, i) => {
    const a = r.range.split(':')[0].replace(/\$/g, '')
    const pri = ' priority="' + (i + 1) + '"'
    const dxf = r.style ? ' dxfId="' + dxfId(r.style) + '"' : ''
    const value = (v) => (String(v).trim() !== '' && Number.isFinite(Number(v)) ? String(Number(v)) : esc(quote(v)))
    let rule
    switch (r.kind) {
      case 'gt': case 'lt': case 'eq':
        rule = '<cfRule type="cellIs"' + dxf + pri + ' operator="' + { gt: 'greaterThan', lt: 'lessThan', eq: 'equal' }[r.kind] + '"><formula>' + value(r.a) + '</formula></cfRule>'
        break
      case 'between': rule = '<cfRule type="cellIs"' + dxf + pri + ' operator="between"><formula>' + r.a + '</formula><formula>' + r.b + '</formula></cfRule>'; break
      case 'text': {
        const t = quote(r.text)
        const f = { contains: 'NOT(ISERROR(SEARCH(' + t + ',' + a + ')))', notContains: 'ISERROR(SEARCH(' + t + ',' + a + '))', begins: 'LEFT(' + a + ',LEN(' + t + '))=' + t, ends: 'RIGHT(' + a + ',LEN(' + t + '))=' + t }[r.op]
        rule = '<cfRule type="' + TEXT_TYPE[r.op] + '"' + dxf + pri + ' operator="' + TEXT_OP[r.op] + '" text="' + esc(r.text) + '"><formula>' + esc(f) + '</formula></cfRule>'
        break
      }
      case 'date': rule = '<cfRule type="timePeriod"' + dxf + pri + ' timePeriod="' + XLSX_PERIOD[r.period] + '"><formula>' + esc(periodFormula(r.period, a)) + '</formula></cfRule>'; break
      case 'dup': rule = '<cfRule type="duplicateValues"' + dxf + pri + '/>'; break
      case 'unique': rule = '<cfRule type="uniqueValues"' + dxf + pri + '/>'; break
      case 'top': case 'bottom': rule = '<cfRule type="top10"' + dxf + pri + (r.percent ? ' percent="1"' : '') + (r.kind === 'bottom' ? ' bottom="1"' : '') + ' rank="' + r.n + '"/>'; break
      case 'above': rule = '<cfRule type="aboveAverage"' + dxf + pri + '/>'; break
      case 'below': rule = '<cfRule type="aboveAverage"' + dxf + pri + ' aboveAverage="0"/>'; break
      case 'blank': rule = '<cfRule type="containsBlanks"' + dxf + pri + '><formula>LEN(TRIM(' + a + '))=0</formula></cfRule>'; break
      case 'notBlank': rule = '<cfRule type="notContainsBlanks"' + dxf + pri + '><formula>LEN(TRIM(' + a + '))&gt;0</formula></cfRule>'; break
      case 'scale': {
        const vo = r.colors.length === 3 ? '<cfvo type="min"/><cfvo type="percentile" val="50"/><cfvo type="max"/>' : '<cfvo type="min"/><cfvo type="max"/>'
        rule = '<cfRule type="colorScale"' + pri + '><colorScale>' + vo + r.colors.map((c) => '<color rgb="' + argb(c) + '"/>').join('') + '</colorScale></cfRule>'
        break
      }
      case 'bar': rule = '<cfRule type="dataBar"' + pri + '><dataBar><cfvo type="min"/><cfvo type="max"/><color rgb="' + argb(r.color) + '"/></dataBar></cfRule>'; break
      default: return ''
    }
    return '<conditionalFormatting sqref="' + r.range.replace(/\$/g, '') + '">' + rule + '</conditionalFormatting>'
  }).join('')
}

// A worksheet's XML -> [{ range, ...rule }] in priority order, for the
// kinds PearSheet has. dxfs: the workbook's dxf styles in order.
function fromXlsx (xml, dxfs) {
  const found = []
  for (const m of String(xml).matchAll(/<conditionalFormatting\s[^>]*?sqref="([^"]+)"[^>]*>([\s\S]*?)<\/conditionalFormatting>/g)) {
    for (const r of m[2].matchAll(/<cfRule\s([^>]*?)(?:\/>|>([\s\S]*?)<\/cfRule>)/g)) {
      const attr = (name) => { const x = new RegExp('(?:^|\\s)' + name + '="([^"]*)"').exec(r[1]); return x ? unesc(x[1]) : undefined }
      const body = r[2] || ''
      const formulas = [...body.matchAll(/<formula>([\s\S]*?)<\/formula>/g)].map((f) => unesc(f[1]).trim())
      const style = attr('dxfId') !== undefined ? dxfs[Number(attr('dxfId'))] || {} : {}
      const rgbs = [...body.matchAll(/<color\s[^>]*rgb="([0-9A-Fa-f]{6,8})"/g)].map((c) => '#' + c[1].slice(-6).toLowerCase())
      const unquote = (f) => (/^".*"$/.test(f) ? f.slice(1, -1).replace(/""/g, '"') : f)
      let rule = null
      switch (attr('type')) {
        case 'cellIs': {
          const kind = { greaterThan: 'gt', lessThan: 'lt', equal: 'eq', between: 'between' }[attr('operator')]
          if (kind === 'between') rule = { kind, a: formulas[0], b: formulas[1] }
          else if (kind) rule = { kind, a: unquote(formulas[0] || '') }
          break
        }
        case 'containsText': rule = { kind: 'text', op: 'contains', text: attr('text') }; break
        case 'notContainsText': rule = { kind: 'text', op: 'notContains', text: attr('text') }; break
        case 'beginsWith': rule = { kind: 'text', op: 'begins', text: attr('text') }; break
        case 'endsWith': rule = { kind: 'text', op: 'ends', text: attr('text') }; break
        case 'timePeriod': { const p = Object.keys(XLSX_PERIOD).find((k) => XLSX_PERIOD[k] === attr('timePeriod')); if (p) rule = { kind: 'date', period: p }; break }
        case 'duplicateValues': rule = { kind: 'dup' }; break
        case 'uniqueValues': rule = { kind: 'unique' }; break
        case 'top10': rule = { kind: attr('bottom') === '1' || attr('bottom') === 'true' ? 'bottom' : 'top', n: Number(attr('rank')) || 10, percent: attr('percent') === '1' || attr('percent') === 'true' }; break
        case 'aboveAverage': rule = { kind: attr('aboveAverage') === '0' || attr('aboveAverage') === 'false' ? 'below' : 'above' }; break
        // LibreOffice saves blank tests as a plain formula rule.
        case 'expression': {
          const f = (formulas[0] || '').replace(/\s+/g, '').replace(/\$/g, '')
          if (/^LEN\(TRIM\([A-Z]+\d+\)\)=0$/i.test(f)) rule = { kind: 'blank' }
          else if (/^LEN\(TRIM\([A-Z]+\d+\)\)>0$/i.test(f)) rule = { kind: 'notBlank' }
          break
        }
        case 'containsBlanks': rule = { kind: 'blank' }; break
        case 'notContainsBlanks': rule = { kind: 'notBlank' }; break
        case 'colorScale': rule = { kind: 'scale', colors: rgbs }; break
        case 'dataBar': rule = { kind: 'bar', color: rgbs[0] }; break
      }
      if (!rule) continue
      if (rule.kind !== 'scale' && rule.kind !== 'bar') rule.style = style
      const priority = Number(attr('priority')) || 0
      for (const range of m[1].split(/\s+/).filter(Boolean)) {
        try { found.push({ priority, rule: { range, ...normalize(rule) } }) } catch {}
      }
    }
  }
  return found.sort((x, y) => x.priority - y.priority).map((x) => x.rule)
}

module.exports = { KINDS, TEXT_OPS, PERIODS, normalize, evaluate, describe, inPeriod, dxfXml, toXlsx, fromXlsx }
