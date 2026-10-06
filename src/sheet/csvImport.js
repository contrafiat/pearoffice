// CSV and tab-separated files as sheets. Pure; produces the same import
// payload as an .xlsx (src/sheet/xlsxMap.js), one tab.
//
// - Read as UTF-8 (a byte-order mark is dropped), so accents and emoji
//   survive.
// - The separator is whichever of comma, semicolon or tab the first line uses
//   most. With semicolons, "1,5" is the decimal 1.5, as in the countries that
//   write CSV that way.
// - Numbers, true/false and formulas are typed. A number written with a
//   leading zero ("007", a ZIP code) stays text. "$1,200.50" and "12%" become
//   numbers that keep their format.
// - Dates become dates shown as 2026-11-01 (with the time when there is one):
//   ISO dates, and 11/15/2026-style dates, read month first unless a day
//   above 12 in the first place shows the file writes the day first.
const { MAX_ROWS, MAX_COLS } = require('./a1')
const { textInput, dateCell, isoDateCell, widthFor } = require('./importValues')

const MAX_IMPORT_CELLS = 200000
const PLAIN_NUMBER = /^[+-]?(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?$/
const LEADING_ZERO = /^[+-]?0\d/
const GROUPED = /^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/
const CURRENCY = /^([+-]?)([$€£¥])\s?([\d,]*\.?\d+)$/
const PERCENT = /^([+-]?\d+(\.\d+)?)\s?%$/
const SLASH_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/

// Split CSV text into rows of fields (quotes, doubled quotes, CRLF).
function parseCsv (text, sep) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else quoted = false
      } else field += ch
    } else if (ch === '"' && field === '') quoted = true
    else if (ch === sep) { row.push(field); field = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field); rows.push(row); row = []; field = ''
    } else field += ch
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows
}

// The separator the first line uses most, outside quotes.
function separatorOf (text) {
  const counts = { ',': 0, ';': 0, '\t': 0 }
  let quoted = false
  for (const ch of text) {
    if (ch === '"') quoted = !quoted
    else if (!quoted && ch in counts) counts[ch]++
    else if (!quoted && (ch === '\n' || ch === '\r')) break
  }
  const [best, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
  return n ? best : ','
}

// One field -> [input, numFmt?], or null for an empty cell.
function cellFor (raw, { sep = ',', dayFirst = false } = {}) {
  const s = raw.trim()
  if (s === '') return null
  if (s[0] === '=') return [s]
  if (/^(true|false)$/i.test(s)) return [s.toUpperCase()]
  if (PLAIN_NUMBER.test(s)) return LEADING_ZERO.test(s) ? [textInput(s)] : [String(Number(s))]
  if (sep === ';' && /^[+-]?\d+,\d+$/.test(s)) return [String(Number(s.replace(',', '.')))]
  if (GROUPED.test(s)) return [String(Number(s.replace(/,/g, ''))), s.includes('.') ? '#,##0.00' : '#,##0']
  const cur = CURRENCY.exec(s)
  if (cur && (GROUPED.test(cur[3]) || PLAIN_NUMBER.test(cur[3]))) return [String(Number(cur[1] + cur[3].replace(/,/g, ''))), cur[2] + '#,##0.00']
  const pct = PERCENT.exec(s)
  if (pct) return [String(Number(pct[1]) / 100), pct[2] ? '0.00%' : '0%']
  const iso = isoDateCell(s)
  if (iso) return iso
  const sl = SLASH_DATE.exec(s)
  if (sl) {
    const [a, b] = [Number(sl[1]), Number(sl[2])]
    const cell = dateCell(Number(sl[3]), dayFirst ? b : a, dayFirst ? a : b, Number(sl[4] || 0), Number(sl[5] || 0), Number(sl[6] || 0))
    if (cell) return sl[4] ? [cell[0], 'yyyy-mm-dd hh:mm'] : cell
  }
  return [textInput(raw)]
}

// Text of a CSV file -> the import payload.
function csvToTabs (text) {
  const body = String(text).replace(/^﻿/, '')
  const sep = separatorOf(body)
  const rows = parseCsv(body, sep).slice(0, MAX_ROWS)
  // Day-first if any slash date has more than 12 in the first place.
  let dayFirst = false
  for (const row of rows) for (const f of row) { const m = SLASH_DATE.exec(f.trim()); if (m && Number(m[1]) > 12) dayFirst = true }
  const cells = []
  const texts = {}
  rows.forEach((row, i) => {
    row.slice(0, MAX_COLS).forEach((f, j) => {
      const c = cellFor(f, { sep, dayFirst })
      if (!c) return
      cells.push([i + 1, j + 1, ...c])
      if (i < 200) (texts[j + 1] = texts[j + 1] || []).push(c[1] ? (c[1].includes('hh') ? '0000-00-00 00:00' : c[1].includes('yyyy') ? '0000-00-00' : f.trim()) : f.trim())
    })
  })
  if (cells.length > MAX_IMPORT_CELLS) throw new Error('This file has more than ' + MAX_IMPORT_CELLS + ' cells, which is more than PearOffice can import for now')
  if (!cells.length) throw new Error('This file has nothing to put in a sheet')
  const widths = {}
  for (const [col, list] of Object.entries(texts)) widths[col] = widthFor(list)
  return { tabs: [{ name: 'Sheet1', cells, widths }], names: [] }
}

// The bytes of a CSV file, read as UTF-8.
function csvBytesToTabs (bytes) {
  return csvToTabs(new TextDecoder('utf-8').decode(bytes))
}

module.exports = { csvToTabs, csvBytesToTabs, parseCsv, separatorOf, cellFor }
