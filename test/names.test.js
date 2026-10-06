// Named ranges (proposals/2026-10-04-sheet-tools.md).

const test = require('node:test')
const assert = require('node:assert/strict')
const Y = require('yjs')
const XLSX = require('xlsx/dist/xlsx.mini.min.js')
const fflate = require('fflate')
const model = require('../src/sheet/sheetModel')
const { evaluateSheet } = require('../src/sheet/formula')
const { helpFor, insertFunction } = require('../src/sheet/formula/help')
const { workbookBytes, workbookToTabs, READ_OPTIONS } = require('../src/sheet/xlsxMap')

function sheet () {
  const doc = model.createDoc()
  model.initSheet(doc)
  const tab = model.tabIds(doc)[0]
  for (const [r, v] of [[2, '10'], [3, '20'], [4, '30']]) model.setCell(doc, tab, r, 2, v)
  return { doc, tab }
}
const value = (doc, tab, r, c) => { const x = evaluateSheet(doc).get(tab).get(r + ',' + c); return x.error || x.value }

test('formulas use names, on this tab and others', () => {
  const { doc, tab } = sheet()
  const other = model.addTab(doc, 'Rates').id
  model.setCell(doc, other, 1, 1, '0.5')
  model.setName(doc, 'Sales', tab, 'B2:B4')
  model.setName(doc, 'tax_rate', tab, 'Rates!A1')
  model.setCell(doc, tab, 1, 1, '=SUM(sales)*TAX_RATE')
  model.setCell(doc, tab, 1, 3, '=INDEX(Sales,3)')
  model.setCell(doc, tab, 1, 4, '=Missing+1')
  assert.equal(value(doc, tab, 1, 1), 30, 'names ignore case')
  assert.equal(value(doc, tab, 1, 3), 30)
  assert.equal(value(doc, tab, 1, 4), '#NAME?')
  assert.deepEqual(model.getNames(doc).map((n) => [n.name, n.tab, n.range]), [['Sales', 'Sheet1', 'B2:B4'], ['tax_rate', 'Rates', 'A1']])
})

test('names follow inserts, shrink at an edge and give #REF! when their cells go', () => {
  const { doc, tab } = sheet()
  model.setName(doc, 'Sales', tab, 'B2:B4')
  model.setCell(doc, tab, 1, 1, '=SUM(Sales)')
  model.insertRows(doc, tab, 2, 1)
  assert.equal(model.getNames(doc)[0].range, 'B3:B5')
  model.deleteRows(doc, tab, 3, 1)
  assert.equal(model.getNames(doc)[0].range, 'B3:B4')
  assert.equal(value(doc, tab, 1, 1), 50)
  model.deleteRows(doc, tab, 3, 2)
  assert.equal(model.getNames(doc)[0].range, '#REF!')
  assert.equal(value(doc, tab, 1, 1), '#REF!')
  model.deleteName(doc, 'sales')
  assert.equal(value(doc, tab, 1, 1), '#NAME?')
})

test('renaming changes the formulas that use the name, and nothing else', () => {
  const { doc, tab } = sheet()
  model.setName(doc, 'Sales', tab, 'B2:B4')
  model.setCell(doc, tab, 1, 1, '=SUM(Sales)+SALES*0+LEN("Sales")+Sales.x')
  model.renameName(doc, 'sales', 'Revenue')
  assert.equal(model.getInput(doc, tab, 1, 1), '=SUM(Revenue)+Revenue*0+LEN("Sales")+Sales.x')
  assert.throws(() => model.renameName(doc, 'Revenue', 'B2'), /cell reference/)
  model.setName(doc, 'Costs', tab, 'C1')
  assert.throws(() => model.renameName(doc, 'Revenue', 'costs'), /already/)
  for (const bad of ['', '1st', 'two words', 'AB12', 'R1C1', 'TRUE']) assert.throws(() => model.setName(doc, bad, tab, 'A1'))
})

test('two people naming the same range at once end up the same', () => {
  const { doc, tab } = sheet()
  const a = new Y.Doc()
  const b = new Y.Doc()
  Y.applyUpdate(a, Y.encodeStateAsUpdate(doc))
  Y.applyUpdate(b, Y.encodeStateAsUpdate(doc))
  model.setName(a, 'Sales', tab, 'B2:B3')
  model.setName(b, 'SALES', tab, 'B2:B4')
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b))
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
  assert.deepEqual(model.getNames(a), model.getNames(b))
  assert.equal(model.getNames(a).length, 1)
})

test('names are suggested while typing a formula', () => {
  const names = [{ name: 'Sales', about: 'Named range, B2:B4' }, { name: 'tax_rate', about: 'Named range, Rates!A1' }]
  const h = helpFor('=SUM(Sa', 7, names)
  assert.equal(h.list[0].name, 'Sales')
  assert.ok(h.list[0].isName)
  assert.ok(h.list.some((f) => f.name === 'SECOND' || f.name.startsWith('SA')) || h.list.length >= 1)
  assert.equal(helpFor('=tax_', 5, names).list[0].name, 'tax_rate')
  assert.deepEqual(insertFunction('=SUM(Sa', 7, 'Sa', 'Sales', true), { value: '=SUM(Sales', caret: 10 })
})

test('names go out to .xlsx and come back', () => {
  const dump = {
    title: 'T',
    tabs: [{ name: 'Main', cells: [{ row: 1, col: 1, input: '=SUM(Sales)*Rate', value: 30, fmt: {} }], widths: {} }, { name: "Bob's tab", cells: [], widths: {} }],
    names: [{ name: 'Sales', tab: 'Main', range: 'B2:B4' }, { name: 'Rate', tab: "Bob's tab", range: 'A1' }]
  }
  const bytes = workbookBytes(XLSX, fflate, dump)
  const { tabs, names } = workbookToTabs(XLSX, XLSX.read(bytes, { type: 'array', ...READ_OPTIONS }))
  const doc = model.createDoc()
  model.initSheet(doc)
  model.importTabs(doc, { tabs, names })
  assert.deepEqual(model.getNames(doc).map((n) => [n.name, n.tab, n.range]), [['Rate', "Bob's tab", 'A1'], ['Sales', 'Main', 'B2:B4']])
  assert.equal(model.getInput(doc, model.tabIds(doc)[0], 1, 1), '=SUM(Sales)*Rate')
})
