// Deleting, moving and duplicating tabs.

const test = require('node:test')
const assert = require('node:assert/strict')
const Y = require('yjs')
const model = require('../src/sheet/sheetModel')
const { evaluateSheet } = require('../src/sheet/formula')

function sheet () {
  const doc = model.createDoc()
  model.initSheet(doc)
  const data = model.tabIds(doc)[0]
  model.renameTab(doc, data, 'Data')
  model.setCell(doc, data, 1, 1, '5')
  model.setCell(doc, data, 1, 2, '=A1*2')
  model.setFormat(doc, data, 1, 1, { b: true })
  model.setWidth(doc, data, 2, 150)
  const { id: sum } = model.addTab(doc, 'Sum')
  model.setCell(doc, sum, 1, 1, '=Data!B1+1')
  return { doc, data, sum }
}
const names = (doc) => model.tabIds(doc).map((id) => model.tabMap(doc, id).get('name'))

test('a duplicate sits after the original and its formulas use its own cells', () => {
  const { doc, data } = sheet()
  const { id } = model.duplicateTab(doc, data)
  assert.deepEqual(names(doc), ['Data', 'Data 2', 'Sum'])
  assert.equal(model.getInput(doc, id, 1, 2), '=A1*2')
  assert.deepEqual(model.getFormat(doc, id, 1, 1), { b: true })
  model.setCell(doc, id, 1, 1, '7')
  const v = evaluateSheet(doc)
  assert.equal(v.get(id).get('1,2').value, 14)
  assert.equal(v.get(data).get('1,2').value, 10, 'the original is untouched')
  assert.equal(model.duplicateTab(doc, data) && names(doc)[1], 'Data 3', 'names do not clash')
})

test('moving a tab, and two people moving it at once', () => {
  const { doc, sum } = sheet()
  model.moveTab(doc, sum, 0)
  assert.deepEqual(names(doc), ['Sum', 'Data'])
  const a = new Y.Doc()
  const b = new Y.Doc()
  Y.applyUpdate(a, Y.encodeStateAsUpdate(doc))
  Y.applyUpdate(b, Y.encodeStateAsUpdate(doc))
  model.moveTab(a, sum, 1)
  model.moveTab(b, sum, 1)
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b))
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
  assert.deepEqual(names(a), names(b))
  assert.equal(names(a).length, 2, 'the tab is listed once')
})

test('deleting a tab: formulas that used it show #REF!; the last tab stays', () => {
  const { doc, data, sum } = sheet()
  model.deleteTab(doc, data)
  assert.deepEqual(names(doc), ['Sum'])
  assert.equal(evaluateSheet(doc).get(sum).get('1,1').error, '#REF!')
  assert.throws(() => model.deleteTab(doc, sum), /at least one tab/)
})
