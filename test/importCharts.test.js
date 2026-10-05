// Charts read from imported .xlsx files (src/shared/xlsxChartsRead.js).

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const XLSX = require('xlsx/dist/xlsx.mini.min.js')
const fflate = require('fflate')
const model = require('../src/shared/sheetModel')
const { workbookBytes, workbookToTabs, READ_OPTIONS } = require('../src/shared/xlsxMap')
const { chartsFromXlsx } = require('../src/shared/xlsxChartsRead')

const cells = []
const put = (r, c, v) => cells.push({ row: r, col: c, input: String(v), value: v, fmt: {} })
put(1, 1, 'Month'); put(1, 2, 'Rent'); put(1, 3, 'Food')
;[['Jan', 900, 200], ['Feb', 900, 250], ['Mar', 950, 180]].forEach((l, i) => l.forEach((v, j) => put(i + 2, j + 1, v)))
const resolved = { categories: ['Jan', 'Feb', 'Mar'], series: [{ name: 'Rent', values: [900, 900, 950] }, { name: 'Food', values: [200, 250, 180] }] }
const base = { data: 'A1:C4', seriesIn: 'columns', labels: { row: true, col: true }, resolved, size: { w: 480, h: 300 } }
const KINDS = ['column', 'combo', 'pie', 'scatter', 'bar', 'area', 'doughnut', 'line']

test('charts go out to .xlsx and come back into a sheet', () => {
  const charts = [
    { ...base, id: 'a', type: 'column', title: 'Costs', anchor: { row: 2, col: 6, dx: 0, dy: 0 }, stacked: true, legend: 'right', xTitle: 'Month', yTitle: 'EUR' },
    { ...base, id: 'b', type: 'combo', lineSeries: [1], secondAxis: [1], anchor: { row: 20, col: 6, dx: 5, dy: 3 } },
    { ...base, id: 'c', type: 'pie', anchor: { row: 2, col: 14, dx: 0, dy: 0 }, dataLabels: true }
  ]
  const bytes = workbookBytes(XLSX, fflate, { title: 'T', tabs: [{ name: 'Budget', cells, widths: {}, charts }] })
  const wb = XLSX.read(bytes, { type: 'array', ...READ_OPTIONS })
  const { tabs } = workbookToTabs(XLSX, wb)
  tabs[0].charts = chartsFromXlsx(bytes, fflate, wb.SheetNames)[0]
  const doc = model.createDoc()
  model.initSheet(doc)
  model.importTabs(doc, { tabs })
  const back = model.getCharts(doc, model.tabIds(doc)[0]).sort((x, y) => x.anchor.row - y.anchor.row || x.anchor.col - y.anchor.col)
  assert.deepEqual(back.map((c) => [c.type, c.data, c.anchor.row, c.anchor.col, c.size.w, c.size.h]), [
    ['column', 'A1:C4', 2, 6, 480, 300], ['pie', 'A1:B4', 2, 14, 480, 300], ['combo', 'A1:C4', 20, 6, 480, 300]
  ])
  const col = back[0]
  assert.deepEqual([col.title, col.stacked, col.legend, col.xTitle, col.yTitle, col.seriesIn, col.labels], ['Costs', true, 'right', 'Month', 'EUR', 'columns', { row: true, col: true }])
  assert.deepEqual([back[2].lineSeries, back[2].secondAxis], [[1], [1]])
  assert.equal(back[1].dataLabels, true)
})

test('charts in a file saved by LibreOffice', () => {
  const back = chartsFromXlsx(fs.readFileSync(path.join(__dirname, 'fixtures/libreoffice-charts.xlsx')), fflate, ['Budget'])[0]
  assert.deepEqual(back.map((c) => c.type), KINDS)
  for (const c of back) {
    assert.ok(Math.abs(c.size.w - 480) < 30 && Math.abs(c.size.h - 300) < 30, c.type + ' size ' + JSON.stringify(c.size))
    assert.equal(c.data, c.type === 'pie' || c.type === 'doughnut' ? 'A1:B4' : 'A1:C4')
  }
  assert.equal(back[0].title, 'Costs')
  assert.equal(back[5].percent, true)
})
