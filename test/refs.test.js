const test = require('node:test')
const assert = require('node:assert/strict')
const model = require('../src/shared/sheetModel')
const { evaluateSheet } = require('../src/shared/formula')

function setup () {
  const doc = model.createDoc()
  model.initSheet(doc)
  return { doc, tab: model.tabIds(doc)[0] }
}

const roundTrip = [
  'SUM(A1:B2)',
  '$A$1+A$2+$B3',
  "'My Tab'!A1+Other!B2:C3",
  'A:A',
  '1:3',
  'LOG10(A1)+ATAN2(A1,B1)',
  '"A1 stays text"&A1',
  'IF(A1>0,"say ""B2""",B2)',
  'SUM(Z1:AA5)',
  '1E5+A1',
  '0.5*B2'
]

test('A1 formulas survive the trip to ids and back', () => {
  const { doc, tab } = setup()
  model.addTab(doc, 'My Tab')
  model.addTab(doc, 'Other')
  for (const f of roundTrip) {
    model.setCell(doc, tab, 1, 5, '=' + f)
    assert.equal(model.getInput(doc, tab, 1, 5), '=' + f)
  }
})

test('function names and string literals are not treated as references', () => {
  const { doc, tab } = setup()
  model.setCell(doc, tab, 1, 1, '=LOG10(100)&"A1"')
  const raw = model.tabMap(doc, tab).get('cells').values().next().value
  assert.equal(raw, '=LOG10(100)&"A1"')
})

test('lowercase references are normalised', () => {
  const { doc, tab } = setup()
  model.setCell(doc, tab, 1, 2, '=a1+b$2')
  assert.equal(model.getInput(doc, tab, 1, 2), '=A1+B$2')
})

test('unknown tabs and references past the limit become #REF!', () => {
  const { doc, tab } = setup()
  model.setCell(doc, tab, 1, 1, '=Nope!A1+A100001')
  assert.equal(model.getInput(doc, tab, 1, 1), '=#REF!+#REF!')
})

test('referencing past the grid edge grows the grid', () => {
  const { doc, tab } = setup()
  model.setCell(doc, tab, 1, 1, '=A250')
  assert.equal(model.tabMap(doc, tab).get('rows').length, 250)
  assert.equal(model.getInput(doc, tab, 1, 1), '=A250')
})

test('inserting rows and columns keeps references on the same cells', () => {
  const { doc, tab } = setup()
  model.setCell(doc, tab, 1, 1, '5')
  model.setCell(doc, tab, 3, 3, '=A1*2+SUM(A1:A2)')
  model.insertRows(doc, tab, 1, 2)
  model.insertCols(doc, tab, 1, 1)
  assert.equal(model.getInput(doc, tab, 5, 4), '=B3*2+SUM(B3:B4)')
  assert.equal(evaluateSheet(doc).get(tab).get('5,4').value, 15)
})

test('deleting the end row of a range shrinks it; deleting a single reference gives #REF!', () => {
  const { doc, tab } = setup()
  model.setCell(doc, tab, 1, 1, '1')
  model.setCell(doc, tab, 2, 1, '2')
  model.setCell(doc, tab, 3, 1, '4')
  model.setCell(doc, tab, 5, 2, '=SUM(A1:A3)+A3')
  model.deleteRows(doc, tab, 3)
  assert.equal(model.getInput(doc, tab, 4, 2), '=SUM(A1:A2)+#REF!')
  model.deleteRows(doc, tab, 1)
  assert.equal(model.getInput(doc, tab, 3, 2), '=SUM(A1:A1)+#REF!')
})

test('cross-tab references follow renames', () => {
  const { doc, tab } = setup()
  const { id } = model.addTab(doc, 'Costs')
  model.setCell(doc, id, 1, 1, '7')
  model.setCell(doc, tab, 1, 1, '=Costs!A1*2')
  model.renameTab(doc, id, 'Monthly costs')
  assert.equal(model.getInput(doc, tab, 1, 1), "='Monthly costs'!A1*2")
  assert.equal(evaluateSheet(doc).get(tab).get('1,1').value, 14)
})

test('pasting shifts relative references and keeps $-fixed ones', () => {
  const { shiftA1 } = require('../src/shared/refs')
  assert.equal(shiftA1('A1+B2', 1, 1), 'B2+C3')
  assert.equal(shiftA1('$A$1+A$1+$A1', 2, 3), '$A$1+D$1+$A3')
  assert.equal(shiftA1("'My Tab'!A1:B2", 1, 0), "'My Tab'!A2:B3")
  assert.equal(shiftA1('"A1"&A1', 1, 0), '"A1"&A2')
  assert.equal(shiftA1('A1', -1, 0), '#REF!')
})

test('block writes, range clears and range formats are single changes', () => {
  const { doc, tab } = setup()
  let updates = 0
  doc.on('update', () => updates++)
  model.setCells(doc, tab, 2, 2, [['1', '2'], ['3', '=B2+C2']])
  assert.equal(updates, 1)
  assert.equal(evaluateSheet(doc).get(tab).get('3,3').value, 3)
  model.setFormatRange(doc, tab, 2, 2, 3, 3, { b: true, fill: '#fde68a' })
  assert.equal(updates, 2)
  assert.deepEqual(model.getFormat(doc, tab, 3, 3), { b: true, fill: '#fde68a' })
  model.clearRange(doc, tab, 2, 2, 2, 3)
  assert.equal(updates, 3)
  assert.equal(model.getInput(doc, tab, 2, 2), '')
  assert.equal(model.getInput(doc, tab, 3, 2), '3')
  assert.deepEqual(model.getFormat(doc, tab, 2, 2), { b: true, fill: '#fde68a' }, 'formatting stays after clearing')
})
