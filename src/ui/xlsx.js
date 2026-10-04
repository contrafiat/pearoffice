// .xlsx import and export in the UI, with SheetJS (Community Edition, mini
// build, vendored in vendor/). The conversion itself is in src/shared/xlsxMap.js.
// On phones the shell does the file handling (share sheet, file picker).
import * as XLSX from 'xlsx/dist/xlsx.mini.min.js'
import * as fflate from 'fflate'
import { workbookToTabs, workbookBytes, READ_OPTIONS } from '../shared/xlsxMap.js'
import { call } from './bridge.js'
import { borderCss, fontPx, FONTS } from './cellStyle.js'

const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
export const isMobile = () => !!(window.pearsheet && window.pearsheet.platform === 'mobile')

function importWorkbook (wb, name) {
  const { tabs } = workbookToTabs(XLSX, wb)
  const title = String(name || '').replace(/\.[^.]+$/, '') || 'Imported sheet'
  return call('sheet:import', { title, tabs })
}

// Desktop: a File from an <input type=file>.
export async function importFile (file) {
  const data = new Uint8Array(await file.arrayBuffer())
  return importWorkbook(XLSX.read(data, { type: 'array', ...READ_OPTIONS }), file.name)
}

// Phones: the shell's file picker. Resolves to null if cancelled.
export async function pickAndImport () {
  const picked = await call('app:pickFile')
  if (!picked || picked.canceled) return null
  return importWorkbook(XLSX.read(picked.base64, { type: 'base64', ...READ_OPTIONS }), picked.name)
}

export async function exportSheet (sheetId) {
  const dump = await call('sheet:dump', { sheetId })
  const bytes = workbookBytes(XLSX, fflate, dump)
  const name = (dump.title || 'PearSheet').replace(/[\\/:*?"<>|]/g, ' ') + '.xlsx'
  if (isMobile()) {
    let bin = ''
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
    return call('app:shareFile', { name, mime: MIME, base64: btoa(bin) })
  }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([bytes], { type: MIME }))
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 10000)
}

// --- one tab as .csv, and as a printable page (PDF, print) -------------------

// The used part of a tab: up to the last row and column with something shown.
function usedBlock (view) {
  let rows = 0
  let cols = 0
  for (const c of view.cells) if (c.display !== '') { rows = Math.max(rows, c.row); cols = Math.max(cols, c.col) }
  const at = new Map(view.cells.map((c) => [c.row + ',' + c.col, c]))
  return { rows, cols, at }
}

