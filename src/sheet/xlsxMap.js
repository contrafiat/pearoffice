// Converting between SheetJS workbooks and PearOffice sheets. Pure functions;
// the SheetJS library is passed in, so the UI can use its bundled copy and
// tests can use Node's.
//
// v1 keeps values, formulas, number formats, tab names and column widths.
// Other formatting is not exported (SheetJS Community Edition does not write
// styles); see DECISIONS.md.

const { MAX_ROWS, MAX_COLS, numToCol } = require('./a1')

// Frozen panes in a file's sheets ([{ rows, cols }] in sheet order), read from
// the raw parts since SheetJS does not report them.
function freezeFromXlsx (bytes, fflate) {
  let files
  try { files = fflate.unzipSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)) } catch { return [] }
  const out = []
  for (let i = 1; files['xl/worksheets/sheet' + i + '.xml']; i++) {
    const xml = fflate.strFromU8(files['xl/worksheets/sheet' + i + '.xml'])
    const m = /<pane\b[^>]*state="frozen(?:Split)?"[^>]*\/?>/.exec(xml)
    const get = (k) => (m && new RegExp(k + '="(\\d+)"').exec(m[0])) || null
    out.push(m ? { rows: get('ySplit') ? Number(get('ySplit')[1]) : 0, cols: get('xSplit') ? Number(get('xSplit')[1]) : 0 } : null)
  }
  return out
}

const MAX_IMPORT_CELLS = 200000

// In .xlsx files, functions newer than Excel 2007 carry an _xlfn. prefix and
// the first dynamic-array functions also _xlws. (spilling formulas,
// proposals/2026-10-04-spilling-formulas.md). PearOffice stores plain names.
const XLWS = new Set(['FILTER', 'SORT'])
const XLFN = new Set(['ANCHORARRAY', 'SORTBY', 'UNIQUE', 'SEQUENCE', 'TEXTSPLIT', 'TAKE', 'DROP', 'VSTACK', 'HSTACK', 'TOCOL', 'TOROW',
  'CHOOSEROWS', 'CHOOSECOLS', 'WRAPROWS', 'WRAPCOLS', 'EXPAND', 'RANDARRAY', 'XLOOKUP', 'XMATCH', 'TEXTBEFORE', 'TEXTAFTER'])
