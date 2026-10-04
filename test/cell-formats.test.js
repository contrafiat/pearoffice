// More cell formats and row heights (proposals/2026-10-04-cell-formats.md).

const test = require('node:test')
const assert = require('node:assert/strict')
const Y = require('yjs')
const model = require('../src/shared/sheetModel')

function sheet () {
  const doc = model.createDoc()
  model.initSheet(doc)
  return { doc, tab: model.tabIds(doc)[0] }
}
const copy = (doc) => { const d = new Y.Doc(); Y.applyUpdate(d, Y.encodeStateAsUpdate(doc)); return d }

test('two people setting different formats of one cell both keep theirs', () => {
  const { doc, tab } = sheet()
  const a = copy(doc)
  const b = copy(doc)
  model.setFormat(a, tab, 1, 1, { align: 'center', size: 18 })
  model.setFormat(b, tab, 1, 1, { wrap: true, bt: 'thick:#cc0000' })
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b))
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
  for (const d of [a, b]) assert.deepEqual(model.getFormat(d, tab, 1, 1), { align: 'center', wrap: true, size: 18, bt: 'thick:#cc0000' })
})

test('values outside the allowed ones are refused', () => {
  const { doc, tab } = sheet()
  assert.throws(() => model.setFormat(doc, tab, 1, 1, { align: 'justify' }), /bad value/)
  assert.throws(() => model.setFormat(doc, tab, 1, 1, { size: 100 }), /bad value/)
  assert.throws(() => model.setFormat(doc, tab, 1, 1, { bb: 'wavy' }), /bad value/)
  assert.throws(() => model.setFormat(doc, tab, 1, 1, { font: 'comic' }), /bad value/)
  model.setFormat(doc, tab, 1, 1, { font: 'serif', u: true, s: true, valign: 'top' })
  assert.deepEqual(model.getFormat(doc, tab, 1, 1), { valign: 'top', u: true, s: true, font: 'serif' })
})

test('border presets', () => {
  const sides = (preset) => {
    const { doc, tab } = sheet()
    model.setBorders(doc, tab, 1, 1, 2, 2, preset, 'thin')
    const out = []
    for (let r = 1; r <= 2; r++) for (let c = 1; c <= 2; c++) { const f = model.getFormat(doc, tab, r, c); out.push(['bt', 'br', 'bb', 'bl'].filter((k) => f[k]).join('')) }
    return out
  }
  assert.deepEqual(sides('all'), ['btbrbbbl', 'btbrbbbl', 'btbrbbbl', 'btbrbbbl'])
  assert.deepEqual(sides('outside'), ['btbl', 'btbr', 'bbbl', 'brbb'])
  assert.deepEqual(sides('inside'), ['brbb', 'bb', 'br', ''])
  assert.deepEqual(sides('bottom'), ['', '', 'bb', 'bb'])
  const { doc, tab } = sheet()
  model.setBorders(doc, tab, 1, 1, 2, 2, 'all', 'double:#123456')
  model.setBorders(doc, tab, 1, 1, 1, 1, 'none')
  assert.deepEqual(model.getFormat(doc, tab, 1, 1), {})
  assert.equal(model.getFormat(doc, tab, 2, 2).bb, 'double:#123456')
})

test('row heights follow their row', () => {
  const { doc, tab } = sheet()
  model.setHeight(doc, tab, 3, 50)
  model.insertRows(doc, tab, 1, 2)
  assert.deepEqual(model.getHeights(doc, tab), { 5: 50 })
  model.setHeight(doc, tab, 5, null)
  assert.deepEqual(model.getHeights(doc, tab), {})
})

test('the new formats move with sort and fill', () => {
  const { doc, tab } = sheet()
  model.setCells(doc, tab, 1, 1, [['b'], ['a']])
  model.setFormat(doc, tab, 1, 1, { align: 'right', bb: 'medium' })
  model.sortRows(doc, tab, 1, 1, 2, 1, [2, 1])
  assert.deepEqual(model.getFormat(doc, tab, 2, 1), { align: 'right', bb: 'medium' })
  model.fillRange(doc, tab, { r1: 2, c1: 1, r2: 2, c2: 1 }, 'down', 1, 'copy')
  assert.deepEqual(model.getFormat(doc, tab, 3, 1), { align: 'right', bb: 'medium' })
})