const fileName = (s) => String(s || 'PearSheet').replace(/[\\/:*?"<>|]/g, ' ')

// What the cells show, comma-separated, with a byte order mark so Excel
// reads it as UTF-8.
export function tabCsv (view) {
  const { rows, cols, at } = usedBlock(view)
  const quote = (s) => (/[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s)
  const lines = []
  for (let r = 1; r <= rows; r++) {
    const line = []
    for (let c = 1; c <= cols; c++) { const x = at.get(r + ',' + c); line.push(quote(x ? x.display : '')) }
    lines.push(line.join(','))
  }
  return '\ufeff' + lines.join('\r\n') + '\r\n'
}

export async function exportCsv (view) {
  const tab = (view.tabs.find((t) => t.id === view.tabId) || {}).name
  const name = fileName(view.title + (view.tabs.length > 1 ? ' - ' + tab : '')) + '.csv'
  const text = tabCsv(view)
  if (isMobile()) {
    const bytes = new TextEncoder().encode(text)
    let bin = ''
    for (const b of bytes) bin += String.fromCharCode(b)
    return call('app:shareFile', { name, mime: 'text/csv', base64: btoa(bin) })
  }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }))
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 10000)
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// A tab as a printable HTML page: the used block with widths, bold, italic
// and colours.
export function tabHtml (view, chartSvgs = []) {
  const { rows, cols, at } = usedBlock(view)
  const tab = (view.tabs.find((t) => t.id === view.tabId) || {}).name
  const width = (c) => (view.widths && view.widths[c]) || 100
  // Merged cells: one table cell spanning the block; the cells it covers are left out.
  const spans = new Map()
  const covered = new Set()
  for (const m of view.merges || []) {
    spans.set(m.r1 + ',' + m.c1, m)
    for (let r = m.r1; r <= m.r2; r++) for (let c = m.c1; c <= m.c2; c++) if (r !== m.r1 || c !== m.c1) covered.add(r + ',' + c)
  }
  let body = ''
  for (let r = 1; r <= rows; r++) {
    const rh = view.heights && view.heights[r]
    body += rh ? '<tr style="height:' + Math.round(rh * 11 / 14) + 'px">' : '<tr>'
    for (let c = 1; c <= cols; c++) {
      if (covered.has(r + ',' + c)) continue
      const x = at.get(r + ',' + c)
      const f = (x && x.fmt) || {}
      const m = spans.get(r + ',' + c)
      const style = [
        f.align ? 'text-align:' + f.align : x && (x.kind === 'number' || x.kind === 'bool') ? 'text-align:right' : '',
        'vertical-align:' + (f.valign || 'bottom'),
        f.wrap ? 'white-space:pre-wrap' : '',
        f.size ? 'font-size:' + Math.round(fontPx(f) * 11 / 14 * 10) / 10 + 'px' : '',
        f.font ? 'font-family:' + FONTS[f.font].replace(/"/g, "'") : '',
        f.u || f.s ? 'text-decoration:' + [f.u && 'underline', f.s && 'line-through'].filter(Boolean).join(' ') : '',
        f.b ? 'font-weight:bold' : '',
        f.i ? 'font-style:italic' : '',
        f.color ? 'color:' + f.color : '',
        f.fill ? 'background:' + f.fill : '',
        f.bt ? 'border-top:' + borderCss(f.bt) : '',
        f.br ? 'border-right:' + borderCss(f.br) : '',
        f.bb ? 'border-bottom:' + borderCss(f.bb) : '',
        f.bl ? 'border-left:' + borderCss(f.bl) : ''
      ].filter(Boolean).join(';')
      const spanAttrs = m ? (m.c2 > m.c1 ? ' colspan="' + (Math.min(m.c2, cols) - m.c1 + 1) + '"' : '') + (m.r2 > m.r1 ? ' rowspan="' + (Math.min(m.r2, rows) - m.r1 + 1) + '"' : '') : ''
      body += '<td' + spanAttrs + (style ? ' style="' + style + '"' : '') + '>' + esc(x ? x.display : '') + '</td>'
    }
    body += '</tr>'
  }
  const colgroup = Array.from({ length: cols }, (_, i) => '<col style="width:' + width(i + 1) + 'px">').join('')
  return '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(view.title) + '</title><style>' +
    'body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-size:11px;margin:0}' +
    'h1{font-size:14px;margin:0 0 8px}table{border-collapse:collapse;table-layout:fixed}' +
    'td{border:1px solid #ccc;padding:2px 4px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}' +
    '.chart{margin-top:16px;break-inside:avoid;page-break-inside:avoid}.chart svg{max-width:100%;height:auto}' +
    '</style></head><body><h1>' + esc(view.title) + (view.tabs.length > 1 ? ' - ' + esc(tab) : '') + '</h1>' +
    '<table><colgroup>' + colgroup + '</colgroup>' + body + '</table>' +
    chartSvgs.map((svg) => '<div class="chart">' + svg + '</div>').join('') + '</body></html>'
}

// Desktop only: save the tab as a PDF, or open the print dialog.
export function printTab (view, how, chartSvgs = []) {
  const tab = (view.tabs.find((t) => t.id === view.tabId) || {}).name
  const name = fileName(view.title + (view.tabs.length > 1 ? ' - ' + tab : '')) + '.pdf'
  return call(how === 'pdf' ? 'app:savePdf' : 'app:print', { html: tabHtml(view, chartSvgs), name })
}