// Outside string literals only.
function mapNames (f, fn) {
  return String(f).split(/("(?:[^"]|"")*")/).map((part, i) => (i % 2 ? part : fn(part))).join('')
}
// A2# (the whole spill from A2) is ANCHORARRAY(A2) in a file.
const SPILL_REF = /((?:'(?:[^']|'')+'|[A-Za-z_][\w.]*)!)?(\$?[A-Za-z]{1,3}\$?\d+)#/g
const ANCHOR = /ANCHORARRAY\(((?:'(?:[^']|'')+'|[A-Za-z_][\w.]*)!)?(\$?[A-Za-z]{1,3}\$?\d+)\)/gi
const toFile = (f) => mapNames(f, (p) => p.replace(SPILL_REF, (m, sheet, cell) => 'ANCHORARRAY(' + (sheet || '') + cell + ')').replace(/\b([A-Z][A-Z0-9.]*)\(/g, (m, name) => (XLWS.has(name) ? '_xlfn._xlws.' + name + '(' : XLFN.has(name) ? '_xlfn.' + name + '(' : m)))
const fromFile = (f) => mapNames(f, (p) => p.replace(/_xl(fn|ws)\./gi, '').replace(ANCHOR, (m, sheet, cell) => (sheet || '') + cell + '#'))
// Excel's error codes. PearOffice's own #CIRCULAR! has none; Excel recomputes
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
    // Array formulas (dynamic or the older Ctrl+Shift+Enter kind): the
    // formula sits in the top-left cell and spills; the rest of its range is
    // the formula's answer, not input.
    const covered = new Set()
    for (const ref of Object.keys(ws)) {
      const cell = ws[ref]
      if (ref[0] === '!' || !cell.F || !cell.f) continue
      const range = XLSX.utils.decode_range(cell.F)
      for (let r = range.s.r; r <= range.e.r; r++) {
        for (let c = range.s.c; c <= range.e.c; c++) if (r !== range.s.r || c !== range.s.c) covered.add(r + ',' + c)
      }
    }
    for (const ref of Object.keys(ws)) {
      if (ref[0] === '!') continue
      const cell = ws[ref]
      const { r, c } = decodeRef(XLSX, ref)
      const row = r + 1
      const col = c + 1
      if (row > MAX_ROWS || col > MAX_COLS) continue
      if (covered.has(r + ',' + c)) continue
      let input
      if (cell.f) input = '=' + fromFile(cell.f)
      else if (cell.t === 'n') input = String(cell.v)
      else if (cell.t === 'b') input = cell.v ? 'TRUE' : 'FALSE'
      else if (cell.t === 'e') input = cell.w || '#N/A'
      else if (cell.t === 'd') input = String(cell.v)
      else if (cell.t === 's') input = textInput(cell.v)
      else continue // 'z' stub cells
      const num = cell.z && cell.z !== 'General' ? String(cell.z) : undefined
      cells.push(num ? [row, col, input, num] : [row, col, input])
      if (++total > MAX_IMPORT_CELLS) throw new Error('This file has more than ' + MAX_IMPORT_CELLS + ' cells, which is more than PearOffice can import for now')
    }
    const widths = {}
    for (const [i, w] of (ws['!cols'] || []).entries()) {
      if (!w) continue
      const px = w.wpx || (w.wch ? Math.round(w.wch * 7 + 5) : 0)
      if (px) widths[i + 1] = px
    }
    // Notes and comments in the file come in as comments by their author's
    // name ("xlsx:" marks a name that is not a member).
    const comments = []
    for (const ref of Object.keys(ws)) {
      if (ref[0] === '!' || !Array.isArray(ws[ref].c) || !ws[ref].c.length) continue
      const { r, c } = decodeRef(XLSX, ref)
      if (r + 1 > MAX_ROWS || c + 1 > MAX_COLS) continue
      const text = ws[ref].c.map((x) => String(x.t || '').trim()).filter(Boolean).join('\n').slice(0, 2000)
      if (text) comments.push({ row: r + 1, col: c + 1, author: 'xlsx:' + (String(ws[ref].c[0].a || '').trim() || 'Imported'), text })
    }
    // Links (proposals/2026-10-18-sheet-links.md): [row, col, address], or
    // [row, col, { tab, row, col }] for a place in the workbook (tab by
    // index; row and col null for the tab itself).
    const links = []
    for (const ref of Object.keys(ws)) {
      const l = ref[0] !== '!' && ws[ref].l
      if (!l || !l.Target) continue
      const { r, c } = decodeRef(XLSX, ref)
      if (r + 1 > MAX_ROWS || c + 1 > MAX_COLS) continue
      const to = String(l.Target)
      if (to[0] !== '#') { links.push([r + 1, c + 1, to]); continue }
      const place = linkPlace(wb, to.slice(1))
      if (place) links.push([r + 1, c + 1, place])
    }
    const hidden = { rows: [], cols: [] }
    for (const [i, x] of (ws['!rows'] || []).entries()) if (x && x.hidden && i < MAX_ROWS) hidden.rows.push(i + 1)
    for (const [i, x] of (ws['!cols'] || []).entries()) if (x && x.hidden && i < MAX_COLS) hidden.cols.push(i + 1)
    const merges = (ws['!merges'] || []).map((m) => [m.s.r + 1, m.s.c + 1, m.e.r + 1, m.e.c + 1]).filter(([r1, c1, r2, c2]) => r2 <= MAX_ROWS && c2 <= MAX_COLS && (r1 !== r2 || c1 !== c2))
    tabs.push({ name: String(name).slice(0, 100), cells, widths, merges, hidden, comments, links })
  }
  if (!tabs.length) throw new Error('This file has no sheets')
  // Workbook-wide named ranges (names for one sheet only are skipped).
  const names = []
  for (const n of (wb.Workbook && wb.Workbook.Names) || []) {
    if (n.Sheet !== undefined && n.Sheet !== null) continue
    const box = require('./charts').parseRange(String(n.Ref || ''))
    const tab = box && box.sheet ? wb.SheetNames.findIndex((x) => x.toUpperCase() === box.sheet.toUpperCase()) : -1
    if (!box || box.spill || tab < 0 || /^_xl/i.test(n.Name) || n.Hidden) continue
    names.push({ name: n.Name, tab, range: numToCol(box.c1) + box.r1 + ':' + numToCol(box.c2) + box.r2 })
  }
  return { tabs, names }
}

