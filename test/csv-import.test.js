// CSV and tab-separated files as sheets (src/shared/csvImport.js).

const test = require('node:test')
const assert = require('node:assert/strict')
const Hyperswarm = require('hyperswarm')
const Corestore = require('corestore')
const createTestnet = require('@hyperswarm/testnet')
const { createSheetEngine } = require('../src/worklet/engine')
const { csvToTabs, csvBytesToTabs, separatorOf, parseCsv } = require('../src/shared/csvImport')
const { tmpDir, cleanup, call, grid } = require('./helpers')

const cells = (text) => csvToTabs(text).tabs[0].cells
const at = (list, row, col) => list.find((c) => c[0] === row && c[1] === col)

test('accents and emoji survive, with or without a byte-order mark', () => {
  const bytes = new TextEncoder().encode('Café,Note\nNaïve,😀\n')
  assert.deepEqual(csvBytesToTabs(bytes).tabs[0].cells.map((c) => c[2]), ['Café', 'Note', 'Naïve', '😀'])
  assert.equal(at(cells('﻿Name\nA\n'), 1, 1)[2], 'Name')
})

test('leading zeros stay as text', () => {
  const list = cells('Code,Zip\n007,02134\n0,0.5\n')
  assert.deepEqual(at(list, 2, 1), [2, 1, "'007"])
  assert.deepEqual(at(list, 2, 2), [2, 2, "'02134"])
  assert.deepEqual(at(list, 3, 1), [3, 1, '0'])
  assert.deepEqual(at(list, 3, 2), [3, 2, '0.5'])
})

test('dates are dates shown as yyyy-mm-dd, with the time when there is one', () => {
  const list = cells('Due\n2026-11-01\n11/15/2026\n2026-10-04 08:30\n2026-13-45\n')
  assert.deepEqual(at(list, 2, 1), [2, 1, '46327', 'yyyy-mm-dd'])
  assert.deepEqual(at(list, 3, 1), [3, 1, '46341', 'yyyy-mm-dd'])
  assert.deepEqual(at(list, 4, 1), [4, 1, '46299.35416667', 'yyyy-mm-dd hh:mm'])
  assert.deepEqual(at(list, 5, 1), [5, 1, '2026-13-45'], 'not a real date stays text')
  // A day above 12 first means the whole file writes the day first.
  const dm = cells('Due\n15/11/2026\n01/02/2026\n')
  assert.deepEqual(at(dm, 3, 1), [3, 1, '46054', 'yyyy-mm-dd'], '1 February, not 2 January')
})

test('percentages and money keep their format', () => {
  const list = cells('Amount\n12%\n12.5%\n"$1,200.50"\n"1,234"\n')
  assert.deepEqual(at(list, 2, 1), [2, 1, '0.12', '0%'])
  assert.deepEqual(at(list, 3, 1), [3, 1, '0.125', '0.00%'])
  assert.deepEqual(at(list, 4, 1), [4, 1, '1200.5', '$#,##0.00'])
  assert.deepEqual(at(list, 5, 1), [5, 1, '1234', '#,##0'])
})

test('separators, quotes and line endings', () => {
  assert.equal(separatorOf('a;b;c\n1,5;2;3'), ';')
  assert.equal(separatorOf('a\tb\n'), '\t')
  assert.equal(separatorOf('"x;y",b\n'), ',')
  assert.deepEqual(at(cells('Name;Amount\nA;1,5\n'), 2, 2), [2, 2, '1.5'], 'decimal comma with semicolons')
  assert.deepEqual(parseCsv('a,"b ""q"", c"\r\nd,e', ','), [['a', 'b "q", c'], ['d', 'e']])
  assert.deepEqual(at(cells('x\nTRUE\n=1+1\n'), 3, 1), [3, 1, '=1+1'])
  assert.throws(() => csvToTabs('\n\n'), /nothing to put in a sheet/)
})

test('a CSV file imports and shows its dates and formats', async (t) => {
  const testnet = await createTestnet(3)
  const e = createSheetEngine({ corestore: new Corestore(tmpDir()), createSwarm: ({ keyPair }) => new Hyperswarm({ keyPair, bootstrap: testnet.bootstrap }) })
  t.after(async () => { await e.close(); await testnet.destroy(); cleanup() })
  await e.init({})
  const { sheetId } = await call(e, 'sheet:import', { title: 'bills', ...csvToTabs('Name,Due,Share,Code\nRent,2026-11-01,12%,007\n') })
  const g = await grid(e, sheetId)
  assert.equal(g['2,2'], '46327 -> 2026-11-01')
  assert.equal(g['2,3'], '0.12 -> 12%')
  assert.equal(g['2,4'], "'007 -> 007")
})
