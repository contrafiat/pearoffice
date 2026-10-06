// Duplicating a tab copies what Excel copies: charts, merges, row heights,
// frozen panes, hidden rows and columns, colour rules, validation and
// comments, with ranges on the tab pointing at the copy.

const test = require('node:test')
const assert = require('node:assert/strict')
const model = require('../src/sheet/sheetModel')

test('a duplicated tab keeps its charts, layout, rules and comments', () => {
  const doc = model.createDoc()
  model.initSheet(doc)
  const tab = model.tabIds(doc)[0]
  for (const [r, v] of [[1, 'x'], [2, '1'], [3, '2']]) model.setCell(doc, tab, r, 1, v)
  model.addChart(doc, tab, { type: 'line', data: 'A1:A3', title: 'Trend', anchor: { row: 2, col: 4 } })
  model.mergeCells(doc, tab, 5, 1, 5, 3)
  model.setHeight(doc, tab, 2, 40)
  model.setFreeze(doc, tab, 1, 1)
  model.setHidden(doc, tab, 'row', 7, 8, true)
  model.setHidden(doc, tab, 'col', 6, 6, true)
  model.addCondFormat(doc, tab, 'A2:A3', { kind: 'gt', a: 1, style: { fill: '#ffc7ce' } })
  model.setValidation(doc, tab, 'B2:B3', { kind: 'list', source: 'A2:A3' })
  const { id: root } = model.addComment(doc, tab, { row: 2, col: 1, author: 'ann', text: 'Check', at: 1 })
  model.addComment(doc, tab, { parent: root, author: 'bob', text: 'Done', at: 2 })
  model.resolveComment(doc, tab, root, true)

  const { id: copy } = model.duplicateTab(doc, tab)
  const name = doc.getMap('tab:' + copy).get('name')
  assert.equal(name, 'Sheet1 2')
  const [chart] = model.getCharts(doc, copy)
  assert.equal(chart.data, 'A1:A3', 'the chart reads the copy')
  assert.equal(chart.title, 'Trend')
  assert.deepEqual(chart.anchor, { row: 2, col: 4, dx: 0, dy: 0 })
  assert.deepEqual(model.getMerges(doc, copy).map((m) => [m.r1, m.c1, m.r2, m.c2]), [[5, 1, 5, 3]])
  assert.deepEqual(model.getHeights(doc, copy), { 2: 40 })
  assert.deepEqual(model.getFreeze(doc, copy), { rows: 1, cols: 1 })
  assert.deepEqual(model.getHidden(doc, copy), { rows: [7, 8], cols: [6] })
  assert.deepEqual(model.getCondFormats(doc, copy).map((r) => [r.kind, r.range]), [['gt', 'A2:A3']])
  assert.deepEqual(model.getValidations(doc, copy).map((r) => [r.kind, r.range, r.source]), [['list', 'B2:B3', 'A2:A3']])
  const [t] = model.getComments(doc, copy)
  assert.deepEqual([t.row, t.col, t.text, t.resolved, t.replies.map((x) => x.text)], [2, 1, 'Check', true, ['Done']])

  // Changing the copy leaves the original alone.
  model.setHidden(doc, copy, 'row', 7, 8, false)
  assert.deepEqual(model.getHidden(doc, tab).rows, [7, 8])
  model.insertRows(doc, tab, 1, 1)
  assert.equal(model.getCharts(doc, copy)[0].data, 'A1:A3')
})
