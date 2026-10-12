// Charts in .ods files (LibreOffice and OpenOffice). A chart there is an
// embedded chart document ("Object 1/content.xml") drawn by a frame inside
// the cell it is anchored to. Its series refer to the sheet's cells, so
// LibreOffice draws it from them; no values are cached in it.
//
// Writing covers every PearOffice type LibreOffice has: column, bar, line,
// area, pie, doughnut, scatter, radar and combo (columns with lines, a second
// axis). Bubble goes out as scatter, stock as line, histogram and waterfall
// as columns. Reading takes the same set back.

const { parseRange } = require('./charts')
const { numToCol } = require('./a1')
const { layout, PALETTE } = require('./xlsxCharts')

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const cm = (px) => (Math.round(px * 2.54 / 96 * 1000) / 1000) + 'cm'

// "'My tab'!$A$2:$A$3" (the .xlsx form layout() gives) -> "'My tab'.A2:'My tab'.A3".
function odfRange (ref) {
  const m = /^'((?:[^']|'')*)'!\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/.exec(String(ref || ''))
  if (!m) return null
  const sheet = "'" + m[1] + "'."
  return sheet + m[2] + m[3] + ':' + sheet + (m[4] || m[2]) + (m[5] || m[3])
}

const CLASS = { column: 'bar', bar: 'bar', line: 'line', area: 'area', pie: 'circle', doughnut: 'ring', scatter: 'scatter', radar: 'radar', combo: 'bar', bubble: 'scatter', stock: 'line', histogram: 'bar', waterfall: 'bar' }

const NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:chart="urn:oasis:names:tc:opendocument:xmlns:chart:1.0" xmlns:number="urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0"'

// One chart's embedded document, or null when it has no data.
function chartContent (chart, sheet) {
  if (!chart.resolved || chart.resolved.error || !parseRange(chart.data)) return null
  const place = layout(chart, sheet)
  const cls = CLASS[chart.type] || 'bar'
  const lines = new Set(chart.type === 'combo' ? chart.lineSeries || [] : [])
  const second = new Set(chart.type === 'combo' ? chart.secondAxis || [] : [])
  const plot = ['chart:vertical="' + (chart.type === 'bar') + '"']
  if (chart.stacked) plot.push('chart:stacked="true"')
  if (chart.percent) plot.push('chart:percentage="true"')
  if (chart.dataLabels) plot.push('chart:data-label-number="value"')
  if (cls === 'line' || cls === 'radar' || cls === 'scatter') plot.push('chart:symbol-type="' + (cls === 'scatter' ? 'automatic' : 'none') + '"')
  if (cls === 'scatter') plot.push('chart:lines="false"')
  const styles = ['<style:style style:name="pa" style:family="chart"><style:chart-properties ' + plot.join(' ') + '/></style:style>',
    // A white chart and plot, axes with their numbers and names shown.
    '<style:style style:name="bg" style:family="chart"><style:graphic-properties draw:fill="solid" draw:fill-color="#ffffff" draw:stroke="none"/></style:style>',
    '<style:style style:name="wall" style:family="chart"><style:graphic-properties draw:fill="none" draw:stroke="none"/></style:style>',
    '<style:style style:name="ax" style:family="chart"><style:chart-properties chart:display-label="true"/><style:graphic-properties svg:stroke-color="#b3b3b3"/></style:style>',
    '<style:style style:name="grid" style:family="chart"><style:graphic-properties svg:stroke-color="#e0e0e0"/></style:style>']
  const series = place.series.map((s, i) => {
    const color = '#' + PALETTE[i % PALETTE.length]
    styles.push('<style:style style:name="s' + i + '" style:family="chart"><style:chart-properties' + (chart.dataLabels ? ' chart:data-label-number="value"' : '') + '/>' +
      '<style:graphic-properties draw:fill-color="' + color + '" svg:stroke-color="' + color + '"' + (cls === 'line' || cls === 'radar' || lines.has(i) ? ' svg:stroke-width="0.08cm"' : '') + '/></style:style>')
    const values = odfRange(s.valuesRef)
    if (!values) return ''
    const attrs = ['chart:style-name="s' + i + '"', 'chart:values-cell-range-address="' + esc(values) + '"']
    const name = odfRange(s.nameRef)
    if (name) attrs.push('chart:label-cell-address="' + esc(name) + '"')
    // A doughnut's series are pie series, as LibreOffice writes them.
    attrs.push('chart:class="chart:' + (lines.has(i) ? 'line' : cls === 'ring' ? 'circle' : cls) + '"')
    if (second.has(i)) attrs.push('chart:attached-axis="secondary-y"')
    const domain = cls === 'scatter' && i === 0 && place.categories ? '<chart:domain table:cell-range-address="' + esc(odfRange(place.categories)) + '"/>' : ''
    return '<chart:series ' + attrs.join(' ') + '>' + domain + '</chart:series>'
  }).join('')
  const title = (t) => (t ? '<chart:title><text:p>' + esc(t) + '</text:p></chart:title>' : '')
  const cats = cls !== 'scatter' && place.categories ? '<chart:categories table:cell-range-address="' + esc(odfRange(place.categories)) + '"/>' : ''
  const axes = cls === 'circle' || cls === 'ring'
    ? '<chart:axis chart:dimension="x" chart:name="primary-x">' + cats + '</chart:axis><chart:axis chart:dimension="y" chart:name="primary-y"/>'
    : '<chart:axis chart:dimension="x" chart:name="primary-x" chart:style-name="ax">' + title(chart.xTitle) + cats + '</chart:axis>' +
      '<chart:axis chart:dimension="y" chart:name="primary-y" chart:style-name="ax">' + title(chart.yTitle) + '<chart:grid chart:class="major" chart:style-name="grid"/></chart:axis>' +
      (second.size ? '<chart:axis chart:dimension="y" chart:name="secondary-y" chart:style-name="ax"/>' : '')
  const legend = chart.legend === 'none' ? '' : '<chart:legend chart:legend-position="' + (chart.legend === 'right' ? 'end' : 'bottom') + '" style:legend-expansion="' + (chart.legend === 'right' ? 'high' : 'wide') + '"/>'
  const size = chart.size || { w: 480, h: 300 }
  return '<?xml version="1.0" encoding="UTF-8"?>\n<office:document-content ' + NS + ' office:version="1.3">' +
    '<office:automatic-styles>' + styles.join('') + '</office:automatic-styles>' +
    '<office:body><office:chart><chart:chart svg:width="' + cm(size.w) + '" svg:height="' + cm(size.h) + '" chart:class="chart:' + cls + '" chart:style-name="bg" xlink:href=".." xlink:type="simple">' +
    title(chart.title) + legend + '<chart:plot-area chart:style-name="pa">' + axes + series + '<chart:wall chart:style-name="wall"/></chart:plot-area>' +
    '</chart:chart></office:chart></office:body></office:document-content>'
}

