// Charts written into .xlsx files (src/sheet/xlsxCharts.js).
// scripts/check-chart-export.js opens such a file in LibreOffice.

const test = require('node:test')
const assert = require('node:assert/strict')
const XLSX = require('xlsx/dist/xlsx.mini.min.js')
const fflate = require('fflate')
const { workbookBytes } = require('../src/sheet/xlsxMap')

const resolved = { categories: ['Jan', 'Feb'], series: [{ name: 'Rent', values: [1200, 1250] }, { name: 'Food', values: [400, null] }] }
const chart = (extra) => ({ id: 'c', data: 'A1:C3', labels: { row: true, col: true }, seriesIn: 'columns', anchor: { row: 5, col: 2, dx: 3, dy: 4 }, size: { w: 480, h: 300 }, resolved, ...extra })
const cells = [['Month', 'Rent', 'Food'], ['Jan', 1200, 400], ['Feb', 1250, null]].flatMap((line, r) => line.map((v, c) => ({ row: r + 1, col: c + 1, input: v === null ? '' : String(v), value: v, fmt: {} })))

test('a chart becomes a chart part, a drawing and the links between them', () => {
  const dump = {
    title: 'Budget',
    tabs: [
      { name: 'Costs [2026]', cells, widths: {}, charts: [chart({ type: 'column', title: 'Costs', dataLabels: true, trendline: [0] }), chart({ id: 'd', type: 'combo', lineSeries: [1], secondAxis: [1] })] },
      { name: 'Empty', cells: [], widths: {}, charts: [chart({ id: 'e', resolved: { error: 'no data' } })] }
    ]
  }
  const files = fflate.unzipSync(workbookBytes(XLSX, fflate, dump))
  const str = (n) => fflate.strFromU8(files[n])
  assert.ok(files['xl/charts/chart1.xml'] && files['xl/charts/chart2.xml'] && !files['xl/charts/chart3.xml'], 'charts without data are left out')
  const one = str('xl/charts/chart1.xml')
  assert.match(one, /<c:barChart><c:barDir val="col"\/><c:grouping val="clustered"\/>/)
  assert.match(one, /<c:f>'Costs  2026 '!\$B\$2:\$B\$3<\/c:f>/, 'values refer to the cells, under the name the workbook uses')
  assert.match(one, /<c:f>'Costs  2026 '!\$B\$1<\/c:f>/, 'the series name refers to its cell')
  assert.match(one, /<c:pt idx="1"><c:v>1250<\/c:v><\/c:pt>/, 'current values are cached')
  assert.match(one, /<c:showVal val="1"\/>/)
  assert.match(one, /<c:trendlineType val="linear"\/>/)
  const two = str('xl/charts/chart2.xml')
  assert.match(two, /<c:barChart>.*<c:lineChart>/s, 'combo: bars and a line')
  assert.match(two, /<c:crosses val="max"\/>/, 'with a right-hand axis')
  const drawing = str('xl/drawings/drawing1.xml')
  assert.equal((drawing.match(/<xdr:oneCellAnchor>/g) || []).length, 2)
  assert.match(drawing, /<xdr:col>1<\/xdr:col><xdr:colOff>28575<\/xdr:colOff><xdr:row>4<\/xdr:row>/, 'anchored at B5 with its offset')
  assert.match(str('xl/drawings/_rels/drawing1.xml.rels'), /Target="\.\.\/charts\/chart2\.xml"/)
  assert.match(str('xl/worksheets/_rels/sheet1.xml.rels'), /drawings\/drawing1\.xml/)
  assert.match(str('xl/worksheets/sheet1.xml'), /<\/ignoredErrors><drawing r:id="rIdDrawing1"\/><\/worksheet>$/, 'after ignoredErrors, as the schema orders it')
  assert.ok(!files['xl/worksheets/_rels/sheet2.xml.rels'])
  const types = str('[Content_Types].xml')
  assert.match(types, /PartName="\/xl\/charts\/chart1\.xml" ContentType="application\/vnd\.openxmlformats-officedocument\.drawingml\.chart\+xml"/)
  assert.match(types, /PartName="\/xl\/drawings\/drawing1\.xml"/)
  const back = XLSX.read(workbookBytes(XLSX, fflate, dump), { type: 'array' })
  assert.equal(back.Sheets[back.SheetNames[0]].B2.v, 1200, 'the file still reads')
})
