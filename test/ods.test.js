// .ods (OpenDocument, LibreOffice and OpenOffice): a sheet goes out and comes
// back with its values, formulas and tabs, and LibreOffice computes the same
// answers from the file we write.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const XLSX = require('xlsx/dist/xlsx.mini.min.js')
const fflate = require('fflate')
const model = require('../src/sheet/sheetModel')
const { evaluateSheet } = require('../src/sheet/formula')
const { workbookToTabs, odsBytes, READ_OPTIONS } = require('../src/sheet/xlsxMap')
const { toOds, fromOds, fixOdsWorkbook } = require('../src/sheet/odsFormula')

function dump (doc) {
  const values = evaluateSheet(doc)
  return {
    title: model.title(doc),
    tabs: model.tabIds(doc).map((id) => {
      const cells = []
      for (const [key, v] of values.get(id)) {
        const [row, col] = key.split(',').map(Number)
        cells.push({ row, col, input: v.from ? undefined : model.getInput(doc, id, row, col), value: v.error ? null : v.value, error: v.error, fmt: model.getFormat(doc, id, row, col) })
      }
      return { name: model.tabMap(doc, id).get('name'), cells, widths: {} }
    })
  }
}

function budget () {
  const doc = model.createDoc()
  model.initSheet(doc, { title: 'Budget' })
  const main = model.tabIds(doc)[0]
  model.renameTab(doc, main, 'Monthly')
  const { id: other } = model.addTab(doc, 'Rates & fees')
  model.setCells(doc, main, 1, 1, [['Item', 'Cost'], ['Rent', '1200'], ['Food', '450.5'], ['Total', '=SUM(B2:B3)'], ['Fee', "='Rates & fees'!A1*B4"], ['Code', "'007"], ['Flag', 'TRUE'],
    ['Label', '=IF(B4>1000,"big, really","small")'], ['Fixed', '=SUM($B$2:B3)*2'], ['Look', "=VLOOKUP(\"Rent\",A2:B3,2,FALSE)"]])
  model.setCell(doc, other, 1, 1, '0.02')
  return doc
}

function importBytes (bytes) {
  const doc = model.createDoc()
  model.initSheet(doc, { title: 'Back' })
  model.importTabs(doc, workbookToTabs(XLSX, fixOdsWorkbook(XLSX, fflate, XLSX.read(bytes, { type: 'array', ...READ_OPTIONS }), bytes)))
  return doc
}

test('a sheet survives export to .ods and import back', () => {
  const doc = importBytes(odsBytes(XLSX, fflate, dump(budget())))
  const [m, o] = model.tabIds(doc)
  const v = evaluateSheet(doc)
  assert.equal(model.tabMap(doc, m).get('name'), 'Monthly')
  assert.equal(model.tabMap(doc, o).get('name'), 'Rates & fees')
  assert.equal(model.getInput(doc, m, 4, 2), '=SUM(B2:B3)')
  assert.equal(v.get(m).get('4,2').value, 1650.5)
  assert.equal(model.getInput(doc, m, 5, 2), "='Rates & fees'!A1*B4")
  assert.equal(v.get(m).get('5,2').value, 33.01)
  assert.equal(v.get(m).get('6,2').value, '007', 'text that looks like a number stays text')
  assert.equal(v.get(m).get('7,2').value, true)
  assert.equal(model.getInput(doc, m, 8, 2), '=IF(B4>1000,"big, really","small")', 'commas in text stay commas')
  assert.equal(v.get(m).get('8,2').value, 'big, really')
  assert.equal(model.getInput(doc, m, 9, 2), '=SUM($B$2:B3)*2', '$ signs kept')
  assert.equal(v.get(m).get('10,2').value, 1200)
})

test('formulas convert to OpenFormula and back', () => {
  const cases = [
    ['IF(B1>1,"x,y","z")', 'of:=IF([.B1]>1;"x,y";"z")'],
    ["SUM('Rates & fees'!A1:A3)", "of:=SUM([$'Rates & fees'.A1:.A3])"],
    ['SUM($B$1:B2)', 'of:=SUM([.$B$1:.B2])'],
    ["VLOOKUP(A1,'Tab'!A:B,2,FALSE)", "of:=VLOOKUP([.A1];[$'Tab'.A:.B];2;FALSE())"],
    ['SUM(1:2)', 'of:=SUM([.1:.2])'],
    ['SUM({1,2;3,4})', 'of:=SUM({1;2|3;4})'],
    ['LOG10(100)+1.5E3', 'of:=LOG10(100)+1.5E3'],
    ['_xlfn.XLOOKUP(1,B1:B3,C1:C3)', 'of:=COM.MICROSOFT.XLOOKUP(1;[.B1:.B3];[.C1:.C3])']
  ]
  for (const [xlsx, ods] of cases) assert.equal(toOds(xlsx), ods)
  assert.equal(fromOds("of:=SUM([$'Rates & fees'.A1:.A3])"), "SUM('Rates & fees'!A1:A3)")
  assert.equal(fromOds('of:=SUM([$Sheet2.A1:.A3])'), 'SUM(Sheet2!A1:A3)')
  assert.equal(fromOds('of:=COM.MICROSOFT.LET(_xlpm.x;1;_xlpm.x+1)'), 'LET(x,1,x+1)')
  assert.equal(fromOds('of:=IF(TRUE();1;2)'), 'IF(TRUE,1,2)')
  assert.equal(fromOds('of:=[.A1]+[#REF!]'), 'A1+#REF!')
})

