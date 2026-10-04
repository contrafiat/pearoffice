// Spilling formulas (proposals/2026-10-04-spilling-formulas.md): the four
// blocking rules, reading spilled cells, cycles, and the same answer on every
// device whatever order the edits arrive in.

const test = require('node:test')
const assert = require('node:assert/strict')
const Y = require('yjs')
const model = require('../src/shared/sheetModel')
const { evaluateSheet } = require('../src/shared/formula')

function sheet () {
  const doc = model.createDoc()
  model.initSheet(doc)
  return { doc, tab: model.tabIds(doc)[0] }
}
const at = (doc, tab, r, c) => evaluateSheet(doc).get(tab).get(r + ',' + c)
const shown = (cell) => (!cell ? null : cell.error || cell.value)
// A second device: a copy of the document that then edits on its own.
function copyOf (doc) {
  const other = new Y.Doc()
  Y.applyUpdate(other, Y.encodeStateAsUpdate(doc))
  return other
}
const sync = (a, b) => {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)))
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)))
}

test('an array result fills the cells below and to the right', () => {
  const { doc, tab } = sheet()
  model.setCell(doc, tab, 1, 1, '=SEQUENCE(3, 2)')
  const v = evaluateSheet(doc).get(tab)
  assert.deepEqual(v.get('1,1').spill, { rows: 3, cols: 2 })
  assert.deepEqual([[1, 1], [1, 2], [2, 1], [3, 2]].map(([r, c]) => v.get(r + ',' + c).value), [1, 2, 3, 6])
  assert.deepEqual(v.get('3,2').from, [1, 1])
})

test('formulas read spilled cells', () => {
  const { doc, tab } = sheet()
  model.setCell(doc, tab, 1, 1, '=SEQUENCE(4)')
  model.setCell(doc, tab, 1, 3, '=SUM(A2:A4)')
  model.setCell(doc, tab, 2, 3, '=A3*10')
  assert.equal(shown(at(doc, tab, 1, 3)), 9)
  assert.equal(shown(at(doc, tab, 2, 3)), 30)
})

test('rule 1: a typed cell in the way blocks the spill', () => {
  const { doc, tab } = sheet()
  model.setCell(doc, tab, 1, 1, '=SEQUENCE(3)')
  model.setCell(doc, tab, 3, 1, 'x')
  const cell = at(doc, tab, 1, 1)
  assert.equal(cell.error, '#SPILL!')
  assert.deepEqual(cell.blocked, { kind: 'cells', cells: [[3, 1]], more: 0 })
  assert.equal(at(doc, tab, 2, 1), undefined, 'a blocked spill fills nothing')
  model.setCell(doc, tab, 3, 1, '')
  assert.equal(shown(at(doc, tab, 3, 1)), 3, 'clearing the cell lets it spill')
})

test('rule 2: where two spills overlap, the earlier anchor wins in either edit order', () => {
  // B2 spills down B2:B4; A3 spills across A3:C3. They meet at B3, and B2
  // comes first in reading order.
  const results = []
  for (const order of [['b2', 'a3'], ['a3', 'b2']]) {
    const { doc, tab } = sheet()
    const one = copyOf(doc)
    const two = copyOf(doc)
    model.setCell(one, tab, 2, 2, '=SEQUENCE(3)')
    model.setCell(two, tab, 3, 1, '=SEQUENCE(1, 3)')
    const target = copyOf(doc)
    for (const who of order) Y.applyUpdate(target, Y.encodeStateAsUpdate(who === 'b2' ? one : two))
    const v = evaluateSheet(target).get(tab)
    results.push([shown(v.get('2,2')), shown(v.get('3,2')), shown(v.get('3,1')), v.get('3,1').blocked])
  }
  assert.deepEqual(results[0], [1, 2, '#SPILL!', { kind: 'overlap', anchor: [2, 2] }])
  assert.deepEqual(results[1], results[0])
})

