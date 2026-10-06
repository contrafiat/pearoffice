// Frozen panes (proposals/2026-10-04-freeze-filter.md).

const test = require('node:test')
const assert = require('node:assert/strict')
const Y = require('yjs')
const XLSX = require('xlsx/dist/xlsx.mini.min.js')
const fflate = require('fflate')
const model = require('../src/sheet/sheetModel')
const { workbookBytes, workbookToTabs, freezeFromXlsx } = require('../src/sheet/xlsxMap')

function sheet () {
  const doc = model.createDoc()
  model.initSheet(doc)
  return { doc, tab: model.tabIds(doc)[0] }
}

test('frozen rows grow with a row inserted inside them and go when the last one is deleted', () => {
  const { doc, tab } = sheet()
  model.setFreeze(doc, tab, 2, 1)
  assert.deepEqual(model.getFreeze(doc, tab), { rows: 2, cols: 1 })
  model.insertRows(doc, tab, 2, 1)
  assert.deepEqual(model.getFreeze(doc, tab), { rows: 3, cols: 1 })
  model.insertRows(doc, tab, 10, 1)
  assert.deepEqual(model.getFreeze(doc, tab), { rows: 3, cols: 1 }, 'rows below do not change it')
  model.deleteRows(doc, tab, 3, 1)
  assert.deepEqual(model.getFreeze(doc, tab), { rows: 0, cols: 1 })
  model.setFreeze(doc, tab, 0, 0)
  assert.deepEqual(model.getFreeze(doc, tab), { rows: 0, cols: 0 })
})

test('two people freezing at once end up the same', () => {
  const { doc, tab } = sheet()
  const a = new Y.Doc()
  const b = new Y.Doc()
  Y.applyUpdate(a, Y.encodeStateAsUpdate(doc))
  Y.applyUpdate(b, Y.encodeStateAsUpdate(doc))
  model.setFreeze(a, tab, 1, 0)
  model.setFreeze(b, tab, 3, 2)
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b))
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
  assert.deepEqual(model.getFreeze(a, tab), model.getFreeze(b, tab))
})

test('frozen panes go out to .xlsx and come back', () => {
  const dump = { title: 'F', tabs: [{ name: 'A', cells: [{ row: 1, col: 1, input: 'h', value: 'h', fmt: {} }], widths: {}, freeze: { rows: 1, cols: 2 } }] }
  const bytes = workbookBytes(XLSX, fflate, dump)
  assert.match(fflate.strFromU8(fflate.unzipSync(bytes)['xl/worksheets/sheet1.xml']), /<sheetView workbookViewId="0"><pane xSplit="2" ySplit="1" topLeftCell="C2" activePane="bottomRight" state="frozen"\/><\/sheetView>/)
  const { tabs } = workbookToTabs(XLSX, XLSX.read(bytes, { type: 'array' }))
  tabs[0].freeze = freezeFromXlsx(bytes, fflate)[0]
  const doc = model.createDoc()
  model.initSheet(doc)
  model.importTabs(doc, { tabs })
  assert.deepEqual(model.getFreeze(doc, model.tabIds(doc)[0]), { rows: 1, cols: 2 })
})
