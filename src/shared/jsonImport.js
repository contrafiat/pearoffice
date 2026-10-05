// JSON files as sheets. Pure; produces the same import payload as an .xlsx
// (src/shared/xlsxMap.js): { tabs: [{ name, cells: [[row, col, input, numFmt?]],
// styles, widths, freeze }] }.
//
// - Every list of objects, at any depth, becomes a tab: one row per object,
//   one column per key (keys of nested objects as "parent.child"), a bold,
//   frozen header row.
// - Everything else (single values, nested settings, lists of plain values)
//   goes on a "Summary" tab as Field / Value rows.
// - A file that is just a list of objects is one tab; a list of plain values
//   is one column.
// - Numbers and true/false stay numbers and booleans. Text that is an ISO
//   date ("2026-10-04" or "2026-10-04T22:55:01Z") becomes a date with a date
//   format, in this device's time zone. Other text stays text, even if it
//   looks like a number.
const { MAX_ROWS, MAX_COLS } = require('./a1')

const MAX_IMPORT_CELLS = 200000
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/
const DATE_TIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/
const NUMBERISH = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i
const DAY_MS = 86400000
const EPOCH_SERIAL = 25569 // 1970-01-01 as a spreadsheet date

const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isTable = (v) => Array.isArray(v) && v.length > 0 && v.every(isRecord)

// A JSON value -> [input, numFmt?] for one cell, or null for an empty cell.
function cellFor (v) {
  if (v === null || v === undefined) return null
  if (typeof v === 'number') return Number.isFinite(v) ? [String(v)] : null
  if (typeof v === 'boolean') return [v ? 'TRUE' : 'FALSE']
  if (Array.isArray(v)) {
    if (!v.length) return null
    const plain = v.every((x) => x === null || typeof x !== 'object')
    return [textInput(plain ? v.filter((x) => x !== null).join(', ') : JSON.stringify(v))]
  }
  if (typeof v === 'object') return [textInput(JSON.stringify(v))]
  const s = String(v)
  const d = DATE_ONLY.exec(s)
  if (d) {
    const ms = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]))
    // Date.UTC rolls 2026-13-45 over into 2027; only a real date counts.
    if (new Date(ms).toISOString().slice(0, 10) === s) return [String(ms / DAY_MS + EPOCH_SERIAL), 'yyyy-mm-dd']
  }
  if (DATE_TIME.test(s)) {
    const t = new Date(s)
    if (!Number.isNaN(t.getTime())) {
      // As the clock on this device showed it.
      const local = t.getTime() - t.getTimezoneOffset() * 60000
      return [String(Math.round((local / DAY_MS + EPOCH_SERIAL) * 1e8) / 1e8), 'yyyy-mm-dd hh:mm']
    }
  }
  return [textInput(s)]
}

// Text that would read as a number, a boolean or a formula keeps a leading
// apostrophe, as in an .xlsx import.
function textInput (s) {
  if (s === '') return s
  if (s[0] === '=' || s[0] === "'" || NUMBERISH.test(s.trim()) || /^(true|false)$/i.test(s.trim())) return "'" + s
  return s
}

// A record's fields, with nested objects spread out as "a.b".
function flatten (obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? prefix + '.' + k : k
    if (isRecord(v) && Object.keys(v).length) flatten(v, key, out)
    else out[key] = v
  }
  return out
}

// Walk a value: lists of objects become tables (by path), the rest Summary rows.
function collect (value, path, tables, summary) {
  if (isTable(value)) { tables.push({ path, rows: value }); return }
  if (isRecord(value)) {
    const entries = Object.entries(value)
    if (!entries.length && path) summary.push([path, null])
    for (const [k, v] of entries) collect(v, path ? path + '.' + k : k, tables, summary)
    return
  }
  summary.push([path || 'value', value])
}

function tabName (path, used) {
  let base = String(path || 'Data').replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Data'
  let name = base
  for (let i = 2; used.has(name.toLowerCase()); i++) name = base.slice(0, 31 - String(i).length - 1) + ' ' + i
  used.add(name.toLowerCase())
  return name
}

function widthFor (texts) {
  const longest = texts.reduce((n, t) => Math.max(n, String(t).length), 0)
  return Math.max(60, Math.min(320, longest * 7 + 16))
}

// A JSON value (already parsed) -> the import payload.
function jsonToTabs (value) {
  const tables = []
  const summary = []
  if (Array.isArray(value) && !isTable(value)) {
    // A list of plain values (or a mix): one column.
    tables.push({ path: 'Data', rows: value.map((v) => (isRecord(v) ? v : { value: v })) })
  } else {
    collect(value, '', tables, summary)
  }
  const used = new Set()
  const tabs = []
  let total = 0
  const count = (n) => {
    total += n
    if (total > MAX_IMPORT_CELLS) throw new Error('This file has more than ' + MAX_IMPORT_CELLS + ' cells, which is more than PearSheet can import for now')
  }

  if (summary.length) {
    const cells = [[1, 1, 'Field'], [1, 2, 'Value']]
    let row = 2
    for (const [path, v] of summary) {
      if (row > MAX_ROWS) break
      cells.push([row, 1, textInput(path)])
      const c = cellFor(v)
      if (c) cells.push([row, 2, ...c])
      row++
    }
    count(cells.length)
    tabs.push({
      name: tabName('Summary', used),
      cells,
      styles: [[1, 1, { b: true }], [1, 2, { b: true }]],
      widths: { 1: widthFor(summary.map((s) => s[0]).concat('Field')), 2: widthFor(summary.map((s) => (isRecord(s[1]) || Array.isArray(s[1]) ? JSON.stringify(s[1]) : String(s[1] ?? ''))).concat('Value')) },
      freeze: { rows: 1, cols: 0 }
    })
  }

  for (const { path, rows } of tables) {
    const flat = rows.map((r) => flatten(r))
    const keys = []
    const seen = new Set()
    for (const r of flat) for (const k of Object.keys(r)) if (!seen.has(k)) { seen.add(k); keys.push(k) }
    const cols = keys.slice(0, MAX_COLS)
    const cells = cols.map((k, i) => [1, i + 1, textInput(k)])
    flat.slice(0, MAX_ROWS - 1).forEach((r, i) => {
      cols.forEach((k, j) => {
        const c = cellFor(r[k])
        if (c) cells.push([i + 2, j + 1, ...c])
      })
    })
    count(cells.length)
    const widths = {}
    cols.forEach((k, j) => {
      widths[j + 1] = widthFor([k, ...flat.slice(0, 200).map((r) => {
        const c = cellFor(r[k])
        return !c ? '' : c[1] ? (c[1].length > 10 ? '0000-00-00 00:00' : '0000-00-00') : c[0]
      })])
    })
    tabs.push({ name: tabName(path, used), cells, styles: cols.map((_, j) => [1, j + 1, { b: true }]), widths, freeze: { rows: 1, cols: 0 } })
  }
  if (!tabs.length) throw new Error('This file has nothing to put in a sheet')
  return { tabs, names: [] }
}

// Text of a .json file -> the import payload, with a plain error for bad JSON.
function jsonFileToTabs (text) {
  let value
  try {
    value = JSON.parse(String(text).replace(/^﻿/, ''))
  } catch {
    throw new Error('This file is not valid JSON')
  }
  return jsonToTabs(value)
}

module.exports = { jsonToTabs, jsonFileToTabs, cellFor }
