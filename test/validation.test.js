// Data validation (proposals/2026-10-04-sheet-tools.md).

const test = require('node:test')
const assert = require('node:assert/strict')
const Y = require('yjs')
const XLSX = require('xlsx/dist/xlsx.mini.min.js')
const fflate = require('fflate')
const model = require('../src/shared/sheetModel')
const { normalize, allows, typed, ruleFor, explain } = require('../src/shared/validation')
const { workbookBytes, workbookToTabs, validationsFromXlsx, READ_OPTIONS } = require('../src/shared/xlsxMap')

const ok = (rule, raw) => allows(normalize(rule), typed(raw))

test('each kind of rule', () => {
  assert.ok(ok({ kind: 'list', items: 'Yes\nNo' }, 'yes'), 'lists ignore case')
  assert.ok(!ok({ kind: 'list', items: 'Yes, No' }, 'Maybe'))
  assert.ok(ok({ kind: 'list', items: 'a' }, ''), 'blank is always allowed')
  assert.ok(ok({ kind: 'whole', op: 'between', a: 1, b: 10 }, '10'))
  assert.ok(!ok({ kind: 'whole', op: 'between', a: 1, b: 10 }, '2.5'), 'not a whole number')
  assert.ok(!ok({ kind: 'whole', op: 'between', a: 1, b: 10 }, 'ten'), 'text is not a number')
  assert.ok(ok({ kind: 'decimal', op: 'notBetween', a: 1, b: 10 }, '10.5'))
  assert.ok(ok({ kind: 'decimal', op: 'gt', a: 0 }, '0.1'))
  assert.ok(!ok({ kind: 'decimal', op: 'lt', a: 0 }, '0'))
  assert.ok(ok({ kind: 'decimal', op: 'ge', a: 5 }, '5') && ok({ kind: 'decimal', op: 'le', a: 5 }, '5'))
  assert.ok(ok({ kind: 'decimal', op: 'eq', a: 5 }, '5') && ok({ kind: 'decimal', op: 'ne', a: 5 }, '6'))
  assert.ok(ok({ kind: 'date', op: 'ge', a: '2026-01-01' }, '46023'), 'a date serial')
  assert.ok(!ok({ kind: 'date', op: 'ge', a: '2026-01-01' }, '46022'))
  assert.ok(ok({ kind: 'time', op: 'between', a: '09:00', b: '17:00' }, String(46023 + 0.5)), 'noon on any day')
  assert.ok(!ok({ kind: 'time', op: 'between', a: '09:00', b: '17:00' }, '0.8'))
  assert.ok(ok({ kind: 'length', op: 'le', a: 3 }, 'abc') && !ok({ kind: 'length', op: 'le', a: 3 }, 'abcd'))
  assert.ok(ok({ kind: 'length', op: 'le', a: 3 }, "'123"), 'text typed with an apostrophe')
  assert.throws(() => normalize({ kind: 'list', items: ' , ' }), /at least one item/)
  assert.throws(() => normalize({ kind: 'date', op: 'gt', a: 'soon' }), /yyyy-mm-dd/)
  assert.throws(() => normalize({ kind: 'nope' }), /Pick what/)
  assert.equal(explain(normalize({ kind: 'whole', op: 'between', a: 1, b: 10 })), 'Enter a whole number between 1 and 10.')
})

test('rules follow their range; the newest wins; clearing removes what it touches', () => {
  const doc = model.createDoc()
  model.initSheet(doc)
  const tab = model.tabIds(doc)[0]
  model.setValidation(doc, tab, 'B2:B5', { kind: 'list', items: 'a,b' })
  model.setValidation(doc, tab, 'B3:C3', { kind: 'whole', op: 'gt', a: 0 })
  model.insertRows(doc, tab, 1, 1)
  const rules = model.getValidations(doc, tab)
  assert.deepEqual(rules.map((r) => r.range), ['B3:B6', 'B4:C4'])
  assert.equal(ruleFor(rules, 4, 2).kind, 'whole')
  assert.equal(ruleFor(rules, 5, 2).kind, 'list')
  assert.equal(ruleFor(rules, 9, 2), null)
  model.setValidation(doc, tab, 'B1:C9', { kind: 'decimal', op: 'gt', a: 0 })
  assert.deepEqual(model.getValidations(doc, tab).map((r) => r.range), ['B1:C9'], 'a new rule replaces those inside it')
  model.setValidation(doc, tab, 'C5', null)
  assert.deepEqual(model.getValidations(doc, tab), [], 'clearing removes rules that touch the range')
  model.setValidation(doc, tab, 'A1:A3', { kind: 'list', source: 'D1:D3' })
  model.deleteRows(doc, tab, 1, 3)
  assert.deepEqual(model.getValidations(doc, tab), [], 'a deleted range takes its rule with it')
})

test('two people adding rules at once end up the same', () => {
  const doc = model.createDoc()
  model.initSheet(doc)
  const tab = model.tabIds(doc)[0]
  const a = new Y.Doc()
  const b = new Y.Doc()
  Y.applyUpdate(a, Y.encodeStateAsUpdate(doc))
  Y.applyUpdate(b, Y.encodeStateAsUpdate(doc))
  model.setValidation(a, tab, 'A1:A5', { kind: 'list', items: 'x' })
  model.setValidation(b, tab, 'A3:B3', { kind: 'whole', op: 'gt', a: 0 })
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b))
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
  assert.deepEqual(model.getValidations(a, tab), model.getValidations(b, tab))
  assert.equal(ruleFor(model.getValidations(a, tab), 3, 1).kind, ruleFor(model.getValidations(b, tab), 3, 1).kind)
})

test('rules go out to .xlsx and come back', () => {
  const v = [
    { range: 'B2:B5', kind: 'list', items: ['a', 'b'], dropdown: true, onBad: 'stop' },
    { range: 'C2:C9', kind: 'whole', op: 'between', a: '1', b: '10', onBad: 'warn', message: '1 to 10' },
    { range: 'D2', kind: 'date', op: 'ge', a: '2026-01-01', onBad: 'stop' },
    { range: 'E2:E3', kind: 'list', source: 'G1:G4', dropdown: false, onBad: 'stop' }
  ]
  const bytes = workbookBytes(XLSX, fflate, { title: 'T', tabs: [{ name: 'A', cells: [{ row: 1, col: 1, input: 'x', value: 'x', fmt: {} }], widths: {}, validations: v }] })
  const { tabs } = workbookToTabs(XLSX, XLSX.read(bytes, { type: 'array', ...READ_OPTIONS }))
  tabs[0].validations = validationsFromXlsx(bytes, fflate)[0]
  const doc = model.createDoc()
  model.initSheet(doc)
  model.importTabs(doc, { tabs })
  const back = model.getValidations(doc, model.tabIds(doc)[0]).map(({ id, n, r1, c1, r2, c2, ...r }) => r)
  assert.deepEqual(back, v)
})
