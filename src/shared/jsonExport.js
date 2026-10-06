// A sheet as JSON: the reverse of jsonImport.js, values only (no formats,
// charts or formulas). Pure; takes the `sheet:dump` payload.
//
// - Each tab is a list of records: the first row names the fields, each row
//   below is one record. "parent.child" fields become nested objects.
// - A tab named "Summary" with Field / Value headings becomes fields of the
//   top-level object, as the import made it.
// - Tabs are keyed by name ("a.b" nests); a sheet whose only tab is "Data"
//   is just the list. A tab whose only field is "value" is a list of values.
// - Numbers and booleans stay as they are, dates (a date format) become ISO
//   text, empty cells and errors become null.

const SSF = require('./formula/vendor/fast-formula-parser/ssf/ssf')

const EPOCH_SERIAL = 25569 // 1970-01-01 as a spreadsheet date
const DAY_MS = 86400000
const pad = (n) => String(n).padStart(2, '0')

// A date serial as "YYYY-MM-DD", or with "THH:MM:SS" when it has a time.
function isoDate (serial) {
  const t = new Date(Math.round((serial - EPOCH_SERIAL) * DAY_MS / 1000) * 1000)
  const day = t.getUTCFullYear() + '-' + pad(t.getUTCMonth() + 1) + '-' + pad(t.getUTCDate())
  const h = t.getUTCHours()
  const m = t.getUTCMinutes()
  const s = t.getUTCSeconds()
  return h || m || s ? day + 'T' + pad(h) + ':' + pad(m) + ':' + pad(s) : day
}

function valueOf (cell) {
  if (!cell || cell.error || cell.value === null || cell.value === undefined || cell.value === '') return null
  const v = cell.value
  if (typeof v === 'number') {
    let date = false
    try { date = !!(cell.fmt && cell.fmt.num && SSF.is_date(cell.fmt.num)) } catch {}
    return date ? isoDate(v) : v
  }
  return v
}

// "a.b.c" = v into obj, as nested objects.
function put (obj, path, v) {
  const parts = String(path).split('.')
  let at = obj
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i]
    if (at[k] === null || typeof at[k] !== 'object' || Array.isArray(at[k])) at[k] = {}
    at = at[k]
  }
  at[parts[parts.length - 1]] = v
}

// A tab's cells as rows of values, up to the last row and column used.
function grid (tab) {
  const at = new Map()
  let rows = 0
  let cols = 0
  for (const c of tab.cells) {
    const v = valueOf(c)
    if (v === null) continue
    at.set(c.row + ',' + c.col, v)
    rows = Math.max(rows, c.row)
    cols = Math.max(cols, c.col)
  }
  const out = []
  for (let r = 1; r <= rows; r++) {
    const line = []
    for (let c = 1; c <= cols; c++) line.push(at.has(r + ',' + c) ? at.get(r + ',' + c) : null)
    out.push(line)
  }
  return out
}

// Field names from the first row: blank ones named by position, repeats
// numbered.
function fieldNames (first) {
  const used = new Set()
  return first.map((v, i) => {
    const base = v === null || String(v).trim() === '' ? 'column' + (i + 1) : String(v)
    let name = base
    for (let n = 2; used.has(name); n++) name = base + ' ' + n
    used.add(name)
    return name
  })
}

function records (rows) {
  if (!rows.length) return []
  const names = fieldNames(rows[0])
  if (names.length === 1 && names[0] === 'value') return rows.slice(1).map((line) => line[0])
  return rows.slice(1).map((line) => {
    const rec = {}
    names.forEach((name, i) => put(rec, name, line[i] === undefined ? null : line[i]))
    return rec
  })
}

function isSummary (tab, rows) {
  return /^summary$/i.test(tab.name) && rows.length > 0 && rows[0][0] === 'Field' && rows[0][1] === 'Value'
}

function sheetToJson (dump) {
  const tabs = dump.tabs.map((tab) => ({ tab, rows: grid(tab) }))
  if (tabs.length === 1 && tabs[0].tab.name === 'Data') return records(tabs[0].rows)
  const out = {}
  for (const { tab, rows } of tabs) {
    if (isSummary(tab, rows)) {
      for (const line of rows.slice(1)) if (line[0] !== null) put(out, line[0], line[1] === undefined ? null : line[1])
    } else {
      put(out, tab.name, records(rows))
    }
  }
  return out
}

module.exports = { sheetToJson, isoDate }