const CHART_STYLES = '<?xml version="1.0" encoding="UTF-8"?>\n<office:document-styles ' + NS + ' office:version="1.3"><office:styles/></office:document-styles>'

// Adds each tab's charts to a .ods SheetJS wrote: the chart documents, their
// manifest entries, and a frame in each anchor cell. tabs: [{ name, charts }]
// in sheet order, names as the file has them. The anchor cells must be inside
// each sheet's written range (writeOds makes sure of it).
function addChartsToOds (files, tabs, fflate) {
  const frames = [] // [tab, row, col (from 0), frame xml]
  let n = 0
  tabs.forEach((tab, t) => {
    for (const chart of tab.charts || []) {
      const content = chartContent(chart, tab.name)
      if (!content) continue
      n++
      const dir = 'Object ' + n
      files[dir + '/content.xml'] = fflate.strToU8(content)
      files[dir + '/styles.xml'] = fflate.strToU8(CHART_STYLES)
      const a = chart.anchor || { row: 1, col: 1, dx: 0, dy: 0 }
      const size = chart.size || { w: 480, h: 300 }
      frames.push([t, a.row - 1, a.col - 1, '<draw:frame draw:z-index="' + (n - 1) + '" draw:name="' + esc(chart.title || 'Chart ' + n) + '" svg:width="' + cm(size.w) + '" svg:height="' + cm(size.h) + '" svg:x="' + cm(a.dx || 0) + '" svg:y="' + cm(a.dy || 0) + '">' +
        '<draw:object xlink:href="./' + dir + '" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/></draw:frame>'])
    }
  })
  if (!n) return
  const manifest = fflate.strFromU8(files['META-INF/manifest.xml'])
  let entries = ''
  for (let i = 1; i <= n; i++) {
    entries += '<manifest:file-entry manifest:full-path="Object ' + i + '/" manifest:media-type="application/vnd.oasis.opendocument.chart"/>' +
      '<manifest:file-entry manifest:full-path="Object ' + i + '/content.xml" manifest:media-type="text/xml"/>' +
      '<manifest:file-entry manifest:full-path="Object ' + i + '/styles.xml" manifest:media-type="text/xml"/>'
  }
  files['META-INF/manifest.xml'] = fflate.strToU8(manifest.replace('</manifest:manifest>', entries + '</manifest:manifest>'))
  let xml = fflate.strFromU8(files['content.xml'])
  if (!/xmlns:xlink=/.test(xml)) xml = xml.replace('<office:document-content ', '<office:document-content xmlns:xlink="http://www.w3.org/1999/xlink" ')
  if (!/xmlns:draw=/.test(xml)) xml = xml.replace('<office:document-content ', '<office:document-content xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" ')
  if (!/xmlns:svg=/.test(xml)) xml = xml.replace('<office:document-content ', '<office:document-content xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" ')
  files['content.xml'] = fflate.strToU8(insertFrames(xml, frames))
}

