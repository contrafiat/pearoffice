// JSON files as sheets. Pure; produces the same import payload as an .xlsx
// (src/sheet/xlsxMap.js): { tabs: [{ name, cells: [[row, col, input, numFmt?]],
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

const { textInput, isoDateCell, widthFor } = require('./importValues')

const MAX_IMPORT_CELLS = 200000

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
  const date = isoDateCell(s)
  if (date) return date
  return [textInput(s)]
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
    if (total > MAX_IMPORT_CELLS) throw new Error('This file has more than ' + MAX_IMPORT_CELLS + ' cells, which is more than PearOffice can import for now')
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
