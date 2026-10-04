// Merged cells (proposals/2026-10-04-cell-formats.md).

const test = require('node:test')
const assert = require('node:assert/strict')
const Y = require('yjs')
const XLSX = require('xlsx/dist/xlsx.mini.min.js')
const model = require('../src/shared/sheetModel')
const { evaluateSheet } = require('../src/shared/formula')
const { workbookToTabs, dumpToWorkbook } = require('../src/shared/xlsxMap')

function sheet () {
  const doc = model.createDoc()
  model.initSheet(doc)
  return { doc, tab: model.tabIds(doc)[0] }
}

test('merging keeps the top-left contents and follows inserted and deleted rows', () => {
  const { doc, tab } = sheet()
  model.setCells(doc, tab, 1, 1, [['Title', 'x'], ['y', 'z']])
  model.mergeCells(doc, tab, 1, 1, 2, 2)
  assert.deepEqual(model.getMerges(doc, tab), [{ r1: 1, c1: 1, r2: 2, c2: 2 }])
  assert.deepEqual([model.getInput(doc, tab, 1, 1), model.getInput(doc, tab, 1, 2), model.getInput(doc, tab, 2, 2)], ['Title', '', ''])
  model.insertRows(doc, tab, 2, 1)
  assert.deepEqual(model.getMerges(doc, tab), [{ r1: 1, c1: 1, r2: 3, c2: 2 }], 'grows with a row inserted inside')
  model.unmergeCells(doc, tab, 2, 2, 2, 2)
  assert.deepEqual(model.getMerges(doc, tab), [], 'unmerge from any cell of it')
  model.mergeCells(doc, tab, 5, 1, 6, 2)
  model.deleteRows(doc, tab, 5, 1)
  assert.deepEqual(model.getMerges(doc, tab), [], 'a deleted corner drops the merge')
})

test('two people merging overlapping cells end up with the same merge', () => {
  const { doc, tab } = sheet()
  const a = new Y.Doc()
  const b = new Y.Doc()
  Y.applyUpdate(a, Y.encodeStateAsUpdate(doc))
  Y.applyUpdate(b, Y.encodeStateAsUpdate(doc))
  model.mergeCells(a, tab, 2, 2, 3, 3)
  model.mergeCells(b, tab, 1, 3, 2, 4)
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b))
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
  assert.deepEqual(model.getMerges(a, tab), model.getMerges(b, tab))
  assert.deepEqual(model.getMerges(a, tab), [{ r1: 1, c1: 3, r2: 2, c2: 4 }], 'the earlier top-left in reading order wins')
})

test('a spill cannot fill part of a merge', () => {
  const { doc, tab } = sheet()
  model.setCell(doc, tab, 1, 1, '=SEQUENCE(3)')
  model.mergeCells(doc, tab, 3, 1, 3, 2)
  assert.deepEqual(evaluateSheet(doc).get(tab).get('1,1').blocked, { kind: 'merge', at: [3, 1] })
})

test('merges go out to .xlsx and come back', () => {
  const { doc, tab } = sheet()
  model.setCell(doc, tab, 1, 1, 'Title')
  model.mergeCells(doc, tab, 1, 1, 1, 3)
  const dump = { title: 'M', tabs: [{ name: 'Sheet1', cells: [{ row: 1, col: 1, input: 'Title', value: 'Title', fmt: {} }], widths: {}, merges: model.getMerges(doc, tab) }] }
  const back = XLSX.read(XLSX.write(dumpToWorkbook(XLSX, dump), { type: 'array', bookType: 'xlsx' }), { type: 'array' })
  const doc2 = model.createDoc()
  model.initSheet(doc2)
  model.importTabs(doc2, workbookToTabs(XLSX, back))
  assert.deepEqual(model.getMerges(doc2, model.tabIds(doc2)[0]), [{ r1: 1, c1: 1, r2: 1, c2: 3 }])
})
