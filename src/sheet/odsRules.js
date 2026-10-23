// Colour rules and data validation in .ods files (LibreOffice and
// OpenOffice), and the filter a file was saved with. Written the way
// LibreOffice writes them: colour rules in its calcext:conditional-formats
// at the end of each sheet, each look a named cell style in styles.xml;
// validation in table:content-validations, each cell naming its rule.
//
// Rules here are PearOffice's (src/sheet/condFormat.js, validation.js), with
// formulas in the .xlsx file form (xlsxMap toFile/fromFile).

const { ICON_SETS } = require('./condFormat')
const { bound, fromSerial } = require('./validation')
const { toOds, fromOds } = require('./odsFormula')
const { parseRange } = require('./charts')
const { numToCol } = require('./a1')

const CALCEXT = 'urn:org:documentfoundation:names:experimental:calc:xmlns:calcext:1.0'
const MAX_ROWS = 10000 // validation reaches at most this far down in a file
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const unesc = (s) => String(s).replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
const attrOf = (tag, name) => { const m = new RegExp('\\s' + name + '="([^"]*)"').exec(tag || ''); return m ? unesc(m[1]) : null }
const quote = (t) => '"' + String(t).replace(/"/g, '""') + '"'
const sheetRef = (sheet) => "'" + String(sheet).replace(/'/g, "''") + "'."
// "B2:B5" on a sheet -> "'Sheet'.B2:'Sheet'.B5"
const odfRange = (range, sheet) => { const [a, b] = String(range).replace(/\$/g, '').split(':'); return sheetRef(sheet) + a + ':' + sheetRef(sheet) + (b || a) }
const odfFormula = (f) => toOds(f).replace(/^of:=/, '')
const value = (v) => (String(v).trim() !== '' && Number.isFinite(Number(v)) ? String(Number(v)) : quote(v))
const DATES = { yesterday: 'yesterday', today: 'today', tomorrow: 'tomorrow', last7: 'last-7-days', lastWeek: 'last-week', thisWeek: 'this-week', nextWeek: 'next-week', lastMonth: 'last-month', thisMonth: 'this-month', nextMonth: 'next-month' }
const TEXT = { contains: 'contains-text', notContains: 'not-contains-text', begins: 'begins-with', ends: 'ends-with' }

// A rule's look as a named cell style's properties.
function lookXml (style) {
  const cell = style.fill ? '<style:table-cell-properties fo:background-color="' + esc(style.fill) + '"/>' : ''
  const text = []
  if (style.color) text.push('fo:color="' + esc(style.color) + '"')
  if (style.b) text.push('fo:font-weight="bold" style:font-weight-asian="bold" style:font-weight-complex="bold"')
  if (style.i) text.push('fo:font-style="italic" style:font-style-asian="italic" style:font-style-complex="italic"')
  if (style.s) text.push('style:text-line-through-style="solid"')
  return cell + (text.length ? '<style:text-properties ' + text.join(' ') + '/>' : '')
}

// One tab's colour rules -> calcext XML, naming looks with look(style).
function conditionalXml (rules, sheet, look) {
  const parts = rules.map((r) => {
    const target = odfRange(r.range, sheet)
    const topLeft = String(r.range).replace(/\$/g, '').split(':')[0]
    const base = ' calcext:base-cell-address="' + esc(sheetRef(sheet) + topLeft) + '"'
    const cond = (v) => '<calcext:condition calcext:apply-style-name="' + look(r.style) + '" calcext:value="' + esc(v) + '"' + base + '/>'
    let inner
    switch (r.kind) {
      case 'gt': inner = cond('>' + value(r.a)); break
      case 'lt': inner = cond('<' + value(r.a)); break
      case 'eq': inner = cond('=' + value(r.a)); break
      case 'between': inner = cond('between(' + Number(r.a) + ',' + Number(r.b) + ')'); break
      case 'text': inner = cond(TEXT[r.op] + '(' + quote(r.text) + ')'); break
      case 'date': inner = '<calcext:date-is calcext:style="' + look(r.style) + '" calcext:date="' + DATES[r.period] + '"/>'; break
      case 'dup': inner = cond('duplicate'); break
      case 'unique': inner = cond('unique'); break
      case 'top': case 'bottom': inner = cond(r.kind + (r.percent ? '-percent(' : '-elements(') + r.n + ')'); break
      case 'above': inner = cond('above-average'); break
      case 'below': inner = cond('below-average'); break
      case 'blank': inner = cond('formula-is(LEN(TRIM([.' + topLeft + ']))=0)'); break
      case 'notBlank': inner = cond('formula-is(LEN(TRIM([.' + topLeft + ']))>0)'); break
      case 'formula': inner = cond('formula-is(' + odfFormula(r.formula) + ')'); break
      case 'scale': {
        const at = r.colors.length === 3 ? [['minimum', 0], ['percentile', 50], ['maximum', 0]] : [['minimum', 0], ['maximum', 0]]
        inner = '<calcext:color-scale>' + r.colors.map((c, i) => '<calcext:color-scale-entry calcext:value="' + at[i][1] + '" calcext:type="' + at[i][0] + '" calcext:color="' + esc(c) + '"/>').join('') + '</calcext:color-scale>'
        break
      }
      case 'bar':
        inner = '<calcext:data-bar calcext:min-length="10" calcext:max-length="90" calcext:negative-color="#ff0000" calcext:axis-position="none" calcext:positive-color="' + esc(r.color) + '" calcext:axis-color="#000000">' +
          '<calcext:formatting-entry calcext:value="0" calcext:type="minimum"/><calcext:formatting-entry calcext:value="0" calcext:type="maximum"/></calcext:data-bar>'
        break
      case 'icons': {
        const set = ICON_SETS[r.set] || ICON_SETS['3arrows']
        // LibreOffice writes show-value on the first entry but reads it from
        // the icon set (LibreOffice 26.2), so it goes in both places.
        inner = '<calcext:icon-set calcext:icon-set-type="' + set.xlsx + '"' + (r.iconOnly ? ' calcext:show-value="false"' : '') + '>' +
          [0, ...set.cuts].map((c, i) => '<calcext:formatting-entry' + (i === 0 && r.iconOnly ? ' calcext:show-value="false"' : '') + ' calcext:value="' + c + '" calcext:type="percent"/>').join('') + '</calcext:icon-set>'
        break
      }
      default: return ''
    }
    return '<calcext:conditional-format calcext:target-range-address="' + esc(target) + '">' + inner + '</calcext:conditional-format>'
  }).filter(Boolean)
  return parts.length ? '<calcext:conditional-formats>' + parts.join('') + '</calcext:conditional-formats>' : ''
}

const OP = { eq: '=', ne: '!=', gt: '>', lt: '<', ge: '>=', le: '<=' }
const TYPE = { whole: 'cell-content-is-whole-number()', decimal: 'cell-content-is-decimal-number()', date: 'cell-content-is-date()', time: 'cell-content-is-time()' }
const num = (kind, t) => { const n = bound(kind, t); return Number.isNaN(n) ? '0' : String(n) }

// One validation rule -> its table:condition.
function conditionOf (r, sheet) {
  if (r.kind === 'list') {
    if (r.source) {
      const box = parseRange(r.source)
      if (!box) return 'of:cell-content-is-in-list(' + quote('') + ')'
      const head = box.sheet ? "$'" + box.sheet.replace(/'/g, "''") + "'." : '.'
      return 'of:cell-content-is-in-list([' + head + '$' + numToCol(box.c1) + '$' + box.r1 + ':.$' + numToCol(box.c2) + '$' + box.r2 + '])'
    }
    return 'of:cell-content-is-in-list(' + r.items.map(quote).join(';') + ')'
  }
  const a = num(r.kind, r.a)
  const b = num(r.kind, r.b)
  if (r.kind === 'length') {
    if (r.op === 'between') return 'of:cell-content-text-length-is-between(' + a + ',' + b + ')'
    if (r.op === 'notBetween') return 'of:cell-content-text-length-is-not-between(' + a + ',' + b + ')'
    return 'of:cell-content-text-length()' + OP[r.op] + a
  }
  const cmp = r.op === 'between' ? 'cell-content-is-between(' + a + ',' + b + ')' : r.op === 'notBetween' ? 'cell-content-is-not-between(' + a + ',' + b + ')' : 'cell-content()' + OP[r.op] + a
  return 'of:' + TYPE[r.kind] + ' and ' + cmp
}

// Adds colour rules and validation to a .ods SheetJS wrote. tabs: [{
// condFormats, validations }] in sheet order; names: the sheets' names.
// Validated cells must be inside the range SheetJS wrote (writeOds makes sure).
function addRulesToOds (files, tabs, names, fflate) {
  if (!tabs.some((t) => (t.condFormats || []).length || (t.validations || []).length)) return
  let xml = fflate.strFromU8(files['content.xml'])
  if (!xml.includes('xmlns:calcext=')) xml = xml.replace('<office:document-content ', '<office:document-content xmlns:calcext="' + CALCEXT + '" ')

  // Looks of the colour rules, as named styles.
  const looks = new Map()
  const look = (style) => {
    const key = JSON.stringify(style || {})
    if (!looks.has(key)) looks.set(key, 'PearOfficeRule' + (looks.size + 1))
    return looks.get(key)
  }
  const conditional = tabs.map((t, i) => conditionalXml(t.condFormats || [], names[i], look))

  // Validation: one named rule per PearOffice rule; each cell in its range
  // names it (the last rule over a cell wins, as in PearOffice).
  const vals = []
  const cellVal = tabs.map(() => new Map())
  tabs.forEach((t, i) => {
    for (const r of t.validations || []) {
      const box = parseRange(r.range)
      if (!box) continue
      const name = 'val' + (vals.length + 1)
      const topLeft = numToCol(box.c1) + box.r1
      vals.push('<table:content-validation table:name="' + name + '" table:condition="' + esc(conditionOf(r, names[i])) + '" table:allow-empty-cell="true"' +
        (r.kind === 'list' ? ' table:display-list="' + (r.dropdown === false ? 'no' : 'unsorted') + '"' : '') + ' table:base-cell-address="' + esc(sheetRef(names[i]) + topLeft) + '">' +
        '<table:error-message table:message-type="' + (r.multi ? 'information' : r.onBad === 'warn' ? 'warning' : 'stop') + '" table:display="true">' + (r.message ? '<text:p>' + esc(r.message) + '</text:p>' : '') + '</table:error-message></table:content-validation>')
      for (let row = box.r1; row <= Math.min(box.r2, MAX_ROWS); row++) for (let c = box.c1; c <= box.c2; c++) cellVal[i].set((row - 1) + ',' + (c - 1), name)
    }
  })

  // Walk the tables: name each validated cell, and end each table with its
  // colour rules.
  let out = ''
  let last = 0
  let tab = -1
  let depth = 0
  let row = -1
  let col = 0
  const re = /<(\/?)table:(table-row|table-cell|covered-table-cell|table)(?=[\s/>])([^>]*?)(\/?)>/g
  let m
  while ((m = re.exec(xml))) {
    const [tag, close, kind, attrs, selfClose] = m
    if (kind === 'table') {
      if (close) {
        depth--
        if (depth === 0 && conditional[tab]) { out += xml.slice(last, m.index) + conditional[tab]; last = m.index }
        continue
      }
      depth++
      if (depth === 1) { tab++; row = -1 }
      continue
    }
    if (depth !== 1 || close) continue
    if (kind === 'table-row') { row++; col = 0; continue }
    const name = cellVal[tab] && cellVal[tab].get(row + ',' + col)
    col += Number(attrOf(attrs, 'table:number-columns-repeated')) || 1
    if (!name || kind !== 'table-cell') continue
    out += xml.slice(last, m.index) + '<table:table-cell' + attrs.replace(/\s+$/, '') + ' table:content-validation-name="' + name + '"' + (selfClose ? '/>' : '>')
    last = m.index + tag.length
  }
  xml = out + xml.slice(last)
  if (vals.length) {
    const at = xml.indexOf('<table:table ')
    xml = xml.slice(0, at) + '<table:content-validations>' + vals.join('') + '</table:content-validations>' + xml.slice(at)
  }
  files['content.xml'] = fflate.strToU8(xml)

  if (looks.size) {
    let styles = fflate.strFromU8(files['styles.xml'])
    const named = [...looks].map(([key, name]) => '<style:style style:name="' + name + '" style:family="table-cell" style:parent-style-name="Default">' + lookXml(JSON.parse(key)) + '</style:style>').join('')
    styles = styles.includes('</office:styles>') ? styles.replace('</office:styles>', named + '</office:styles>')
      : styles.replace('<office:master-styles>', '<office:styles>' + named + '</office:styles><office:master-styles>')
    files['styles.xml'] = fflate.strToU8(styles)
  }
}

// --- reading -------------------------------------------------------------------

// "'My tab'.A1:'My tab'.B9" (the first of a list) -> "A1:B9".
function plainRange (s) {
  let out = ''
  let q = false
  for (const ch of String(s || '').trim()) {
    if (ch === "'") q = !q
    if (/\s/.test(ch) && !q) break
    out += ch
  }
  return out.split(':').map((p) => p.replace(/^.*\./, '').replace(/\$/g, '')).join(':')
}

// The looks of named styles in styles.xml (and automatic ones in content.xml),
// by name and by display name.
function namedLooks (xml) {
  const out = {}
  for (const m of xml.matchAll(/<style:style\s([^>]*?)(?:\/>|>([\s\S]*?)<\/style:style>)/g)) {
    const tag = '<x ' + m[1] + '>'
    if (attrOf(tag, 'style:family') !== 'table-cell') continue
    const body = m[2] || ''
    const text = '<x ' + ((/<style:text-properties\s([^>]*?)\/?>/.exec(body) || [])[1] || '') + '>'
    const cell = '<x ' + ((/<style:table-cell-properties\s([^>]*?)\/?>/.exec(body) || [])[1] || '') + '>'
    const s = {}
    const color = (attrOf(text, 'fo:color') || '').toLowerCase()
    if (/^#[0-9a-f]{6}$/.test(color)) s.color = color
    const fill = (attrOf(cell, 'fo:background-color') || '').toLowerCase()
    if (/^#[0-9a-f]{6}$/.test(fill)) s.fill = fill
    if (attrOf(text, 'fo:font-weight') === 'bold') s.b = true
    if (attrOf(text, 'fo:font-style') === 'italic') s.i = true
    const strike = attrOf(text, 'style:text-line-through-style')
    if (strike && strike !== 'none') s.s = true
    for (const n of [attrOf(tag, 'style:name'), attrOf(tag, 'style:display-name')]) if (n) out[n] = s
  }
  return out
}

const unquote = (s) => (/^".*"$/.test(s) ? s.slice(1, -1).replace(/""/g, '"') : s)

// One calcext:condition value -> a PearOffice rule (without range and style),
// or null. topLeft: the range's first cell.
function ruleOf (v, topLeft) {
  let m
  const t = String(v).trim()
  if ((m = /^(contains-text|not-contains-text|begins-with|ends-with)\((".*")\)$/.exec(t))) return { kind: 'text', op: { 'contains-text': 'contains', 'not-contains-text': 'notContains', 'begins-with': 'begins', 'ends-with': 'ends' }[m[1]], text: unquote(m[2]) }
  if ((m = /^between\(([^,]+),([^)]+)\)$/.exec(t)) && Number.isFinite(Number(m[1])) && Number.isFinite(Number(m[2]))) return { kind: 'between', a: Number(m[1]), b: Number(m[2]) }
  if ((m = /^(top|bottom)-(elements|percent)\((\d+)\)$/.exec(t))) return { kind: m[1], n: Number(m[3]), percent: m[2] === 'percent' }
  if (t === 'duplicate') return { kind: 'dup' }
  if (t === 'unique') return { kind: 'unique' }
  if (t === 'above-average') return { kind: 'above' }
  if (t === 'below-average') return { kind: 'below' }
  if ((m = /^formula-is\((.*)\)$/.exec(t))) {
    const f = fromOds(m[1])
    if (new RegExp('^LEN\\(TRIM\\(\\$?' + topLeft.replace(/(\D+)(\d+)/, '$1\\$?$2') + '\\)\\)=0$').test(f)) return { kind: 'blank' }
    if (new RegExp('^LEN\\(TRIM\\(\\$?' + topLeft.replace(/(\D+)(\d+)/, '$1\\$?$2') + '\\)\\)>0$').test(f)) return { kind: 'notBlank' }
    return { kind: 'formula', formula: f }
  }
  if ((m = /^(>=|<=|!=|=|>|<)(.*)$/.exec(t))) {
    const a = unquote(m[2].trim())
    if (m[1] === '>') return { kind: 'gt', a: String(a) }
    if (m[1] === '<') return { kind: 'lt', a: String(a) }
    if (m[1] === '=') return { kind: 'eq', a: String(a) }
    // No kind of its own in PearOffice: as a formula on the first cell.
    return { kind: 'formula', formula: topLeft + (m[1] === '!=' ? '<>' : m[1]) + (/^".*"$/.test(m[2].trim()) ? m[2].trim() : a) }
  }
  if ((m = /^not-between\(([^,]+),([^)]+)\)$/.exec(t))) return { kind: 'formula', formula: 'OR(' + topLeft + '<' + m[1] + ',' + topLeft + '>' + m[2] + ')' }
  if (t === 'error') return { kind: 'formula', formula: 'ISERROR(' + topLeft + ')' }
  if (t === 'no-error') return { kind: 'formula', formula: 'NOT(ISERROR(' + topLeft + '))' }
  return null
}

const ICON_BY_XLSX = Object.fromEntries(Object.entries(ICON_SETS).map(([k, v]) => [v.xlsx, k]))
const DATE_BY_ODF = Object.fromEntries(Object.entries(DATES).map(([k, v]) => [v, k]))

// One tab's calcext:conditional-formats -> PearOffice rules in order.
function conditionalFrom (block, looks) {
  const rules = []
  for (const f of block.matchAll(/<calcext:conditional-format\s([^>]*)>([\s\S]*?)<\/calcext:conditional-format>/g)) {
    const range = plainRange(attrOf('<x ' + f[1] + '>', 'calcext:target-range-address'))
    if (!parseRange(range)) continue
    const topLeft = range.split(':')[0]
    const body = f[2]
    for (const c of body.matchAll(/<calcext:condition\s([^>]*?)\/?>/g)) {
      const tag = '<x ' + c[1] + '>'
      const rule = ruleOf(attrOf(tag, 'calcext:value') || '', topLeft)
      const style = looks[attrOf(tag, 'calcext:apply-style-name')]
      if (rule && style && Object.keys(style).length) rules.push({ range, ...rule, style })
    }
    for (const d of body.matchAll(/<calcext:date-is\s([^>]*?)\/?>/g)) {
      const tag = '<x ' + d[1] + '>'
      const period = DATE_BY_ODF[attrOf(tag, 'calcext:date')]
      const style = looks[attrOf(tag, 'calcext:style')]
      if (period && style && Object.keys(style).length) rules.push({ range, kind: 'date', period, style })
    }
    const scale = /<calcext:color-scale>([\s\S]*?)<\/calcext:color-scale>/.exec(body)
    if (scale) {
      const colors = [...scale[1].matchAll(/calcext:color="(#[0-9a-fA-F]{6})"/g)].map((x) => x[1].toLowerCase())
      if (colors.length === 2 || colors.length === 3) rules.push({ range, kind: 'scale', colors })
    }
    const bar = /<calcext:data-bar\s([^>]*)>/.exec(body)
    if (bar) {
      const color = (attrOf('<x ' + bar[1] + '>', 'calcext:positive-color') || '').toLowerCase()
      if (/^#[0-9a-f]{6}$/.test(color)) rules.push({ range, kind: 'bar', color })
    }
    const icons = /<calcext:icon-set\s([^>]*)>([\s\S]*?)<\/calcext:icon-set>/.exec(body)
    if (icons) {
      const set = ICON_BY_XLSX[attrOf('<x ' + icons[1] + '>', 'calcext:icon-set-type')]
      if (set) {
        const rule = { range, kind: 'icons', set }
        if (/calcext:show-value="false"/.test(icons[1] + icons[2])) rule.iconOnly = true
        rules.push(rule)
      }
    }
  }
  return rules
}

// One table:condition -> a validation rule (without range), or null.
function validationOf (cond, displayList, sheetName) {
  const c = String(cond || '').replace(/^of:/, '').trim()
  let m
  if ((m = /^cell-content-is-in-list\((.*)\)$/.exec(c))) {
    const inner = m[1].trim()
    if (inner[0] === '[') {
      const f = fromOds(inner)
      const box = parseRange(f)
      if (!box) return null
      const sheet = box.sheet && box.sheet.toUpperCase() !== String(sheetName).toUpperCase() ? "'" + box.sheet.replace(/'/g, "''") + "'!" : ''
      return { kind: 'list', source: sheet + numToCol(box.c1) + box.r1 + (box.r2 !== box.r1 || box.c2 !== box.c1 ? ':' + numToCol(box.c2) + box.r2 : ''), dropdown: displayList !== 'no' }
    }
    const items = [...inner.matchAll(/"((?:[^"]|"")*)"/g)].map((x) => x[1].replace(/""/g, '"')).filter(Boolean)
    return items.length ? { kind: 'list', items, dropdown: displayList !== 'no' } : null
  }
  let kind = null
  let rest = c
  for (const [k, fn] of Object.entries(TYPE)) if (c.startsWith(fn + ' and ')) { kind = k; rest = c.slice(fn.length + 5).trim() }
  if (!kind) {
    if ((m = /^cell-content-text-length-is-(between|not-between)\(([^,]+),([^)]+)\)$/.exec(c))) return { kind: 'length', op: m[1] === 'between' ? 'between' : 'notBetween', a: String(Number(m[2])), b: String(Number(m[3])) }
    if ((m = /^cell-content-text-length\(\)(>=|<=|!=|=|>|<)(.+)$/.exec(c))) return { kind: 'length', op: { '=': 'eq', '!=': 'ne', '>': 'gt', '<': 'lt', '>=': 'ge', '<=': 'le' }[m[1]], a: String(Number(m[2])) }
    return null
  }
  const show = (n) => fromSerial(kind, Number(n))
  if ((m = /^cell-content-is-(between|not-between)\(([^,]+),([^)]+)\)$/.exec(rest))) return { kind, op: m[1] === 'between' ? 'between' : 'notBetween', a: show(m[2]), b: show(m[3]) }
  if ((m = /^cell-content\(\)(>=|<=|!=|=|>|<)(.+)$/.exec(rest))) return { kind, op: { '=': 'eq', '!=': 'ne', '>': 'gt', '<': 'lt', '>=': 'ge', '<=': 'le' }[m[1]], a: show(m[2]) }
  return null
}

// Each tab's colour rules, validation and filter from a .ods file's parts, in
// tab order: { condFormats, validations, filter: 'A1:C9' or null }.
function rulesFromOds (files, fflate, names) {
  const read = (p) => (files[p] ? fflate.strFromU8(files[p]) : '')
  const xml = read('content.xml')
  const looks = { ...namedLooks(read('styles.xml')), ...namedLooks(xml) }
  const out = names.map(() => ({ condFormats: [], validations: [], filter: null }))

  // Validation rules by name.
  const defs = {}
  for (const v of xml.matchAll(/<table:content-validation\s([^>]*?)(?:\/>|>([\s\S]*?)<\/table:content-validation>)/g)) {
    const tag = '<x ' + v[1] + '>'
    const err = /<table:error-message\s([^>]*?)(?:\/>|>([\s\S]*?)<\/table:error-message>)/.exec(v[2] || '')
    const message = err && err[2] ? unesc(err[2].replace(/<[^>]+>/g, '')).trim() : ''
    defs[attrOf(tag, 'table:name')] = { cond: attrOf(tag, 'table:condition'), list: attrOf(tag, 'table:display-list'), warn: err ? attrOf('<x ' + err[1] + '>', 'table:message-type') !== 'stop' : false, message }
  }

  let tab = -1
  let depth = 0
  let row = 0
  let col = 0
  let rowRepeat = 1
  const boxes = names.map(() => ({})) // validation name -> box
  const re = /<(\/?)(table:table-row|table:table-cell|table:covered-table-cell|table:table|calcext:conditional-formats)(?=[\s/>])([^>]*?)(\/?)>/g
  let m
  while ((m = re.exec(xml))) {
    const [, close, kind, attrs, selfClose] = m
    if (kind === 'table:table') {
      if (close) { depth--; continue }
      depth++
      if (depth === 1) { tab++; row = 0 }
      if (selfClose) depth--
      continue
    }
    if (depth !== 1 || close || tab < 0 || tab >= names.length) continue
    if (kind === 'calcext:conditional-formats') {
      const end = xml.indexOf('</calcext:conditional-formats>', m.index)
      out[tab].condFormats = conditionalFrom(xml.slice(m.index, end), looks)
      re.lastIndex = end
      continue
    }
    if (kind === 'table:table-row') {
      rowRepeat = Math.min(Number(attrOf(attrs, 'table:number-rows-repeated')) || 1, MAX_ROWS)
      row += rowRepeat
      col = 0
      continue
    }
    const n = Number(attrOf(attrs, 'table:number-columns-repeated')) || 1
    const name = attrOf(attrs, 'table:content-validation-name')
    if (name && defs[name] && row - rowRepeat < MAX_ROWS && col < 16384) {
      const b = boxes[tab][name] || (boxes[tab][name] = { r1: Infinity, c1: Infinity, r2: 0, c2: 0 })
      b.r1 = Math.min(b.r1, row - rowRepeat + 1)
      b.r2 = Math.max(b.r2, row)
      b.c1 = Math.min(b.c1, col + 1)
      b.c2 = Math.max(b.c2, Math.min(col + n, 16384))
    }
    col += n
  }
  boxes.forEach((byName, i) => {
    for (const [name, b] of Object.entries(byName)) {
      const d = defs[name]
      const rule = validationOf(d.cond, d.list, names[i])
      if (!rule) continue
      const range = numToCol(b.c1) + b.r1 + (b.r2 !== b.r1 || b.c2 !== b.c1 ? ':' + numToCol(b.c2) + b.r2 : '')
      const v = { range, ...rule, onBad: d.warn ? 'warn' : 'stop' }
      if (d.message) v.message = d.message
      out[i].validations.push(v)
    }
  })

  // Filters: a database range with filter buttons.
  for (const d of xml.matchAll(/<table:database-range\s([^>]*?)\/?>/g)) {
    const tag = '<x ' + d[1] + '>'
    if (attrOf(tag, 'table:display-filter-buttons') !== 'true') continue
    const addr = attrOf(tag, 'table:target-range-address') || ''
    const sheet = /^\$?'?((?:[^'.]|'')*)'?\./.exec(addr)
    const i = sheet ? names.indexOf(sheet[1].replace(/''/g, "'")) : -1
    const range = plainRange(addr)
    if (i >= 0 && parseRange(range) && !out[i].filter) out[i].filter = range
  }
  return out
}

function rulesFromOdsBytes (bytes, fflate, names) {
  let files
  try { files = fflate.unzipSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), { filter: (f) => f.name === 'content.xml' || f.name === 'styles.xml' }) } catch { return names.map(() => null) }
  return rulesFromOds(files, fflate, names)
}

module.exports = { addRulesToOds, rulesFromOds, rulesFromOdsBytes, conditionalXml, conditionOf, ruleOf, validationOf }
