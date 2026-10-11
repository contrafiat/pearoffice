// The formula suggestions list (src/sheet/formula/catalog.js) and the help
// that reads what is being typed (src/sheet/formula/help.js).

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { FUNCTIONS, suggest } = require('../src/sheet/formula/catalog')
const { analyze, helpFor, insertFunction, canPoint, refText } = require('../src/sheet/formula/help')
const { fillFunctions } = require('../src/sheet/formula/fills')

const NOT_LISTED = new Set(['CELL', 'INFO', 'PHONETIC', 'FILTERXML', 'WEBSERVICE', 'FORECAST.ETS', 'FORECAST.ETS.CONFINT', 'FORECAST.ETS.SEASONALITY', 'FORECAST.ETS.STAT'])

test('the suggestions list every working function and nothing else', () => {
  const dir = path.join(__dirname, '..', 'src', 'sheet', 'formula', 'vendor', 'fast-formula-parser', 'formulas', 'functions')
  const engine = new Set(Object.keys(fillFunctions()))
  for (const f of fs.readdirSync(dir)) for (const [k, v] of Object.entries(require(path.join(dir, f)))) if (typeof v === 'function') engine.add(k)
  engine.add('ANCHORARRAY') // the evaluator adds it (src/sheet/formula/index.js)
  const listed = new Set(FUNCTIONS.map((f) => f.name))
  assert.deepEqual([...engine].filter((n) => !listed.has(n) && !NOT_LISTED.has(n)), [], 'in the engine but not suggested')
  assert.deepEqual([...listed].filter((n) => !engine.has(n)), [], 'suggested but not in the engine')
  assert.equal(listed.size, FUNCTIONS.length, 'no duplicates')
  for (const f of FUNCTIONS) assert.ok(f.about && f.about.length < 100, f.name + ' has a short description')
})

test('names that start with the typed text come first', () => {
  assert.deepEqual(suggest('su').map((f) => f.name).slice(0, 3), ['SUBSTITUTE', 'SUBTOTAL', 'SUM'])
  assert.ok(suggest('lookup').some((f) => f.name === 'XLOOKUP'), 'contains matches follow')
  assert.deepEqual(suggest(''), [])
})

test('help reads what is being typed', () => {
  assert.equal(analyze('SU', 2), null, 'not a formula')
  assert.deepEqual(analyze('=SU', 3), { partial: 'SU' })
  assert.deepEqual(analyze('=A1+vlo', 7), { partial: 'vlo' })
  assert.deepEqual(analyze('=SUM(A1, B', 10), { partial: 'B' })
  assert.deepEqual(analyze('=SUM(B12', 8), { fn: 'SUM', arg: 0 }, 'a cell reference is not a name')
  assert.deepEqual(analyze('=IF(A1>2, "yes", ', 17), { fn: 'IF', arg: 2 })
  assert.deepEqual(analyze('=IF(SUM(A1, A2), ', 17), { fn: 'IF', arg: 1 }, 'closed inner call')
  assert.equal(analyze('="SU', 4), null, 'inside a string')
  assert.equal(analyze('=Sheet2!A', 9), null, 'part of a reference')
  assert.equal(helpFor('=SUM(', 5).signature.name, 'SUM')
  assert.equal(helpFor('=ZZZ', 4), null)
})

test('picking a suggestion inserts the name and a bracket', () => {
  assert.deepEqual(insertFunction('=su', 3, 'su', 'SUM'), { value: '=SUM(', caret: 5 })
  assert.deepEqual(insertFunction('=A1+vlo+1', 7, 'vlo', 'VLOOKUP'), { value: '=A1+VLOOKUP(+1', caret: 12 })
  assert.deepEqual(insertFunction('=su(A1)', 3, 'su', 'SUM'), { value: '=SUM(A1)', caret: 5 })
})

test('pointing: where the address of a clicked cell can go', () => {
  assert.equal(canPoint('=', 1), true)
  assert.equal(canPoint('=SUM(', 5), true)
  assert.equal(canPoint('=SUM(A1, ', 9), true)
  assert.equal(canPoint('=A1+', 4), true)
  assert.equal(canPoint('=SUM()', 5), true, 'before a closing bracket')
  assert.equal(canPoint('=SUM(A1', 7), false, 'after an address')
  assert.equal(canPoint('=SU', 3), false, 'in a name')
  assert.equal(canPoint('="a,', 4), false, 'inside a string')
  assert.equal(canPoint('12+', 3), false, 'not a formula')
  assert.equal(canPoint('=+B2', 2), false, 'in front of a name')
  assert.equal(refText({ row: 5, col: 1 }), 'A5')
  assert.equal(refText({ row: 20, col: 1 }, { row: 5, col: 1 }), 'A5:A20')
  assert.equal(refText({ row: 1, col: 28 }, { row: 3, col: 26 }), 'Z1:AB3')
})
