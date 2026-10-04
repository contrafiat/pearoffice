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
        cells.push({ row, col, input: model.getInput(doc, id, row, col), value: v.error ? null : v.value, error: v.error, fmt: model.getFormat(doc, id, row, col) })
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

test('text that would read as a number or formula keeps an apostrophe', () => {
  assert.equal(textInput('007'), "'007")
  assert.equal(textInput('=not a formula'), "'=not a formula")
  assert.equal(textInput('true'), "'true")
  assert.equal(textInput('Rent'), 'Rent')
})