// Puts each frame into its cell: [tab, row, col, xml].
function insertFrames (xml, frames) {
  const want = new Map()
  for (const [t, r, c, f] of frames) {
    const k = t + ',' + r + ',' + c
    want.set(k, (want.get(k) || '') + f)
  }
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
      if (close) { depth--; continue }
      depth++
      if (depth === 1) { tab++; row = -1 }
      continue
    }
    if (depth !== 1 || close) continue
    if (kind === 'table-row') { row += Number(/table:number-rows-repeated="(\d+)"/.exec(attrs)?.[1] || 1); col = 0; continue }
    const frame = want.get(tab + ',' + row + ',' + col)
    col += Number(/table:number-columns-repeated="(\d+)"/.exec(attrs)?.[1] || 1)
    if (!frame) continue
    out += xml.slice(last, m.index)
    if (selfClose) {
      out += '<table:' + kind + attrs.replace(/\s+$/, '') + '>' + frame + '</table:' + kind + '>'
      last = m.index + tag.length
    } else {
      // After a note, if the cell has one.
      const after = m.index + tag.length
      const note = /^\s*<office:annotation[\s\S]*?<\/office:annotation>/.exec(xml.slice(after))
      const at = after + (note ? note[0].length : 0)
      out += xml.slice(m.index, at) + frame
      last = at
    }
  }
  return out + xml.slice(last)
}

// --- reading -------------------------------------------------------------------

const unesc = (s) => String(s).replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
const attrOf = (tag, name) => { const m = new RegExp('\\s' + name + '="([^"]*)"').exec(tag || ''); return m ? unesc(m[1]) : null }
const PX = { cm: 96 / 2.54, mm: 96 / 25.4, in: 96, pt: 96 / 72, pc: 16, px: 1 }
const px = (len) => { const m = /^(-?[\d.]+)(cm|mm|in|pt|pc|px)?$/.exec(String(len || '').trim()); return m ? Number(m[1]) * (PX[m[2] || 'cm']) : 0 }

// "'My tab'.A2:'My tab'.A3" or "$Sheet1.$A$2:.$A$3" -> { sheet, ref: "A2:A3" }.
function fromOdfRange (s) {
  if (!s) return null
  // Only the first range of a list (ranges are separated by spaces outside
  // quotes), split at ":" outside quotes.
  const parts = []
  let cur = ''
  let q = false
  for (const ch of String(s).trim()) {
    if (ch === "'") q = !q
    if (/\s/.test(ch) && !q) break
    if (ch === ':' && !q) { parts.push(cur); cur = '' } else cur += ch
  }
  parts.push(cur)
  let sheet = null
  const cells = parts.map((p) => {
    const m = /^\$?('(?:[^']|'')*'|[^.]*)\.(.*)$/.exec(p)
    if (!m) return p.replace(/\$/g, '')
    if (m[1] && sheet === null) sheet = m[1][0] === "'" ? m[1].slice(1, -1).replace(/''/g, "'") : m[1]
    return m[2].replace(/\$/g, '')
  })
  return { sheet, ref: cells.join(':') }
}