// Where a link inside a workbook goes: Sheet2!B4, 'My tab'!B4:C9, a tab's
// name or a workbook-wide name ({ name }, kept as a link to the name). Null
// if nowhere.
function linkPlace (wb, text) {
  const sheetIndex = (name) => wb.SheetNames.findIndex((x) => x.toUpperCase() === String(name).toUpperCase())
  const box = require('./charts').parseRange(text)
  if (box && box.sheet) {
    const tab = sheetIndex(box.sheet)
    if (tab < 0) return null
    const one = box.r1 === box.r2 && box.c1 === box.c2
    return one ? { tab, row: box.r1, col: box.c1 } : { tab, row: box.r1, col: box.c1, row2: Math.min(box.r2, MAX_ROWS), col2: Math.min(box.c2, MAX_COLS) }
  }
  const tab = sheetIndex(text.replace(/^'(.*)'$/, '$1').replace(/''/g, "'"))
  if (tab >= 0) return { tab, row: null, col: null }
  const n = ((wb.Workbook && wb.Workbook.Names) || []).find((x) => String(x.Name).toUpperCase() === text.toUpperCase() && (x.Sheet === undefined || x.Sheet === null))
  return n ? { name: String(n.Name) } : null
}

// Sheet dump (from the worklet's sheet:dump) -> SheetJS workbook.
function dumpToWorkbook (XLSX, dump) {
  const wb = XLSX.utils.book_new()
  // Excel sheet names: 31 chars, no []:*?/\ and unique.
  const used = new Set()
  const sheetNames = dump.tabs.map((tab) => {
    let name = String(tab.name).replace(/[[\]:*?/\\]/g, ' ').slice(0, 31) || 'Sheet'
    for (let n = 2; used.has(name.toUpperCase()); n++) name = name.slice(0, 28) + ' ' + n
    used.add(name.toUpperCase())
    return name
  })
  // A link: { Target } with the address, #'Tab'!B4 or #'Tab'!B4:D9 for a
  // place in the workbook (the tab's first cell for the tab itself), or
  // #Name for a named range.
  const linkOut = (cell) => {
    if (cell.link) return { Target: cell.link }
    const to = cell.linkTo
    if (to && to.rangeName) return { Target: '#' + to.rangeName }
    if (!to || !sheetNames[to.tab]) return null
    const far = to.row2 ? ':' + numToCol(to.col2) + to.row2 : ''
    return { Target: "#'" + sheetNames[to.tab].replace(/'/g, "''") + "'!" + numToCol(to.col || 1) + (to.row || 1) + far }
  }
  for (const [tabIndex, tab] of dump.tabs.entries()) {
    const ws = {}
    let maxR = 0
    let maxC = 0
    for (const cell of tab.cells) {
      // A formatted cell with nothing in it: its style is added as a blank
      // cell (src/sheet/xlsxStyles.js), not as empty text.
      if (!cell.input && !cell.error && (cell.value === null || cell.value === undefined)) continue
      const ref = XLSX.utils.encode_cell({ r: cell.row - 1, c: cell.col - 1 })
      const out = {}
      if (cell.error) { out.t = 'e'; out.v = ERROR_CODES[cell.error] ?? ERROR_CODES['#VALUE!']; out.w = cell.error in ERROR_CODES ? cell.error : '#VALUE!' } else if (typeof cell.value === 'number') { out.t = 'n'; out.v = cell.value } else if (typeof cell.value === 'boolean') { out.t = 'b'; out.v = cell.value } else if (cell.value === null || cell.value === undefined) { out.t = 's'; out.v = '' } else { out.t = 's'; out.v = String(cell.value) }
      if (typeof cell.input === 'string' && cell.input[0] === '=') out.f = toFile(cell.input.slice(1))
      // A spilling formula is written as a dynamic array over its block; the
      // cells it fills are written as plain values.
      if (out.f && cell.spill) {
        out.F = XLSX.utils.encode_range({ s: { r: cell.row - 1, c: cell.col - 1 }, e: { r: cell.row + cell.spill.rows - 2, c: cell.col + cell.spill.cols - 2 } })
        out.D = true
      }
      if (cell.fmt && cell.fmt.num) out.z = cell.fmt.num
      const l = linkOut(cell)
      if (l) out.l = l
      ws[ref] = out
      maxR = Math.max(maxR, cell.row)
      maxC = Math.max(maxC, cell.col)
    }
    if (tab.merges && tab.merges.length) ws['!merges'] = tab.merges.map((m) => ({ s: { r: m.r1 - 1, c: m.c1 - 1 }, e: { r: m.r2 - 1, c: m.c2 - 1 } }))
    // Comments become Excel notes (hidden until hovered), the whole thread
    // as text. A note on an empty cell needs an empty text cell to sit on.
    for (const note of tab.comments || []) {
      const ref = XLSX.utils.encode_cell({ r: note.row - 1, c: note.col - 1 })
      if (!ws[ref]) ws[ref] = { t: 's', v: '' }
      ws[ref].c = [{ a: String(note.author || ''), t: String(note.text || '') }]
      ws[ref].c.hidden = true
      maxR = Math.max(maxR, note.row)
      maxC = Math.max(maxC, note.col)
    }
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, maxR - 1), c: Math.max(0, maxC - 1) } })
    const cols = []
    for (const [col, px] of Object.entries(tab.widths || {})) cols[Number(col) - 1] = { wpx: px }
    if (cols.length) ws['!cols'] = Array.from(cols, (x) => x || {})
    const rows = []
    for (const [row, px] of Object.entries(tab.heights || {})) rows[Number(row) - 1] = { hpt: Math.round(px * 0.75 * 100) / 100 }
    for (const row of (tab.hidden && tab.hidden.rows) || []) rows[row - 1] = { ...rows[row - 1], hidden: true }
    for (const col of (tab.hidden && tab.hidden.cols) || []) cols[col - 1] = { ...cols[col - 1], hidden: true }
    if (rows.length) ws['!rows'] = Array.from(rows, (x) => x || {})
    if (cols.length) ws['!cols'] = Array.from(cols, (x) => x || {})
    XLSX.utils.book_append_sheet(wb, ws, sheetNames[tabIndex])
  }
  // Named ranges: { name, tab (its name in the dump), range }.
  const names = (dump.names || []).map((n) => {
    const i = dump.tabs.findIndex((t) => t.name === n.tab)
    const box = i >= 0 && require('./charts').parseRange(n.range)
    if (!box) return null
    const abs = (r, c) => '$' + numToCol(c) + '$' + r
    const ref = abs(box.r1, box.c1) + (box.r1 === box.r2 && box.c1 === box.c2 ? '' : ':' + abs(box.r2, box.c2))
    return { Name: n.name, Ref: "'" + wb.SheetNames[i].replace(/'/g, "''") + "'!" + ref }
  }).filter(Boolean)
  if (names.length) wb.Workbook = { ...(wb.Workbook || {}), Names: names }
  return wb
}

// The workbook with the dump's charts added (src/sheet/xlsxCharts.js), as
// .xlsx bytes. Charts name tabs as the workbook does (Excel shortens some).
// Worksheet parts that must come after data validation (and conditional
// formatting) in the file, in the order Excel requires.
const AFTER_VALIDATION = ['hyperlinks', 'printOptions', 'pageMargins', 'pageSetup', 'headerFooter', 'rowBreaks', 'colBreaks', 'customProperties', 'cellWatches', 'ignoredErrors', 'smartTags', 'drawing', 'legacyDrawing', 'legacyDrawingHF', 'picture', 'oleObjects', 'controls', 'webPublishItems', 'tableParts', 'extLst']
function insertBefore (xml, piece, tags) {
  let at = -1
  for (const t of tags) {
    const i = xml.search(new RegExp('<' + t + '[\\s/>]'))
    if (i >= 0 && (at < 0 || i < at)) at = i
  }
  if (at < 0) at = xml.lastIndexOf('</worksheet>')
  return xml.slice(0, at) + piece + xml.slice(at)
}

function workbookBytes (XLSX, fflate, dump) {
  const wb = dumpToWorkbook(XLSX, dump)
  const bytes = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }))
  const tabs = chartTabs(wb, dump)
  // Styles first (src/sheet/xlsxStyles.js), then frozen panes, then charts.
  const files = fflate.unzipSync(bytes)
  const { dxfId } = require('./xlsxStyles').addStyles(files, dump.tabs, fflate)
  dump.tabs.forEach((t, i) => {
    const f = t.freeze || {}
    const path = 'xl/worksheets/sheet' + (i + 1) + '.xml'
    if ((!f.rows && !f.cols) || !files[path]) return
    const cell = numToCol((f.cols || 0) + 1) + ((f.rows || 0) + 1)
    const pane = '<pane' + (f.cols ? ' xSplit="' + f.cols + '"' : '') + (f.rows ? ' ySplit="' + f.rows + '"' : '') + ' topLeftCell="' + cell + '" activePane="' +
      (f.rows && f.cols ? 'bottomRight' : f.rows ? 'bottomLeft' : 'topRight') + '" state="frozen"/>'
    const xml = fflate.strFromU8(files[path]).replace(/<sheetView(\s[^>]*?)?(\/?)>/, (m, attrs = '', empty) => '<sheetView' + attrs + '>' + pane + (empty ? '</sheetView>' : ''))
    files[path] = fflate.strToU8(xml)
  })
  // Colour rules and data validation (proposals/2026-10-04-sheet-tools.md).
  dump.tabs.forEach((t, i) => {
    const path = 'xl/worksheets/sheet' + (i + 1) + '.xml'
    const rules = (t.condFormats || []).map((r) => (r.formula ? { ...r, formula: toFile(r.formula) } : r))
    const xml = rules.length && files[path] ? require('./condFormat').toXlsx(rules, dxfId) : ''
    if (xml) files[path] = fflate.strToU8(insertBefore(fflate.strFromU8(files[path]), xml, ['dataValidations', ...AFTER_VALIDATION]))
  })
  dump.tabs.forEach((t, i) => {
    const path = 'xl/worksheets/sheet' + (i + 1) + '.xml'
    const xml = (t.validations || []).length && files[path] ? require('./validation').toXlsx(t.validations) : ''
    if (xml) files[path] = fflate.strToU8(insertBefore(fflate.strFromU8(files[path]), xml, AFTER_VALIDATION))
  })
  return require('./xlsxCharts').addChartsToXlsx(fflate.zipSync(files), tabs, fflate)
}

