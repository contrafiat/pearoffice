// JSON files as sheets (src/shared/jsonImport.js).

const test = require('node:test')
const assert = require('node:assert/strict')
const Hyperswarm = require('hyperswarm')
const Corestore = require('corestore')
const createTestnet = require('@hyperswarm/testnet')
const { createSheetEngine } = require('../src/worklet/engine')
const { jsonToTabs, jsonFileToTabs, cellFor } = require('../src/shared/jsonImport')
const { tmpDir, cleanup, call, grid } = require('./helpers')

// Shaped like a budget app's export.
const EXPORT = {
  balance: 1250,
  btcBalance: 0,
  recurring: [
    { id: 'r1', name: 'Rent', amount: 1200, nextDue: '2026-11-01', enabled: true, endDate: null },
    { id: 'r2', name: 'Phone', amount: 45.5, nextDue: '2026-10-20', enabled: false, tags: ['bills', 'monthly'], extra: { note: 'family plan' } }
  ],
  settings: { currency: 'USD', chartTypes: { income: 'bar' }, privacyMode: false },
  customCategories: { expense: ['Pets'], income: [] },
  history: [{ id: 'h1', amount: 10, paidAt: '2026-10-04T22:55:01Z', code: '007' }],
  savedAt: '2026-10-05T08:00:00.000Z'
}

const tab = (tabs, name) => tabs.find((t) => t.name === name)
const at = (t, row, col) => t.cells.find((c) => c[0] === row && c[1] === col)

test('lists of records become tabs, everything else a Summary', () => {
  const { tabs } = jsonToTabs(EXPORT)
  assert.deepEqual(tabs.map((t) => t.name), ['Summary', 'recurring', 'history'])
  const rec = tab(tabs, 'recurring')
  assert.deepEqual(rec.cells.filter((c) => c[0] === 1).map((c) => c[2]), ['id', 'name', 'amount', 'nextDue', 'enabled', 'endDate', 'tags', 'extra.note'])
  assert.deepEqual(at(rec, 3, 3), [3, 3, '45.5'])
  assert.deepEqual(at(rec, 2, 5), [2, 5, 'TRUE'])
  assert.equal(at(rec, 2, 6), undefined, 'null is an empty cell')
  assert.deepEqual(at(rec, 3, 7), [3, 7, 'bills, monthly'])
  assert.deepEqual(at(rec, 3, 8), [3, 8, 'family plan'])
  assert.deepEqual(rec.freeze, { rows: 1, cols: 0 })
  assert.ok(rec.styles.every(([r, , f]) => r === 1 && f.b))
  const sum = tab(tabs, 'Summary')
  const fields = sum.cells.filter((c) => c[1] === 1).map((c) => c[2])
  assert.deepEqual(fields, ['Field', 'balance', 'btcBalance', 'settings.currency', 'settings.chartTypes.income', 'settings.privacyMode', 'customCategories.expense', 'customCategories.income', 'savedAt'])
})

test('dates become dates, and text that looks like a number stays text', () => {
  assert.deepEqual(cellFor('2026-10-04'), ['46299', 'yyyy-mm-dd'])
  const [serial, fmt] = cellFor('2026-10-04T22:55:01Z')
  assert.equal(fmt, 'yyyy-mm-dd hh:mm')
  const local = new Date('2026-10-04T22:55:01Z')
  assert.ok(Math.abs(Number(serial) - ((local.getTime() - local.getTimezoneOffset() * 60000) / 86400000 + 25569)) < 1e-6)
  assert.deepEqual(cellFor('007'), ["'007"])
  assert.deepEqual(cellFor('true'), ["'true"])
  assert.deepEqual(cellFor('=1+1'), ["'=1+1"])
  assert.deepEqual(cellFor('2026-13-45'), ['2026-13-45'], 'not a real date shape stays text')
})

test('a bare list is one tab; plain values make one column', () => {
  assert.deepEqual(jsonToTabs([{ a: 1 }, { b: 2 }]).tabs.map((t) => t.cells), [[[1, 1, 'a'], [1, 2, 'b'], [2, 1, '1'], [3, 2, '2']]])
  assert.deepEqual(jsonToTabs([1, 'x', null]).tabs[0].cells, [[1, 1, 'value'], [2, 1, '1'], [3, 1, 'x']])
  assert.equal(jsonToTabs(42).tabs[0].name, 'Summary')
})

test('bad or empty files say why', () => {
  assert.throws(() => jsonFileToTabs('{ not json'), /not valid JSON/)
  assert.throws(() => jsonFileToTabs('{}'), /nothing to put in a sheet/)
  assert.ok(jsonFileToTabs('﻿[{"a":1}]').tabs.length, 'a byte-order mark is fine')
})

test('a JSON file imports into a sheet that shows its dates', async (t) => {
  const testnet = await createTestnet(3)
  const e = createSheetEngine({ corestore: new Corestore(tmpDir()), createSwarm: ({ keyPair }) => new Hyperswarm({ keyPair, bootstrap: testnet.bootstrap }) })
  t.after(async () => { await e.close(); await testnet.destroy(); cleanup() })
  await e.init({})
  const { sheetId } = await call(e, 'sheet:import', { title: 'budget export', ...jsonToTabs(EXPORT) })
  const view = await call(e, 'sheet:view', { sheetId })
  assert.deepEqual(view.tabs.map((x) => x.name), ['Summary', 'recurring', 'history'])
  const rec = await grid(e, sheetId, view.tabs[1].id)
  assert.equal(rec['2,2'], 'Rent')
  assert.equal(rec['2,4'], '46327 -> 2026-11-01')
  assert.equal(rec['3,3'], '45.5')
})