// Every chart-properties attribute of the automatic styles, by style name.
function chartStyles (xml) {
  const out = {}
  for (const m of xml.matchAll(/<style:style\s([^>]*)>([\s\S]*?)<\/style:style>/g)) {
    const name = attrOf('<x ' + m[1] + '>', 'style:name')
    const props = /<style:chart-properties\s([^>]*?)\/?>/.exec(m[2])
    if (name) out[name] = props ? props[1] : ''
  }
  return out
}

// A chart document -> a PearOffice chart spec (no anchor or size), or null.
// sheetName: the tab the chart is on.
function chartFromOdf (xml, sheetName) {
  const head = /<chart:chart\s[^>]*>/.exec(xml)
  if (!head) return null
  const styles = chartStyles(xml)
  const plotTag = /<chart:plot-area\s[^>]*>/.exec(xml)?.[0] || ''
  const plot = styles[attrOf(plotTag, 'chart:style-name')] || ''
  const flag = (name) => new RegExp(name + '="true"').test(plot)
  const cls = (attrOf(head[0], 'chart:class') || '').replace('chart:', '')
  const seriesTags = [...xml.matchAll(/<chart:series\s([^>]*?)(\/>|>([\s\S]*?)<\/chart:series>)/g)]
  if (!seriesTags.length) return null
  const catTag = /<chart:categories\s[^>]*>/.exec(xml)?.[0]
  const domainTag = /<chart:domain\s[^>]*>/.exec(xml)?.[0]
  const cats = fromOdfRange(attrOf(catTag || domainTag, 'table:cell-range-address'))
  const series = []
  const lineSeries = []
  const secondAxis = []
  for (const [, attrs] of seriesTags) {
    const tag = '<x ' + attrs + '>'
    const vals = fromOdfRange(attrOf(tag, 'chart:values-cell-range-address'))
    if (!vals) return null
    const i = series.length
    series.push({ name: fromOdfRange(attrOf(tag, 'chart:label-cell-address')), vals })
    const sc = (attrOf(tag, 'chart:class') || '').replace('chart:', '')
    if (cls === 'bar' && sc === 'line') lineSeries.push(i)
    if (attrOf(tag, 'chart:attached-axis') === 'secondary-y') secondAxis.push(i)
  }
  // The data range: the block every reference fills, all on one tab.
  const boxes = []
  let sheet = null
  for (const r of [cats, ...series.flatMap((s) => [s.name, s.vals])]) {
    if (!r) continue
    const box = parseRange(r.ref)
    if (!box) return null
    const name = r.sheet || sheetName
    if (sheet === null) sheet = name
    else if (sheet.toUpperCase() !== name.toUpperCase()) return null
    boxes.push(box)
  }
  const v = parseRange(series[0].vals.ref)
  const columns = v.c1 === v.c2 && (v.r2 > v.r1 || series.length > 1 ? true : v.r1 === v.r2)
  const r1 = Math.min(...boxes.map((b) => b.r1))
  const c1 = Math.min(...boxes.map((b) => b.c1))
  const r2 = Math.max(...boxes.map((b) => b.r2))
  const c2 = Math.max(...boxes.map((b) => b.c2))
  const hasNames = series.some((s) => s.name)
  const hasCats = !!cats
  const prefix = sheet && sheet.toUpperCase() !== String(sheetName).toUpperCase() ? "'" + sheet.replace(/'/g, "''") + "'!" : ''
  let type = { bar: flag('chart:vertical') ? 'bar' : 'column', line: 'line', area: 'area', circle: 'pie', ring: 'doughnut', scatter: 'scatter', radar: 'radar', 'filled-radar': 'radar', bubble: 'scatter', stock: 'line' }[cls] || 'column'
  if (lineSeries.length) type = 'combo'
  const chart = {
    type,
    data: prefix + numToCol(c1) + r1 + ':' + numToCol(c2) + r2,
    seriesIn: columns ? 'columns' : 'rows',
    labels: columns ? { row: hasNames, col: hasCats } : { row: hasCats, col: hasNames }
  }
  if (flag('chart:stacked')) chart.stacked = true
  if (flag('chart:percentage')) chart.percent = true
  if (type === 'combo') { chart.lineSeries = lineSeries; if (secondAxis.length) chart.secondAxis = secondAxis }
  const text = (block) => (block ? unesc(block.replace(/<[^>]+>/g, '')).trim() : '')
  const titleOf = (inside) => text(/<chart:title\b[^>]*>([\s\S]*?)<\/chart:title>/.exec(inside || '')?.[1])
  const beforePlot = xml.slice(0, xml.indexOf('<chart:plot-area'))
  const title = titleOf(beforePlot)
  if (title) chart.title = title
  const legend = /<chart:legend\s[^>]*>/.exec(beforePlot)?.[0]
  chart.legend = !legend ? 'none' : /^(end|start)$/.test(attrOf(legend, 'chart:legend-position') || '') ? 'right' : 'bottom'
  if (/chart:data-label-number="(value|percentage|value-and-percentage)"/.test(Object.values(styles).join(' '))) chart.dataLabels = true
  const axis = (name) => /<chart:axis\s[^>]*chart:name="([^"]*)"[^>]*>([\s\S]*?)<\/chart:axis>/g
  for (const m of xml.matchAll(axis())) {
    const t = titleOf(m[2])
    if (!t) continue
    if (m[1] === 'primary-x') chart.xTitle = t
    if (m[1] === 'primary-y') chart.yTitle = t
  }
  return chart
}