// The sheet as an OpenDocument spreadsheet (.ods), for LibreOffice and
// OpenOffice: values, formulas (src/sheet/odsFormula.js), tabs, number
// formats and charts (src/sheet/odsCharts.js). No styles, frozen panes,
// colour rules or validation.
function odsBytes (XLSX, fflate, dump) {
  const wb = dumpToWorkbook(XLSX, dump)
  const tabs = chartTabs(wb, dump).map((t, i) => {
    const d = dump.tabs[i]
    const styles = (d.cells || []).filter((c) => c.fmt && Object.keys(c.fmt).some((k) => k !== 'num' && k !== 'link')).map((c) => { const { link, ...fmt } = c.fmt; return [c.row, c.col, fmt] })
    const condFormats = (d.condFormats || []).map((r) => (r.formula ? { ...r, formula: toFile(r.formula) } : r))
    return { ...t, styles, widths: d.widths || {}, heights: d.heights || {}, hidden: d.hidden || { rows: [], cols: [] }, freeze: d.freeze || null, condFormats, validations: d.validations || [] }
  })
  return require('./odsFormula').writeOds(XLSX, fflate, wb, tabs)
}

// Each tab's charts with their data ranges under the tab names the workbook
// uses (SheetJS may have changed a name).
function chartTabs (wb, dump) {
  const names = new Map(dump.tabs.map((t, i) => [String(t.name).toUpperCase(), wb.SheetNames[i]]))
  const rename = (data) => String(data || '').replace(/^'((?:[^']|'')+)'!|^([A-Za-z_][\w.]*)!/, (m, q, b) => { const n = names.get((q !== undefined ? q.replace(/''/g, "'") : b).toUpperCase()); return n ? "'" + n.replace(/'/g, "''") + "'!" : m })
  return dump.tabs.map((t, i) => ({ name: wb.SheetNames[i], charts: (t.charts || []).map((c) => ({ ...c, data: rename(c.data) })) }))
}