const soffice = (() => { try { execFileSync('soffice', ['--version'], { stdio: 'ignore' }); return true } catch { return false } })()

test('LibreOffice reads our .ods and computes the same totals, and we read its .ods', { skip: !soffice && 'needs soffice' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pearoffice-ods-'))
  try {
    const ours = path.join(dir, 'ours.ods')
    fs.writeFileSync(ours, odsBytes(XLSX, fflate, dump(budget())))
    // LibreOffice opens it and saves it again as its own .ods (it recalculates).
    const out = path.join(dir, 'lo')
    execFileSync('soffice', ['--headless', '-env:UserInstallation=file://' + path.join(dir, 'profile'), '--convert-to', 'ods', '--outdir', out, ours], { stdio: 'ignore', timeout: 120000 })
    const doc = importBytes(fs.readFileSync(path.join(out, 'ours.ods')))
    const [m] = model.tabIds(doc)
    const v = evaluateSheet(doc)
    assert.equal(model.getInput(doc, m, 4, 2), '=SUM(B2:B3)')
    assert.equal(v.get(m).get('4,2').value, 1650.5)
    assert.equal(v.get(m).get('5,2').value, 33.01)
    // What LibreOffice itself computed, from the cached values in its file.
    const wb = XLSX.read(fs.readFileSync(path.join(out, 'ours.ods')), { type: 'array' })
    assert.equal(wb.Sheets[wb.SheetNames[0]].B4.v, 1650.5)
    assert.equal(wb.Sheets[wb.SheetNames[0]].B5.v, 33.01)
    assert.equal(wb.Sheets[wb.SheetNames[0]].B8.v, 'big, really')
    assert.equal(wb.Sheets[wb.SheetNames[0]].B9.v, 3301)
    assert.equal(wb.Sheets[wb.SheetNames[0]].B10.v, 1200)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// Charts (src/sheet/odsCharts.js).
const { chartsFromOdsBytes } = require('../src/sheet/odsCharts')
function chartDump () {
  const resolved = { categories: ['Jan', 'Feb'], series: [{ name: 'Rent', values: [1200, 1250] }, { name: 'Food', values: [400, 300] }] }
  const cells = [['Month', 'Rent', 'Food'], ['Jan', 1200, 400], ['Feb', 1250, 300]].flatMap((line, r) => line.map((v, c) => ({ row: r + 1, col: c + 1, input: String(v), value: v, fmt: {} })))
  const types = ['column', 'bar', 'line', 'area', 'pie', 'doughnut', 'scatter', 'radar', 'combo']
  const charts = types.map((type, i) => ({
    id: 'c' + i, type, data: 'A1:C3', seriesIn: 'columns', labels: { row: true, col: true }, legend: i % 2 ? 'right' : 'bottom',
    title: 'Chart ' + type, xTitle: type === 'pie' || type === 'doughnut' ? undefined : 'Month', yTitle: type === 'pie' || type === 'doughnut' ? undefined : 'Cost',
    stacked: type === 'area' || undefined, dataLabels: type === 'pie' || undefined, lineSeries: type === 'combo' ? [1] : undefined, secondAxis: type === 'combo' ? [1] : undefined,
    anchor: { row: 5 + i * 16, col: 2, dx: 3, dy: 4 }, size: { w: 480, h: 300 }, resolved
  }))
  return { title: 'Charts', tabs: [{ name: 'Data & more', cells, widths: {}, charts }] }
}
const expected = (c) => {
  const out = { type: c.type, data: c.data, seriesIn: c.seriesIn, labels: c.labels, title: c.title, legend: c.legend }
  if (c.stacked) out.stacked = true
  if (c.dataLabels) out.dataLabels = true
  if (c.lineSeries) { out.lineSeries = c.lineSeries; out.secondAxis = c.secondAxis }
  if (c.xTitle) out.xTitle = c.xTitle
  if (c.yTitle) out.yTitle = c.yTitle
  return out
}
const pick = (c) => { const o = { ...c }; delete o.anchor; delete o.size; return o }

test('charts go out to .ods and come back', () => {
  const dump = chartDump()
  const back = chartsFromOdsBytes(odsBytes(XLSX, fflate, dump), fflate, ['Data & more'])[0]
  assert.equal(back.length, 9)
  dump.tabs[0].charts.forEach((c, i) => {
    assert.deepEqual(pick(back[i]), expected(c), c.type)
    assert.deepEqual(back[i].anchor, c.anchor, c.type + ' anchor')
    assert.deepEqual(back[i].size, c.size, c.type + ' size')
  })
})

test('LibreOffice keeps our charts, and we read its file back', { skip: !soffice && 'needs soffice' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pearoffice-odsc-'))
  try {
    const ours = path.join(dir, 'charts.ods')
    fs.writeFileSync(ours, odsBytes(XLSX, fflate, chartDump()))
    const out = path.join(dir, 'lo')
    execFileSync('soffice', ['--headless', '-env:UserInstallation=file://' + path.join(dir, 'profile'), '--convert-to', 'ods', '--outdir', out, ours], { stdio: 'ignore', timeout: 120000 })
    const back = chartsFromOdsBytes(fs.readFileSync(path.join(out, 'charts.ods')), fflate, ['Data & more'])[0]
    const dump = chartDump()
    assert.equal(back.length, 9, 'LibreOffice kept all nine charts')
    dump.tabs[0].charts.forEach((c, i) => {
      assert.deepEqual(pick(back[i]), expected(c), c.type)
      assert.deepEqual(back[i].anchor, c.anchor, c.type + ' anchor')
    })
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
