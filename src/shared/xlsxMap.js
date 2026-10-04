// Converting between SheetJS workbooks and PearSheet sheets. Pure functions;
// the SheetJS library is passed in, so the UI can use its bundled copy and
// tests can use Node's.
//
// v1 keeps values, formulas, number formats, tab names and column widths.
// Other formatting is not exported (SheetJS Community Edition does not write
// styles); see DECISIONS.md.

const { MAX_ROWS, MAX_COLS } = require('./a1')

const MAX_IMPORT_CELLS = 200000
// Excel's error codes. PearSheet's own #CIRCULAR! has none; Excel recomputes
// formula cells on open anyway.
const ERROR_CODES = { '#NULL!': 0x00, '#DIV/0!': 0x07, '#VALUE!': 0x0F, '#REF!': 0x17, '#NAME?': 0x1D, '#NUM!': 0x24, '#N/A': 0x2A }
const NUMBERISH = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i

// A string cell that would read as a number, boolean or formula when typed is
// kept as text with a leading apostrophe, as Excel shows it.
function textInput (s) {
  const t = String(s)
  if (t === '') return t
  if (t[0] === '=' || t[0] === "'" || NUMBERISH.test(t.trim()) || /^(true|false)$/i.test(t.trim())) return "'" + t
  return t
}

function decodeRef (XLSX, ref) {
  return XLSX.utils.decode_cell(ref)
}

// Options to read a file with: formulas, number formats and (via
// cellStyles) column widths.
const READ_OPTIONS = { cellFormula: true, cellNF: true, cellStyles: true }

// Workbook (from XLSX.read with READ_OPTIONS) -> import payload:
// { tabs: [{ name, cells: [[row, col, input, numFmt?]], widths: { col: px } }] }
function workbookToTabs (XLSX, wb) {
  const tabs = []
  let total = 0
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name]
    const cells = []
    for (const ref of Object.keys(ws)) {
      if (ref[0] === '!') continue
      const cell = ws[ref]
      const { r, c } = decodeRef(XLSX, ref)
      const row = r + 1
      const col = c + 1
      if (row > MAX_ROWS || col > MAX_COLS) continue
      let input
      if (cell.f) input = '=' + cell.f
      else if (cell.t === 'n') input = String(cell.v)
      else if (cell.t === 'b') input = cell.v ? 'TRUE' : 'FALSE'
      else if (cell.t === 'e') input = cell.w || '#N/A'
      else if (cell.t === 'd') input = String(cell.v)
      else if (cell.t === 's') input = textInput(cell.v)
      else continue // 'z' stub cells
      const num = cell.z && cell.z !== 'General' ? String(cell.z) : undefined
      cells.push(num ? [row, col, input, num] : [row, col, input])
      if (++total > MAX_IMPORT_CELLS) throw new Error('This file has more than ' + MAX_IMPORT_CELLS + ' cells, which is more than PearSheet can import for now')
    }
    const widths = {}
    for (const [i, w] of (ws['!cols'] || []).entries()) {
      if (!w) continue
      const px = w.wpx || (w.wch ? Math.round(w.wch * 7 + 5) : 0)
      if (px) widths[i + 1] = px
    }
    tabs.push({ name: String(name).slice(0, 100), cells, widths })
  }
  if (!tabs.length) throw new Error('This file has no sheets')
  return { tabs }
}

// Sheet dump (from the worklet's sheet:dump) -> SheetJS workbook.
function dumpToWorkbook (XLSX, dump) {
  const wb = XLSX.utils.book_new()
  const used = new Set()
  for (const tab of dump.tabs) {
    const ws = {}
    let maxR = 0
    let maxC = 0
    for (const cell of tab.cells) {
      const ref = XLSX.utils.encode_cell({ r: cell.row - 1, c: cell.col - 1 })
      const out = {}
      if (cell.error) { out.t = 'e'; out.v = ERROR_CODES[cell.error] ?? ERROR_CODES['#VALUE!']; out.w = cell.error in ERROR_CODES ? cell.error : '#VALUE!' } else if (typeof cell.value === 'number') { out.t = 'n'; out.v = cell.value } else if (typeof cell.value === 'boolean') { out.t = 'b'; out.v = cell.value } else if (cell.value === null || cell.value === undefined) { out.t = 's'; out.v = '' } else { out.t = 's'; out.v = String(cell.value) }
      if (typeof cell.input === 'string' && cell.input[0] === '=') out.f = cell.input.slice(1)
      if (cell.fmt && cell.fmt.num) out.z = cell.fmt.num
      ws[ref] = out
      maxR = Math.max(maxR, cell.row)
      maxC = Math.max(maxC, cell.col)
    }
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, maxR - 1), c: Math.max(0, maxC - 1) } })
    const cols = []
    for (const [col, px] of Object.entries(tab.widths || {})) cols[Number(col) - 1] = { wpx: px }
    if (cols.length) ws['!cols'] = Array.from(cols, (x) => x || {})
    // Excel sheet names: 31 chars, no []:*?/\ and unique.
    let name = String(tab.name).replace(/[[\]:*?/\\]/g, ' ').slice(0, 31) || 'Sheet'
    for (let n = 2; used.has(name.toUpperCase()); n++) name = name.slice(0, 28) + ' ' + n
    used.add(name.toUpperCase())
    XLSX.utils.book_append_sheet(wb, ws, name)
  }
  return wb
}

module.exports = { workbookToTabs, dumpToWorkbook, textInput, READ_OPTIONS, MAX_IMPORT_CELLS }
