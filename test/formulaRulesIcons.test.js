// Conditional formatting: formula rules and icon sets
// (proposals/2026-10-05-formula-rules-icon-sets.md).

const test = require('node:test')
const assert = require('node:assert/strict')
const Y = require('yjs')
const XLSX = require('xlsx/dist/xlsx.mini.min.js')
const fflate = require('fflate')
const model = require('../src/shared/sheetModel')
const { evaluateSheet } = require('../src/shared/formula')
const { evaluate, normalize } = require('../src/shared/condFormat')
const { formulaMatches } = require('../src/worklet/sheetMethods')
const { workbookBytes, condFormatsFromXlsx } = require('../src/shared/xlsxMap')

function sheet (values) {
  const doc = model.createDoc()
  model.initSheet(doc)
  const tab = model.tabIds(doc)[0]
  values.forEach((v, i) => model.setCell(doc, tab, i + 2, 2, String(v)))
  return { doc, tab }
}
const hits = (doc, tab) => {
  const rules = model.getCondFormats(doc, tab)
  const m = formulaMatches(tab, rules, evaluateSheet(doc))
  return rules.map((r) => m[r.id])
}

test('a formula rule: relative references move with each cell, fixed ones stay', () => {
  const { doc, tab } = sheet([10, 20, 30, 40])
  model.addCondFormat(doc, tab, 'B2:B5', { kind: 'formula', formula: '=B2>AVERAGE($B$2:$B$5)', style: { fill: '#ffc7ce' } })
  assert.deepEqual(hits(doc, tab), [['4,2', '5,2']])
  model.insertRows(doc, tab, 1, 1)
  const [r] = model.getCondFormats(doc, tab)
  assert.equal(r.range, 'B3:B6')
  assert.equal(r.formula, 'B3>AVERAGE($B$3:$B$6)', 'the formula follows the inserted row')
  assert.deepEqual(hits(doc, tab), [['5,2', '6,2']])
})

test('only TRUE or a non-zero number matches; errors and text do not', () => {
  const { doc, tab } = sheet([0, 2, 'x', 5])
  model.addCondFormat(doc, tab, 'B2:B5', { kind: 'formula', formula: 'B2', style: { b: true } })
  model.addCondFormat(doc, tab, 'B2:B5', { kind: 'formula', formula: '1/(B2-5)>0', style: { i: true } })
  const [div, plain] = hits(doc, tab)
  assert.deepEqual(plain, ['3,2', '5,2'], 'zero and text do not match')
  assert.deepEqual(div, [], '#DIV/0! and negatives do not match')
})

test('the matches colour cells; a rule over too many cells is not applied', () => {
  const { doc, tab } = sheet([1, 5])
  model.addCondFormat(doc, tab, 'B2:B3', { kind: 'formula', formula: 'B2>2', style: { fill: '#c6efce' } })
  model.addCondFormat(doc, tab, 'A1:Z1000', { kind: 'formula', formula: 'TRUE', style: { b: true } })
  const rules = model.getCondFormats(doc, tab)
  const m = formulaMatches(tab, rules, evaluateSheet(doc))
  assert.equal(m[rules[0].id], null, '26,000 cells is over the limit')
  const out = evaluate(rules, new Map(), 0, Object.fromEntries(Object.entries(m).map(([k, v]) => [k, new Set(v || [])])))
  assert.deepEqual(out.get('3,2'), { fill: '#c6efce' })
  assert.equal(out.get('2,2'), undefined)
})

test('icon sets: Excel\'s thresholds, four and five icons, reverse, icon only', () => {
  const cells = new Map([0, 30, 34, 66, 67, 100].map((v, i) => [i + 1 + ',1', { row: i + 1, col: 1, kind: 'number', num: v, display: String(v) }]))
  const all = { r1: 1, c1: 1, r2: 6, c2: 1 }
  const icons = (rule) => [1, 2, 3, 4, 5, 6].map((r) => evaluate([{ ...all, ...normalize(rule) }], cells, 0).get(r + ',1').icon.index)
  assert.deepEqual(icons({ kind: 'icons', set: '3arrows' }), [2, 2, 1, 1, 0, 0])
  assert.deepEqual(icons({ kind: 'icons', set: '3arrows', reverse: true }), [0, 0, 1, 1, 2, 2])
  assert.deepEqual(icons({ kind: 'icons', set: '4arrows' }), [3, 2, 2, 1, 1, 0])
  assert.deepEqual(icons({ kind: 'icons', set: '5ratings' }), [4, 3, 3, 1, 1, 0])
  const one = evaluate([{ ...all, ...normalize({ kind: 'icons', set: '3traffic', iconOnly: true }) }], cells, 0).get('1,1')
  assert.deepEqual(one, { icon: { set: '3traffic', index: 2, iconOnly: true } })
})

test('two people adding rules at once end up the same', () => {
  const { doc, tab } = sheet([1, 2])
  const a = new Y.Doc()
  const b = new Y.Doc()
  Y.applyUpdate(a, Y.encodeStateAsUpdate(doc))
  Y.applyUpdate(b, Y.encodeStateAsUpdate(doc))
  model.addCondFormat(a, tab, 'B2:B3', { kind: 'icons', set: '3symbols' })
  model.addCondFormat(b, tab, 'B2:B3', { kind: 'formula', formula: 'B2>1', style: { b: true } })
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b))
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
  assert.deepEqual(model.getCondFormats(a, tab), model.getCondFormats(b, tab))
})

test('formula rules and icon sets go out to .xlsx and come back', () => {
  const rules = [
    { range: 'B2:B5', kind: 'formula', formula: 'B2>AVERAGE($B$2:$B$5)', style: { fill: '#ffc7ce' } },
    { range: 'C2:C5', kind: 'icons', set: '4arrows', reverse: true, iconOnly: true },
    { range: 'D2:D5', kind: 'icons', set: '3arrows' }
  ]
  const bytes = workbookBytes(XLSX, fflate, { title: 'T', tabs: [{ name: 'A', cells: [{ row: 1, col: 1, input: 'x', value: 'x', fmt: {} }], widths: {}, condFormats: rules }] })
  assert.deepEqual(condFormatsFromXlsx(bytes, fflate)[0], rules)
})

test('a file saved by LibreOffice', () => {
  const back = condFormatsFromXlsx(require('fs').readFileSync(require('path').join(__dirname, 'fixtures/libreoffice-formula-icons.xlsx')), fflate)[0]
  assert.deepEqual(back, [
    { range: 'B2:B5', kind: 'formula', formula: 'B2>AVERAGE($B$2:$B$5)', style: { fill: '#ffc7ce' } },
    { range: 'C2:C5', kind: 'icons', set: '3traffic' },
    { range: 'D2:D5', kind: 'icons', set: '5ratings', reverse: true }
  ])
})
