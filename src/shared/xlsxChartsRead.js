// Reading charts from an imported .xlsx file (the reverse of xlsxCharts.js).
// SheetJS Community Edition reads no charts, so this follows each sheet's
// drawing to its chart parts and turns every chart into a PearOffice chart:
// one data range (the block its series, names and categories sit in), the
// type and the settings PearOffice has. Charts it cannot place are skipped.

const { parseRange } = require('./charts')
const { numToCol } = require('./a1')

const EMU = 9525 // per pixel

const attr = (tag, name) => { const m = new RegExp('(?:^|\\s)' + name + '="([^"]*)"').exec(tag || ''); return m ? m[1] : undefined }
const first = (xml, re) => { const m = re.exec(xml || ''); return m ? m[1] : null }
const unesc = (s) => String(s).replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
const val = (xml, tag) => attr(first(xml, new RegExp('(<c:' + tag + '\\s[^>]*>)')), 'val')
const texts = (xml) => [...String(xml || '').matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => unesc(m[1])).join('')

// path of a part relative to another part's folder
function resolve (from, target) {
  if (target.startsWith('/')) return target.slice(1)
  const parts = from.split('/').slice(0, -1)
  for (const p of target.split('/')) { if (p === '..') parts.pop(); else if (p !== '.') parts.push(p) }
  return parts.join('/')
}
function relsOf (files, path, strFromU8) {
  const relPath = path.replace(/([^/]+)$/, '_rels/$1.rels')
  const xml = files[relPath] ? strFromU8(files[relPath]) : ''
  const out = {}
  for (const m of xml.matchAll(/<Relationship\s[^>]*>/g)) out[attr(m[0], 'Id')] = resolve(path, attr(m[0], 'Target'))
  return out
}

// A chart's title: rich text, or the cached text of a cell reference.
function titleOf (xml) {
  if (!xml) return null
  const rich = texts(first(xml, /<c:rich>([\s\S]*?)<\/c:rich>/))
  if (rich) return rich
  const cached = first(xml, /<c:strCache>[\s\S]*?<c:v>([\s\S]*?)<\/c:v>/)
  return cached ? unesc(cached) : null
}

// One series' references: { name, cats, vals, size } as range text (or null).
function seriesRefs (ser) {
  const f = (tag) => { const m = new RegExp('<c:' + tag + '>[\\s\\S]*?<c:f>([\\s\\S]*?)</c:f>').exec(ser); return m ? unesc(m[1]).replace(/\$/g, '') : null }
  return { name: f('tx'), cats: f('cat') || f('xVal'), vals: f('val') || f('yVal'), size: f('bubbleSize') }
}