test('rule 3: a spill past the last row is blocked and says how many rows it needs', () => {
  const { doc, tab } = sheet()
  model.setCell(doc, tab, 99, 1, '=SEQUENCE(5)')
  const cell = at(doc, tab, 99, 1)
  assert.equal(cell.error, '#SPILL!')
  assert.deepEqual(cell.blocked, { kind: 'edge', rows: 3, cols: 0 })
  model.insertRows(doc, tab, 101, 3)
  assert.equal(shown(at(doc, tab, 103, 1)), 5)
})

test('rule 4: a spill larger than 100,000 cells is blocked', () => {
  const { doc, tab } = sheet()
  model.insertRows(doc, tab, 101, 400)
  model.insertCols(doc, tab, 27, 300)
  model.setCell(doc, tab, 1, 1, '=SEQUENCE(400, 300)')
  assert.deepEqual(at(doc, tab, 1, 1).blocked, { kind: 'size' })
})

test('a spill that would cover a cell it depends on is circular', () => {
  const { doc, tab } = sheet()
  model.setCell(doc, tab, 1, 1, '=SEQUENCE(3 - COUNT(A2:A3))')
  assert.equal(shown(at(doc, tab, 1, 1)), '#CIRCULAR!')
})

test('looking for spills does not invent cycles', () => {
  // Finding out whether B11 spills into C11 means evaluating it, and it
  // reads A10, which is the cell asking. B11 is a single value, so there is
  // no cycle.
  const { doc, tab } = sheet()
  model.setCell(doc, tab, 10, 1, '=SUM(C10:C12)')
  model.setCell(doc, tab, 11, 2, '=A10+1')
  assert.equal(shown(at(doc, tab, 10, 1)), 0)
  assert.equal(shown(at(doc, tab, 11, 2)), 1)
})

test('a cycle comes out the same whatever order the cells were written in', () => {
  const answers = []
  for (const first of ['A', 'B']) {
    const { doc, tab } = sheet()
    const cells = { A: [20, 1, '=IFERROR(B20, 5)'], B: [20, 2, '=A20'] }
    for (const k of first === 'A' ? ['A', 'B'] : ['B', 'A']) model.setCell(doc, tab, ...cells[k])
    const v = evaluateSheet(doc).get(tab)
    answers.push([shown(v.get('20,1')), shown(v.get('20,2'))])
  }
  assert.deepEqual(answers[0], answers[1])
})

test('two devices: a FILTER grows into rows someone is typing in, and both show #SPILL!', () => {
  const { doc, tab } = sheet()
  model.setCells(doc, tab, 1, 1, [['3'], ['8'], ['9'], ['1']])
  const alice = copyOf(doc)
  const bob = copyOf(doc)
  model.setCell(alice, tab, 1, 3, '=FILTER(A1:A4, A1:A4>2)')
  model.setCell(bob, tab, 2, 3, 'note')
  sync(alice, bob)
  for (const d of [alice, bob]) {
    const v = evaluateSheet(d).get(tab)
    assert.equal(shown(v.get('1,3')), '#SPILL!')
    assert.equal(shown(v.get('2,3')), 'note')
  }
})

test('operators work value by value on ranges', () => {
  const { doc, tab } = sheet()
  model.setCells(doc, tab, 1, 1, [['1', '10'], ['2', '20'], ['3', '30']])
  model.setCell(doc, tab, 1, 4, '=A1:A3*B1:B3')
  model.setCell(doc, tab, 1, 5, '=SUMPRODUCT((A1:A3>1)*B1:B3)')
  model.setCell(doc, tab, 1, 6, '=-A1:A3')
  const v = evaluateSheet(doc).get(tab)
  assert.deepEqual([1, 2, 3].map((r) => v.get(r + ',4').value), [10, 40, 90])
  assert.equal(v.get('1,5').value, 50)
  assert.deepEqual([1, 2, 3].map((r) => v.get(r + ',6').value), [-1, -2, -3])
})
