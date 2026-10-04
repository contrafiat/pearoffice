// .xlsx round trip: a sheet goes out through SheetJS and comes back with the
// same values, formulas, number formats, tab names and widths.

const test = require('node:test')
const assert = require('node:assert/strict')
const XLSX = require('xlsx/dist/xlsx.mini.min.js')
const model = require('../src/shared/sheetModel')
const { evaluateSheet } = require('../src/shared/formula')
const { workbookToTabs, dumpToWorkbook, textInput } = require('../src/shared/xlsxMap')

// What the worklet's sheet:dump returns, built straight from a document.
function dump (doc) {
  const values = evaluateSheet(doc)
  return {
    title: model.title(doc),
    tabs: model.tabIds(doc).map((id) => {
      const t = model.tabMap(doc, id)
      const cells = []
      for (const [key, v] of values.get(id)) {
        const [row, col] = key.split(',').map(Number)
        cells.push({ row, col, input: v.from ? undefined : model.getInput(doc, id, row, col), value: v.error ? null : v.value, error: v.error, fmt: model.getFormat(doc, id, row, col), spill: v.spill, from: v.from })
      }
      const widths = {}
      t.get('cols').toArray().forEach((colId, i) => { if (t.get('widths').has(colId)) widths[i + 1] = t.get('widths').get(colId) })
      return { name: t.get('name'), cells, widths }
    })
  }
}

test('a sheet survives export to .xlsx and import back', () => {
  const doc = model.createDoc()
  model.initSheet(doc, { title: 'Budget' })
  const main = model.tabIds(doc)[0]
  model.renameTab(doc, main, 'Monthly')
  const { id: other } = model.addTab(doc, 'Rates & fees')
  model.setCells(doc, main, 1, 1, [['Item', 'Cost'], ['Rent', '1200'], ['Food', '450.5'], ['Total', '=SUM(B2:B3)'], ['Fee', "='Rates & fees'!A1*B4"], ['Code', "'007"], ['Flag', 'TRUE']])
  model.setCell(doc, other, 1, 1, '0.02')
  model.setFormat(doc, main, 4, 2, { num: '$#,##0.00' })
  model.setWidth(doc, main, 1, 180)

  const wb = dumpToWorkbook(XLSX, dump(doc))
  const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  const back = XLSX.read(bytes, { type: 'array', cellFormula: true, cellNF: true, cellStyles: true })
  assert.deepEqual(back.SheetNames, ['Monthly', 'Rates & fees'])

  const doc2 = model.createDoc()
  model.initSheet(doc2, { title: 'Budget' })
  model.importTabs(doc2, workbookToTabs(XLSX, back))
  const [m2, o2] = model.tabIds(doc2)
  const v = evaluateSheet(doc2)
  assert.equal(model.getInput(doc2, m2, 4, 2), '=SUM(B2:B3)')
  assert.equal(v.get(m2).get('4,2').value, 1650.5)
  assert.equal(model.getInput(doc2, m2, 5, 2), "='Rates & fees'!A1*B4")
  assert.equal(v.get(m2).get('5,2').value, 33.01)
  assert.equal(model.getInput(doc2, m2, 6, 2), "'007", 'text that looks like a number stays text')
  assert.equal(v.get(m2).get('7,2').value, true)
  assert.deepEqual(model.getFormat(doc2, m2, 4, 2), { num: '$#,##0.00' })
  assert.equal(model.tabMap(doc2, m2).get('name'), 'Monthly')
  assert.equal(model.tabMap(doc2, o2).get('name'), 'Rates & fees')
  const colId = model.tabMap(doc2, m2).get('cols').get(0)
  assert.equal(model.tabMap(doc2, m2).get('widths').get(colId), 180)
})

test('a spilling formula goes out as a dynamic array and comes back as one formula', () => {
  const doc = model.createDoc()
  model.initSheet(doc, { title: 'Spills' })
  const tab = model.tabIds(doc)[0]
  model.setCells(doc, tab, 1, 1, [['pear'], ['apple'], ['fig']])
  model.setCell(doc, tab, 1, 3, '=SORT(A1:A3)')
  model.setCell(doc, tab, 1, 4, '=SEQUENCE(2,2)')
  model.setCell(doc, tab, 5, 1, '=COUNTA(C1#)')

  const wb = dumpToWorkbook(XLSX, dump(doc))
  const ws = wb.Sheets[wb.SheetNames[0]]
  assert.equal(ws.C1.f, '_xlfn._xlws.SORT(A1:A3)')
  assert.equal(ws.C1.F, 'C1:C3')
  assert.equal(ws.C1.D, true)
  assert.equal(ws.C3.v, 'pear', 'filled cells are written as values')
  assert.equal(ws.C3.f, undefined)
  assert.equal(ws.D1.F, 'D1:E2')
  assert.equal(ws.A5.f, 'COUNTA(_xlfn.ANCHORARRAY(C1))')

  const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  const sheetXml = XLSX.read(bytes, { type: 'array', bookFiles: true }).files['xl/worksheets/sheet1.xml']
  const xml = Buffer.from(sheetXml.content).toString()
  assert.match(xml, /<c r="C1"[^>]* cm="1"><f t="array" ref="C1:C3">/)

  const back = XLSX.read(bytes, { type: 'array', cellFormula: true, cellNF: true, cellStyles: true })
  const doc2 = model.createDoc()
  model.initSheet(doc2)
  model.importTabs(doc2, workbookToTabs(XLSX, back))
  const t2 = model.tabIds(doc2)[0]
  assert.equal(model.getInput(doc2, t2, 1, 3), '=SORT(A1:A3)')
  assert.equal(model.getInput(doc2, t2, 2, 3), '', 'the values a spill filled are not imported as input')
  const v = evaluateSheet(doc2).get(t2)
  assert.deepEqual([1, 2, 3].map((r) => v.get(r + ',3').value), ['apple', 'fig', 'pear'])
  assert.deepEqual(v.get('2,5').value, 4)
  assert.equal(model.getInput(doc2, t2, 5, 1), '=COUNTA(C1#)')
  assert.equal(v.get('5,1').value, 3)
})

test('text that would read as a number or formula keeps an apostrophe', () => {
  assert.equal(textInput('007'), "'007")
  assert.equal(textInput('=not a formula'), "'=not a formula")
  assert.equal(textInput('true'), "'true")
  assert.equal(textInput('Rent'), 'Rent')
})