// Each tab's colour rules from an .xlsx file, in tab order.
function condFormatsFromXlsx (bytes, fflate) {
  let files
  try { files = fflate.unzipSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)) } catch { return [] }
  const { sheetPaths, dxfStyles } = require('./xlsxStyles')
  const dxfs = dxfStyles(files, fflate.strFromU8)
  return sheetPaths(files, fflate.strFromU8).map((p) => (p && files[p] ? require('./condFormat').fromXlsx(fflate.strFromU8(files[p]), dxfs) : [])
    .map((r) => (r.formula ? { ...r, formula: fromFile(r.formula) } : r)))
}

// Each tab's validation rules from an .xlsx file, in tab order.
function validationsFromXlsx (bytes, fflate) {
  let files
  try { files = fflate.unzipSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)) } catch { return [] }
  return require('./xlsxStyles').sheetPaths(files, fflate.strFromU8).map((p) => (p && files[p] ? require('./validation').fromXlsx(fflate.strFromU8(files[p])) : []))
}

module.exports = { condFormatsFromXlsx, validationsFromXlsx, insertBefore, AFTER_VALIDATION, freezeFromXlsx, workbookBytes, odsBytes, workbookToTabs, dumpToWorkbook, textInput, toFile, fromFile, READ_OPTIONS, MAX_IMPORT_CELLS }
