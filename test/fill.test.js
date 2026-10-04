// The fill handle, Fill down/right and Ctrl+D/Ctrl+R (src/shared/fill.js).

const test = require('node:test')
const assert = require('node:assert/strict')
const model = require('../src/shared/sheetModel')
const { evaluateSheet } = require('../src/shared/formula')
const { fillLine } = require('../src/shared/fill')

const plan = (inputs, n, opts) => fillLine(inputs.map((x) => (typeof x === 'string' ? { input: x } : x)), n, opts).map((p) => (p.input !== undefined ? p.input : '#' + p.from))

test('series', () => {
  assert.deepEqual(plan(['1', '2', '3'], 3), ['4', '5', '6'])
  assert.deepEqual(plan(['2', '4', '8'], 2), ['10.6666666666667', '13.6666666666667'], 'a best-fit line, as Excel')
  assert.deepEqual(plan(['5'], 2), ['#0', '#0'], 'one number is copied')
  assert.deepEqual(plan([{ input: '45292', num: 'd mmm yyyy' }], 2), ['45293', '45294'], 'one date counts up a day')
  assert.deepEqual(plan(['Mon'], 3), ['Tue', 'Wed', 'Thu'])
  assert.deepEqual(plan(['JANUARY', 'March'], 2), ['MAY', 'JULY'], 'step and case from the source')
  assert.deepEqual(plan(['Sat'], 2), ['Sun', 'Mon'], 'lists wrap round')
  assert.deepEqual(plan(['Item 1'], 2), ['Item 2', 'Item 3'])
  assert.deepEqual(plan(['Q01', 'Q03'], 2), ['Q05', 'Q07'], 'zero padding kept')
  assert.deepEqual(plan(['a', 'b'], 3), ['#0', '#1', '#0'], 'other text repeats')
  assert.deepEqual(plan(['=A1*2'], 2), ['#0', '#0'], 'formulas repeat (and shift)')
  assert.deepEqual(plan(['1', '2', '3'], 2, { backward: true }), ['0', '-1'], 'upwards')
  assert.deepEqual(plan(['1', '2'], 2, { mode: 'copy' }), ['#0', '#1'], 'Ctrl+D copies')
})

test('filling a range: formulas shift, formats come along, one change', () => {
  const doc = model.createDoc()
  model.initSheet(doc)
  const tab = model.tabIds(doc)[0]
  model.setCells(doc, tab, 1, 1, [['1', '=A1*10', '45292'], ['2', '=A2*10', '45293']])
  model.setFormat(doc, tab, 1, 3, { num: 'yyyy-mm-dd', b: true })
  model.setFormat(doc, tab, 2, 3, { num: 'yyyy-mm-dd', b: true })
  model.fillRange(doc, tab, { r1: 1, c1: 1, r2: 2, c2: 3 }, 'down', 2)
  assert.deepEqual([3, 4].map((r) => [1, 2, 3].map((c) => model.getInput(doc, tab, r, c))), [['3', '=A3*10', '45294'], ['4', '=A4*10', '45295']])
  assert.deepEqual(model.getFormat(doc, tab, 4, 3), { b: true, num: 'yyyy-mm-dd' })
  assert.equal(evaluateSheet(doc).get(tab).get('4,2').value, 40)
  model.fillRange(doc, tab, { r1: 1, c1: 1, r2: 4, c2: 1 }, 'right', 2, 'copy')
  assert.deepEqual([1, 2, 3, 4].map((r) => model.getInput(doc, tab, r, 3)), ['1', '2', '3', '4'], 'right, copying, overwrites B and C')
})
