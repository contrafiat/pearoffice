// Hidden rows and columns (proposals/2026-10-04-sheet-tools.md).

const test = require('node:test')
const assert = require('node:assert/strict')
const Y = require('yjs')
const XLSX = require('xlsx/dist/xlsx.mini.min.js')
const fflate = require('fflate')
const model = require('../src/sheet/sheetModel')
const { evaluateSheet } = require('../src/sheet/formula')
const { workbookBytes, workbookToTabs, READ_OPTIONS } = require('../src/sheet/xlsxMap')

function sheet () {
  const doc = model.createDoc()
  model.initSheet(doc)
  return { doc, tab: model.tabIds(doc)[0] }
}

test('hidden rows and columns move with inserts and go with deletes', () => {
  const { doc, tab } = sheet()
  model.setHidden(doc, tab, 'row', 3, 4, true)
  model.setHidden(doc, tab, 'col', 2, 2, true)
  assert.deepEqual(model.getHidden(doc, tab), { rows: [3, 4], cols: [2] })
  model.insertRows(doc, tab, 1, 2)
  model.insertCols(doc, tab, 1, 1)
  assert.deepEqual(model.getHidden(doc, tab), { rows: [5, 6], cols: [3] })
  model.deleteRows(doc, tab, 5, 1)
  assert.deepEqual(model.getHidden(doc, tab), { rows: [5], cols: [3] })
  model.setHidden(doc, tab, 'row', 1, 10, false)
  assert.deepEqual(model.getHidden(doc, tab), { rows: [], cols: [3] })
})

test('two people hiding different rows at once both keep theirs', () => {
  const { doc, tab } = sheet()
  const a = new Y.Doc()
  const b = new Y.Doc()
  Y.applyUpdate(a, Y.encodeStateAsUpdate(doc))
  Y.applyUpdate(b, Y.encodeStateAsUpdate(doc))
  model.setHidden(a, tab, 'row', 2, 2, true)
  model.setHidden(b, tab, 'row', 7, 7, true)
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b))
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
  assert.deepEqual(model.getHidden(a, tab).rows, [2, 7])
  assert.deepEqual(model.getHidden(b, tab).rows, [2, 7])
})

test('SUBTOTAL 101-111 and AGGREGATE options 5 and 7 skip hidden rows', () => {
  const { doc, tab } = sheet()
  for (const [r, v] of [[1, '10'], [2, '20'], [3, '30']]) model.setCell(doc, tab, r, 1, v)
  const f = ['=SUBTOTAL(109,A1:A3)', '=SUBTOTAL(9,A1:A3)', '=SUBTOTAL(101,A1:A3)', '=SUBTOTAL(109,A1:A3,A1)', '=AGGREGATE(9,5,A1:A3)', '=AGGREGATE(9,4,A1:A3)', '=AGGREGATE(14,7,A1:A3,1)', '=SUBTOTAL(102,A1:A3)']
  f.forEach((x, i) => model.setCell(doc, tab, i + 1, 2, x))
  const values = () => { const m = evaluateSheet(doc).get(tab); return f.map((x, i) => m.get(i + 1 + ',2').value) }
  assert.deepEqual(values(), [60, 60, 20, 70, 60, 60, 30, 3])
  model.setHidden(doc, tab, 'row', 3, 3, true)
  assert.deepEqual(values(), [30, 60, 15, 40, 30, 60, 20, 2])
})

test('hidden rows and columns go out to .xlsx and come back', () => {
  const dump = { title: 'T', tabs: [{ name: 'A', cells: [{ row: 1, col: 1, input: 'x', value: 'x', fmt: {} }], widths: { 2: 80 }, heights: { 3: 40 }, hidden: { rows: [2, 3], cols: [2, 4] } }] }
  const bytes = workbookBytes(XLSX, fflate, dump)
  const { tabs } = workbookToTabs(XLSX, XLSX.read(bytes, { type: 'array', ...READ_OPTIONS }))
  const { doc, tab } = sheet()
  model.importTabs(doc, { tabs })
  assert.deepEqual(model.getHidden(doc, tab), { rows: [2, 3], cols: [2, 4] })
})
