// Sort a range, find, and replace (notes/2026-10-04-calc-parity.md).

const test = require('node:test')
const assert = require('node:assert/strict')
const Hyperswarm = require('hyperswarm')
const Corestore = require('corestore')
const createTestnet = require('@hyperswarm/testnet')
const { createSheetEngine } = require('../src/worklet/engine')
const { tmpDir, cleanup, call, grid: gridNow } = require('./helpers')

// Shown values follow an edit a moment later (sheets.js recompute).
const settle = () => new Promise((resolve) => setTimeout(resolve, 60))
const grid = async (...a) => { await settle(); return gridNow(...a) }

test('sort, find and replace', async (t) => {
  const testnet = await createTestnet(3)
  const e = createSheetEngine({ corestore: new Corestore(tmpDir()), createSwarm: ({ keyPair }) => new Hyperswarm({ keyPair, bootstrap: testnet.bootstrap }) })
  await e.init({})
  t.after(async () => { await e.close(); await testnet.destroy(); cleanup() })
  const { sheetId } = await call(e, 'sheet:create', { title: 'Sorting' })
  await call(e, 'sheet:setCells', { sheetId, row: 1, col: 1, grid: [['Name', 'Score', 'Double'], ['pear', '30', '=B2*2'], ['Apple', '90', '=B3*2'], ['fig', '', '=B4*2'], ['apple', '60', '=B5*2']] })
  await call(e, 'sheet:setFormat', { sheetId, row: 3, col: 1, patch: { b: true } })
  await call(e, 'sheet:setCell', { sheetId, row: 1, col: 5, input: 'outside' })
  // Undo groups edits made within half a second; keep the setup out of the sort's undo step.
  await new Promise((resolve) => setTimeout(resolve, 700))

  await t.test('sorting by a column keeps the header, moves formulas and formats with their row, and leaves blanks last', async () => {
    await call(e, 'sheet:sortRange', { sheetId, r1: 1, c1: 1, r2: 5, c2: 3, keys: [{ col: 2, desc: true }], header: true })
    const g = await grid(e, sheetId)
    assert.deepEqual([1, 2, 3, 4, 5].map((r) => g[r + ',1']), ['Name', 'Apple', 'apple', 'pear', 'fig'])
    assert.equal(g['2,3'], '=B2*2 -> 180', 'the formula points at its own row after the move')
    assert.equal(g['5,3'], '=B5*2 -> 0')
    const v = await call(e, 'sheet:view', { sheetId })
    assert.deepEqual(v.cells.find((c) => c.row === 2 && c.col === 1).fmt, { b: true }, 'the bold moved with Apple')
    assert.equal(g['1,5'], 'outside', 'columns outside the range stay put')
    await call(e, 'sheet:undo', { sheetId })
    assert.equal((await grid(e, sheetId))['2,1'], 'pear', 'one undo puts it back')
  })

  await t.test('two keys: text without case, then score', async () => {
    await call(e, 'sheet:sortRange', { sheetId, r1: 2, c1: 1, r2: 5, c2: 3, keys: [{ col: 1 }, { col: 2, desc: true }] })
    const g = await grid(e, sheetId)
    assert.deepEqual([2, 3, 4, 5].map((r) => g[r + ',1']), ['Apple', 'apple', 'fig', 'pear'])
  })

  await t.test('find in values or in formulas, on one tab or all', async () => {
    const { id: other } = await call(e, 'sheet:addTab', { sheetId, name: 'Two' }).then((r) => ({ id: r.tabId }))
    await call(e, 'sheet:setCell', { sheetId, tabId: other, row: 1, col: 1, input: 'apple pie' })
    const values = await call(e, 'sheet:find', { sheetId, query: 'apple' })
    assert.deepEqual(values.matches.map((x) => [x.row, x.col]), [[2, 1], [3, 1]])
    const all = await call(e, 'sheet:find', { sheetId, query: 'apple', allTabs: true })
    assert.equal(all.matches.length, 3)
    const exact = await call(e, 'sheet:find', { sheetId, query: 'apple', matchCase: true, wholeCell: true })
    assert.deepEqual(exact.matches.map((x) => [x.row, x.col]), [[3, 1]])
    const formulas = await call(e, 'sheet:find', { sheetId, query: 'B4', lookIn: 'formulas' })
    assert.deepEqual(formulas.matches.map((x) => [x.row, x.col]), [[4, 3]])
    const shown = await call(e, 'sheet:find', { sheetId, query: '180' })
    assert.deepEqual(shown.matches.map((x) => [x.row, x.col]), [[2, 3]], 'values mode finds what a formula shows')
  })

  await t.test('replace one cell, or every match', async () => {
    const v = await call(e, 'sheet:view', { sheetId })
    const tabId = v.tabId
    let r = await call(e, 'sheet:replace', { sheetId, query: 'apple', replacement: 'Plum', at: { tabId, row: 2, col: 1 } })
    assert.equal(r.count, 1)
    assert.equal((await grid(e, sheetId))['3,1'], 'apple', 'only the chosen cell')
    r = await call(e, 'sheet:replace', { sheetId, query: '*2', replacement: '*3' })
    assert.equal(r.count, 4)
    assert.equal((await grid(e, sheetId))['2,3'], '=B2*3 -> 270', 'replacing inside formulas recalculates')
  })
})
