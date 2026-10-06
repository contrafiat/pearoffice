// Filter rules (proposals/2026-10-04-freeze-filter.md).

const test = require('node:test')
const assert = require('node:assert/strict')
const { filterRows, columnValues, tableEnd, isActive } = require('../src/sheet/filter')

// Rows of [name, amount] under a header in A1:B1; '' is a blank cell.
function table (rows) {
  const cells = new Map()
  const put = (r, c, v) => { if (v !== '') cells.set(r + ',' + c, typeof v === 'number' ? { display: String(v), num: v } : { display: v }) }
  put(1, 1, 'Name'); put(1, 2, 'Amount')
  rows.forEach(([a, b], i) => { put(i + 2, 1, a); put(i + 2, 2, b) })
  return cells
}
const cells = table([['Rent', 900], ['Food', 250], ['', 40], ['Fuel', 60], ['food', 15], ['Gym', '']])
const hide = (cols) => [...filterRows(cells, { r1: 1, c1: 1, c2: 2, cols }, 1000).hidden].sort((a, b) => a - b)

test('the table runs down to the last row with something in it', () => {
  assert.equal(tableEnd(cells, { r1: 1, c1: 1, c2: 2 }, 1000), 7)
  const more = new Map(cells)
  more.set('8,2', { display: '5', num: 5 })
  assert.equal(tableEnd(more, { r1: 1, c1: 1, c2: 2 }, 1000), 8, 'a row added to the table is filtered too')
})

test('a checklist of values, blanks included', () => {
  assert.deepEqual(hide({ 1: { values: ['Rent', 'Fuel'] } }), [3, 4, 6, 7])
  assert.deepEqual(hide({ 1: { values: [''] } }), [2, 3, 5, 6, 7])
  assert.deepEqual(hide({ 1: { values: [] } }), [2, 3, 4, 5, 6, 7])
  assert.deepEqual(columnValues(cells, { r1: 1, c1: 1, c2: 2 }, 1, 1000), [
    { value: 'food', count: 1 }, { value: 'Food', count: 1 }, { value: 'Fuel', count: 1 }, { value: 'Gym', count: 1 }, { value: 'Rent', count: 1 }, { value: '', count: 1 }
  ])
  assert.deepEqual(columnValues(cells, { r1: 1, c1: 1, c2: 2 }, 2, 1000).map((v) => v.value), ['15', '40', '60', '250', '900', ''])
})

test('each condition', () => {
  assert.deepEqual(hide({ 1: { cond: { op: 'eq', a: 'FOOD' } } }), [2, 4, 5, 7])
  assert.deepEqual(hide({ 1: { cond: { op: 'ne', a: 'food' } } }), [3, 6])
  assert.deepEqual(hide({ 1: { cond: { op: 'contains', a: 'u' } } }), [2, 3, 4, 6, 7])
  assert.deepEqual(hide({ 1: { cond: { op: 'begins', a: 'f' } } }), [2, 4, 7])
  assert.deepEqual(hide({ 1: { cond: { op: 'ends', a: 'm' } } }), [2, 3, 4, 5, 6])
  assert.deepEqual(hide({ 2: { cond: { op: 'gt', a: '60' } } }), [4, 5, 6, 7])
  assert.deepEqual(hide({ 2: { cond: { op: 'lt', a: '60' } } }), [2, 3, 5, 7])
  assert.deepEqual(hide({ 2: { cond: { op: 'between', a: '250', b: '40' } } }), [2, 6, 7])
  assert.deepEqual(hide({ 2: { cond: { op: 'top', a: '2' } } }), [4, 5, 6, 7])
  assert.deepEqual(hide({ 2: { cond: { op: 'eq', a: '60.0' } } }), [2, 3, 4, 6, 7], 'numbers compare as numbers')
})

test('filters on several columns combine', () => {
  const f = { r1: 1, c1: 1, c2: 2, cols: { 1: { cond: { op: 'begins', a: 'f' } }, 2: { cond: { op: 'gt', a: '20' } } } }
  const r = filterRows(cells, f, 1000)
  assert.deepEqual([...r.hidden].sort(), [2, 4, 6, 7])
  assert.equal(r.total, 6)
  assert.equal(r.showing, 2)
  assert.ok(isActive(f, 1) && isActive(f, 2) && !isActive(f, 3))
})

test('a fill down skips the rows a filter hides', () => {
  const model = require('../src/sheet/sheetModel')
  const doc = model.createDoc()
  model.initSheet(doc)
  const tab = model.tabIds(doc)[0]
  model.setCell(doc, tab, 1, 1, '1')
  model.setCell(doc, tab, 3, 1, 'kept')
  model.fillRange(doc, tab, { r1: 1, c1: 1, r2: 1, c2: 1 }, 'down', 3, 'copy', new Set([3]))
  const at = (r) => model.getInput(doc, tab, r, 1)
  assert.deepEqual([at(2), at(3), at(4)], ['1', 'kept', '1'])
})