// Turn a chart part into a PearOffice chart (without anchor and size), or null.
function chartFrom (xml, sheetName) {
  const plot = first(xml, /<c:plotArea>([\s\S]*?)<\/c:plotArea>/) || ''
  const groups = [...plot.matchAll(/<c:(bar|bar3D|line|line3D|area|area3D|pie|pie3D|ofPie|doughnut|scatter|radar|bubble|bubble3D|stock)Chart>([\s\S]*?)<\/c:\1Chart>/g)]
  if (!groups.length) return null
  const kinds = groups.map((g) => g[1].replace(/3D$/, '').replace('ofPie', 'pie'))
  const series = []
  const lineSeries = []
  const secondAxis = []
  const firstAxes = (first(groups[0][2], /(<c:axId[\s\S]*?)(?:<\/c:\w+Chart>|$)/) || '').match(/<c:axId val="(\d+)"/g) || []
  for (const [, kind, body] of groups) {
    const axes = body.match(/<c:axId val="(\d+)"/g) || []
    const onSecond = firstAxes.length && axes.length && axes.join() !== firstAxes.join()
    for (const m of body.matchAll(/<c:ser>([\s\S]*?)<\/c:ser>/g)) {
      const i = series.length
      const refs = seriesRefs(m[1])
      series.push(refs)
      // A bubble series is Y then its sizes, two columns in PearOffice.
      if (refs.size) series.push({ name: null, cats: null, vals: refs.size })
      if (/^line/.test(kind) && kinds.some((k) => k === 'bar')) lineSeries.push(i)
      if (onSecond) secondAxis.push(i)
    }
  }
  if (!series.length || series.some((s) => !s.vals)) return null

  // Every reference must be on one tab; the data range is the block they fill.
  const boxes = []
  let sheet = null
  for (const s of series) {
    for (const ref of [s.name, s.cats, s.vals]) {
      if (!ref) continue
      const box = parseRange(ref)
      if (!box) return null
      const name = box.sheet || sheetName
      if (sheet === null) sheet = name
      else if (sheet.toUpperCase() !== name.toUpperCase()) return null
      boxes.push(box)
    }
  }
  const v = parseRange(series[0].vals)
  const columns = v.c1 === v.c2 && (v.r2 > v.r1 || series.length > 1 ? true : v.r1 === v.r2)
  const r1 = Math.min(...boxes.map((b) => b.r1))
  const c1 = Math.min(...boxes.map((b) => b.c1))
  const r2 = Math.max(...boxes.map((b) => b.r2))
  const c2 = Math.max(...boxes.map((b) => b.c2))
  const hasNames = series.some((s) => s.name)
  const hasCats = series.some((s) => s.cats)
  const prefix = sheet && sheet.toUpperCase() !== String(sheetName).toUpperCase() ? "'" + sheet.replace(/'/g, "''") + "'!" : ''

  const head = groups[0][2]
  let type = kinds[0]
  if (type === 'bar') type = val(head, 'barDir') === 'bar' ? 'bar' : 'column'
  if (type === 'bubble3D') type = 'bubble'
  if (kinds.includes('bar') && kinds.includes('line')) type = 'combo'
  const grouping = val(head, 'grouping')
  const chart = {
    type,
    data: prefix + numToCol(c1) + r1 + ':' + numToCol(c2) + r2,
    seriesIn: columns ? 'columns' : 'rows',
    // Names sit in the first row of column series (first column of row
    // series); categories in the first column (first row).
    labels: columns ? { row: hasNames, col: hasCats } : { row: hasCats, col: hasNames }
  }
  if (grouping === 'stacked') chart.stacked = true
  if (grouping === 'percentStacked') chart.percent = true
  if (type === 'combo') { chart.lineSeries = lineSeries; if (secondAxis.length) chart.secondAxis = secondAxis }
  const chartTitle = val(xml, 'autoTitleDeleted') === '1' ? null : titleOf(first(xml, /<c:chart>[\s\S]*?(<c:title>[\s\S]*?<\/c:title>)/))
  if (chartTitle) chart.title = chartTitle
  const legend = first(xml, /(<c:legend>[\s\S]*?<\/c:legend>)/)
  chart.legend = !legend ? 'none' : val(legend, 'legendPos') === 'r' ? 'right' : 'bottom'
  if (/<c:dLbls>[\s\S]*?<c:showVal val="1"/.test(plot)) chart.dataLabels = true
  const catAx = first(plot, /(<c:(?:catAx|dateAx)>[\s\S]*?<\/c:(?:catAx|dateAx)>)/) || (type === 'scatter' ? first(plot, /(<c:valAx>[\s\S]*?<\/c:valAx>)/) : null)
  const valAxes = [...plot.matchAll(/<c:valAx>([\s\S]*?)<\/c:valAx>/g)].map((m) => m[1])
  const valAx = type === 'scatter' ? valAxes[1] : valAxes[0]
  const xTitle = catAx && titleOf(first(catAx, /(<c:title>[\s\S]*?<\/c:title>)/))
  const yTitle = valAx && titleOf(first(valAx, /(<c:title>[\s\S]*?<\/c:title>)/))
  if (xTitle) chart.xTitle = xTitle
  if (yTitle) chart.yTitle = yTitle
  return chart
}

// A sheet's column widths and row heights in pixels, from its XML.
function gridOf (sheetXml) {
  const fmt = first(sheetXml, /(<sheetFormatPr\s[^>]*>)/)
  const chars = Number(attr(fmt, 'defaultColWidth')) || (Number(attr(fmt, 'baseColWidth')) || 8) + 0.43
  const defCol = Math.round(chars * 7 + 5)
  const defRow = Math.round((Number(attr(fmt, 'defaultRowHeight')) || 15) * 4 / 3)
  const cols = []
  for (const m of String(sheetXml).matchAll(/<col\s[^>]*>/g)) {
    const w = Number(attr(m[0], 'width'))
    if (!w) continue
    for (let c = Number(attr(m[0], 'min')); c <= Math.min(Number(attr(m[0], 'max')), 1000); c++) cols[c] = Math.round(w * 7 + 5)
  }
  const rows = []
  for (const m of String(sheetXml).matchAll(/<row\s[^>]*>/g)) {
    const ht = Number(attr(m[0], 'ht'))
    if (ht) rows[Number(attr(m[0], 'r'))] = Math.round(ht * 4 / 3)
  }
  return { col: (c) => cols[c] || defCol, row: (r) => rows[r] || defRow }
}

// A histogram or waterfall in Excel's newer chart format (chartex).
// names: the workbook's defined names (Excel's _xlchart.v1.N point at cells).
function chartexFrom (xml, sheetName, names = {}) {
  const series = first(xml, /(<cx:series\s[\s\S]*?<\/cx:series>)/)
  if (!series) return null
  const layoutId = attr(first(series, /(<cx:series\s[^>]*>)/), 'layoutId')
  const type = layoutId === 'waterfall' ? 'waterfall' : /<cx:binning/.test(series) ? 'histogram' : null
  if (!type) return null
  const f = (re) => { const m = re.exec(xml); if (!m) return null; const t = unesc(m[1]).trim(); return (names[t] || t).replace(/\$/g, '') }
  const vals = f(/<cx:numDim type="val">\s*<cx:f[^>]*>([\s\S]*?)<\/cx:f>/)
  if (!vals) return null
  const cats = f(/<cx:strDim type="cat">\s*<cx:f[^>]*>([\s\S]*?)<\/cx:f>/)
  const name = f(/<cx:txData>\s*<cx:f[^>]*>([\s\S]*?)<\/cx:f>/)
  const boxes = [vals, cats, name].filter(Boolean).map(parseRange)
  if (boxes.some((b) => !b)) return null
  const sheet = boxes[0].sheet || sheetName
  if (boxes.some((b) => (b.sheet || sheetName).toUpperCase() !== sheet.toUpperCase())) return null
  const r1 = Math.min(...boxes.map((b) => b.r1))
  const c1 = Math.min(...boxes.map((b) => b.c1))
  const r2 = Math.max(...boxes.map((b) => b.r2))
  const c2 = Math.max(...boxes.map((b) => b.c2))
  const prefix = sheet.toUpperCase() !== String(sheetName).toUpperCase() ? "'" + sheet.replace(/'/g, "''") + "'!" : ''
  const chart = { type, data: prefix + numToCol(c1) + r1 + ':' + numToCol(c2) + r2, seriesIn: 'columns', labels: { row: !!name, col: !!cats }, legend: 'none' }
  const title = texts(first(xml, /<cx:title[\s\S]*?(<cx:tx>[\s\S]*?<\/cx:tx>)/)) || f(/<cx:title[\s\S]*?<cx:v>([\s\S]*?)<\/cx:v>/)
  if (title) chart.title = title
  const bin = Number(attr(first(series, /(<cx:binSize\s[^>]*>)/), 'val'))
  if (type === 'histogram' && bin > 0) chart.binWidth = bin
  if (type === 'waterfall') chart.totals = [...series.matchAll(/<cx:subtotals>[\s\S]*?<\/cx:subtotals>/g)].flatMap((m) => [...m[0].matchAll(/<cx:idx val="(\d+)"/g)].map((x) => Number(x[1])))
  return chart
}

// Where a drawing anchor puts a chart: { anchor, size } in pixels.
function placeOf (anchorXml, grid) {
  const pos = (tag) => {
    const m = new RegExp('<xdr:' + tag + '>([\\s\\S]*?)</xdr:' + tag + '>').exec(anchorXml)
    if (!m) return null
    const n = (k) => Number(first(m[1], new RegExp('<xdr:' + k + '>(-?\\d+)</xdr:' + k + '>'))) || 0
    return { col: n('col'), colOff: n('colOff') / EMU, row: n('row'), rowOff: n('rowOff') / EMU }
  }
  const from = pos('from') || { col: 0, colOff: 0, row: 0, rowOff: 0 }
  const to = pos('to')
  const ext = first(anchorXml, /(<xdr:ext\s[^>]*>)/)
  // A two-cell anchor gives the far corner as a cell: add up the widths
  // and heights between (1-based columns and rows in grid).
  const across = (a, b, size) => { let px = 0; for (let k = a + 1; k <= b; k++) px += size(k); return px }
  const w = ext ? Number(attr(ext, 'cx')) / EMU : to ? across(from.col, to.col, grid.col) + to.colOff - from.colOff : 480
  const h = ext ? Number(attr(ext, 'cy')) / EMU : to ? across(from.row, to.row, grid.row) + to.rowOff - from.rowOff : 300
  return {
    anchor: { row: from.row + 1, col: from.col + 1, dx: Math.round(from.colOff), dy: Math.round(from.rowOff) },
    size: { w: Math.max(240, Math.min(2000, Math.round(w))), h: Math.max(160, Math.min(2000, Math.round(h))) }
  }
}

// Each tab's charts, in tab order: [[chart spec]]. sheetNames: the
// workbook's sheet names in order (to know which tab a reference means).
function chartsFromXlsx (bytes, fflate, sheetNames) {
  let files
  try { files = fflate.unzipSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)) } catch { return [] }
  const read = (p) => (files[p] ? fflate.strFromU8(files[p]) : '')
  const { sheetPaths } = require('./xlsxStyles')
  const names = {}
  for (const m of read('xl/workbook.xml').matchAll(/<definedName\s([^>]*)>([\s\S]*?)<\/definedName>/g)) {
    const n = attr('<x ' + m[1] + '>', 'name')
    if (n) names[n] = unesc(m[2]).trim()
  }
  return sheetPaths(files, fflate.strFromU8).map((path, i) => {
    const out = []
    if (!path || !files[path]) return out
    const rid = attr(first(read(path), /(<drawing\s[^>]*>)/), 'r:id')
    const drawing = rid && relsOf(files, path, fflate.strFromU8)[rid]
    if (!drawing || !files[drawing]) return out
    const drawingRels = relsOf(files, drawing, fflate.strFromU8)
    const grid = gridOf(read(path))
    for (const m of read(drawing).matchAll(/<xdr:(oneCellAnchor|twoCellAnchor|absoluteAnchor)[\s\S]*?<\/xdr:\1>/g)) {
      // Excel's newer chart format first (histogram, waterfall), then the
      // classic chart (or the newer one's fallback).
      const exRid = attr(first(m[0], /(<cx:chart\s[^>]*>)/), 'r:id')
      const exPart = exRid && drawingRels[exRid]
      const chartRid = attr(first(m[0], /(<c:chart\s[^>]*>)/), 'r:id')
      const part = chartRid && drawingRels[chartRid]
      try {
        const chart = (exPart && files[exPart] && chartexFrom(read(exPart), sheetNames[i] || '', names)) || (part && files[part] && chartFrom(read(part), sheetNames[i] || ''))
        if (chart) out.push({ ...chart, ...placeOf(m[0], grid) })
      } catch {}
    }
    return out
  })
}

module.exports = { chartsFromXlsx, chartFrom }
