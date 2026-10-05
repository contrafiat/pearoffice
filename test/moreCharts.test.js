// Radar, bubble, stock, histogram and waterfall charts
// (proposals/2026-10-05-more-chart-types.md).

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const XLSX = require('xlsx/dist/xlsx.mini.min.js')
const fflate = require('fflate')
const { histogram, waterfall, chartData, rangeBlock, parseRange } = require('../src/shared/charts')
const { workbookBytes } = require('../src/shared/xlsxMap')
const { chartsFromXlsx } = require('../src/shared/xlsxChartsRead')

test('histogram bins: Scott\'s rule, a set width, edges as Excel', () => {
  const values = [1, 2, 2, 3, 3, 3, 4, 4, 5, 7, 8, 8, 9, 12]
  const auto = histogram(values)
  assert.deepEqual(auto.map((b) => b.count), [9, 4, 1])
  assert.deepEqual(auto.map((b) => b.label), ['[1, 5.68]', '(5.68, 10.36]', '(10.36, 15.04]'])
  const fixed = histogram(values, 5)
  assert.deepEqual(fixed.map((b) => [b.label, b.count]), [['[1, 6]', 9], ['(6, 11]', 4], ['(11, 16]', 1]])
  assert.deepEqual(histogram([4, 4, 4]).map((b) => b.count), [3], 'all the same: one bin')
  assert.deepEqual(histogram([null, 'x']), [])
})

test('waterfall bars run on from each other; totals start at zero', () => {
  assert.deepEqual(waterfall([100, 40, -30, null, 95], [4]), [
    { start: 0, end: 100, kind: 'up' }, { start: 100, end: 140, kind: 'up' }, { start: 140, end: 110, kind: 'down' },
    { start: 110, end: 110, kind: 'up' }, { start: 0, end: 95, kind: 'total' }
  ])
})

test('bubble data: X first, then Y and size per series', () => {
  const block = [['X', 'Y', 'Size'], [1, 5, 10], [2, 7, 30]].map((l) => l.map((v) => ({ num: typeof v === 'number' ? v : null, text: String(v) })))
  const d = chartData(block, { type: 'bubble', seriesIn: 'columns', labels: { row: true, col: true } })
  assert.deepEqual(d, { categories: [1, 2], series: [{ name: 'Y', values: [5, 7] }, { name: 'Size', values: [10, 30] }] })
})

function workbook () {
  const grid = new Map()
  const cells = []
  const put = (r, c, v) => { cells.push({ row: r, col: c, input: String(v), value: v, fmt: {} }); grid.set(r + ',' + c, { value: v, display: String(v) }) }
  ;[['Day', 'Open', 'High', 'Low', 'Close'], ['Mon', 10, 14, 9, 13], ['Tue', 13, 15, 11, 12], ['Wed', 12, 16, 12, 15], ['Thu', 15, 17, 13, 14]].forEach((l, i) => l.forEach((v, j) => put(i + 1, j + 1, v)))
  ;[['X', 'Y', 'Size'], [1, 5, 10], [2, 7, 30], [3, 4, 20]].forEach((l, i) => l.forEach((v, j) => put(i + 1, j + 7, v)))
  ;[['Item', 'Change'], ['Start', 100], ['Sales', 40], ['Costs', -30], ['End', 110]].forEach((l, i) => l.forEach((v, j) => put(i + 1, j + 11, v)))
  const at = (r, c) => grid.get(r + ',' + c) || null
  const mk = (type, data, extra = {}) => {
    const ch = { id: type, type, data, seriesIn: 'columns', labels: { row: true, col: true }, size: { w: 480, h: 300 }, anchor: { row: 10, col: 1, dx: 0, dy: 0 }, ...extra }
    ch.resolved = chartData(rangeBlock(parseRange(data), at), ch)
    return ch
  }
  const charts = [
    mk('radar', 'A1:C5', { title: 'Radar' }), mk('bubble', 'G1:I4'), mk('stock', 'A1:E5'),
    mk('histogram', 'B1:B5', { labels: { row: true, col: false }, binWidth: 2 }), mk('waterfall', 'K1:L5', { totals: [3] })
  ]
  return workbookBytes(XLSX, fflate, { title: 'T', tabs: [{ name: 'Data', cells, widths: {}, charts }] })
}

test('all five go out to .xlsx and come back', () => {
  const bytes = workbook()
  const files = fflate.unzipSync(bytes)
  assert.ok(files['xl/charts/chartEx4.xml'] && files['xl/charts/chartEx5.xml'], 'histogram and waterfall in Excel\'s newer format')
  assert.match(fflate.strFromU8(files['xl/workbook.xml']), /<definedName name="_xlchart\.v1\.0" hidden="1">/)
  // As Excel writes them (test/fixtures/excel-histogram-waterfall.xlsx): no
  // dir on the data references, style and colour parts, a text-box fallback.
  // Excel for the web repaired the file and dropped both charts otherwise.
  assert.ok(!files['xl/charts/chart4.xml'] && !files['xl/charts/chart5.xml'], 'no classic chart for these two')
  assert.doesNotMatch(fflate.strFromU8(files['xl/charts/chartEx4.xml']), / dir=/)
  assert.match(fflate.strFromU8(files['xl/charts/_rels/chartEx5.xml.rels']), /chartStyle" Target="style5\.xml".*chartColorStyle" Target="colors5\.xml"/)
  assert.match(fflate.strFromU8(files['xl/charts/style5.xml']), /<cs:chartStyle [^>]*id="395"/)
  assert.match(fflate.strFromU8(files['[Content_Types].xml']), /\/xl\/charts\/colors4\.xml" ContentType="application\/vnd\.ms-office\.chartcolorstyle\+xml"/)
  const drawing = fflate.strFromU8(files['xl/drawings/drawing1.xml'])
  assert.match(drawing, /<mc:Fallback><xdr:sp macro="" textlink="">/)
  assert.doesNotMatch(drawing, /<mc:Fallback><xdr:graphicFrame/)
  const back = chartsFromXlsx(bytes, fflate, ['Data'])[0]
  assert.deepEqual(back.map((c) => [c.type, c.data]), [['radar', 'A1:C5'], ['bubble', 'G1:I4'], ['stock', 'A1:E5'], ['histogram', 'B1:B5'], ['waterfall', 'K1:L5']])
  assert.equal(back[0].title, 'Radar')
  assert.equal(back[3].binWidth, 2)
  assert.deepEqual(back[4].totals, [3])
  const XLSXread = XLSX.read(bytes, { type: 'array' })
  assert.ok(!(XLSXread.Workbook && XLSXread.Workbook.Names || []).some((n) => /^_xlchart/.test(n.Name) && !n.Hidden), 'the chart names are hidden')
})

test('a histogram and a waterfall made in Excel come in', () => {
  const back = chartsFromXlsx(fs.readFileSync(path.join(__dirname, 'fixtures/excel-histogram-waterfall.xlsx')), fflate, ['Sheet1'])[0]
  assert.deepEqual(back.map((c) => [c.type, c.data, c.title]), [['histogram', 'A1:A31', 'Histogram'], ['waterfall', 'D1:E7', 'Waterfall']])
})

test('radar, bubble and stock in a file saved by LibreOffice', () => {
  const back = chartsFromXlsx(fs.readFileSync(path.join(__dirname, 'fixtures/libreoffice-more-charts.xlsx')), fflate, ['Data'])[0]
  assert.deepEqual(back.slice(0, 3).map((c) => [c.type, c.data]), [['radar', 'A1:C5'], ['bubble', 'G1:I4'], ['stock', 'A1:E5']])
})