// Each tab's charts in a .ods file, in tab order: [[chart spec with anchor
// and size]]. names: the tab names in order.
function chartsFromOds (files, fflate, names) {
  const read = (p) => (files[p] ? fflate.strFromU8(files[p]) : '')
  const xml = read('content.xml')
  const out = names.map(() => [])
  let tab = -1
  let depth = 0
  let row = -1
  let col = 0
  let cell = null // [row, col] of the cell being read
  const re = /<(\/?)(table:table-row|table:table-cell|table:covered-table-cell|table:table|draw:frame)(?=[\s/>])([^>]*?)(\/?)>/g
  let m
  while ((m = re.exec(xml))) {
    const [, close, kind, attrs, selfClose] = m
    if (kind === 'table:table') {
      if (close) { depth--; continue }
      depth++
      if (depth === 1) { tab++; row = -1 }
      continue
    }
    if (depth !== 1) continue
    if (kind === 'table:table-row') { if (!close) { row += Number(attrOf(attrs, 'table:number-rows-repeated')) || 1; col = 0 } continue }
    if (kind === 'table:table-cell' || kind === 'table:covered-table-cell') {
      if (close) { cell = null; continue }
      cell = selfClose ? null : [row, col]
      col += Number(attrOf(attrs, 'table:number-columns-repeated')) || 1
      continue
    }
    if (kind !== 'draw:frame' || close) continue
    const end = xml.indexOf('</draw:frame>', m.index)
    const body = xml.slice(m.index, end < 0 ? xml.length : end)
    const href = attrOf(/<draw:object\s[^>]*>/.exec(body)?.[0], 'xlink:href')
    if (!href || tab < 0 || tab >= names.length) continue
    const dir = href.replace(/^\.\//, '').replace(/\/$/, '')
    try {
      const chart = chartFromOdf(read(dir + '/content.xml'), names[tab])
      if (!chart) continue
      const w = px(attrOf(attrs, 'svg:width'))
      const h = px(attrOf(attrs, 'svg:height'))
      let anchor
      if (cell) {
        anchor = { row: cell[0] + 1, col: cell[1] + 1, dx: Math.round(px(attrOf(attrs, 'svg:x'))), dy: Math.round(px(attrOf(attrs, 'svg:y'))) }
      } else {
        // Placed on the sheet, not in a cell: LibreOffice's default cell size
        // (0.889in by 0.178in) gives the nearest cell.
        const x = px(attrOf(attrs, 'svg:x'))
        const y = px(attrOf(attrs, 'svg:y'))
        const cw = 0.889 * 96
        const rh = 0.178 * 96
        anchor = { row: Math.floor(y / rh) + 1, col: Math.floor(x / cw) + 1, dx: Math.round(x % cw), dy: Math.round(y % rh) }
      }
      out[tab].push({ ...chart, anchor, size: { w: Math.max(240, Math.min(2000, Math.round(w || 480))), h: Math.max(160, Math.min(2000, Math.round(h || 300))) } })
    } catch {}
  }
  return out
}

// The same, from the file's bytes.
function chartsFromOdsBytes (bytes, fflate, names) {
  let files
  try { files = fflate.unzipSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), { filter: (f) => f.name === 'content.xml' || /\/content\.xml$/.test(f.name) }) } catch { return names.map(() => []) }
  return chartsFromOds(files, fflate, names)
}

module.exports = { addChartsToOds, chartsFromOds, chartsFromOdsBytes, chartFromOdf, chartContent, odfRange, fromOdfRange }
