// A sheet made by a newer build (a higher meta version) opens read-only, as
// documents and slides do, so this build never drops what it does not know.

const test = require('node:test')
const assert = require('node:assert/strict')
const Hyperswarm = require('hyperswarm')
const Corestore = require('corestore')
const createTestnet = require('@hyperswarm/testnet')
const { createSheetEngine } = require('../src/worklet/engine')
const model = require('../src/sheet/sheetModel')
const { tmpDir, cleanup, waitFor, call, grid } = require('./helpers')

test('a sheet from a newer version is read-only', async (t) => {
  const testnet = await createTestnet(3)
  const e = createSheetEngine({ corestore: new Corestore(tmpDir()), createSwarm: ({ keyPair }) => new Hyperswarm({ keyPair, bootstrap: testnet.bootstrap }) })
  t.after(async () => {
    try { await e.close() } catch {}
    await testnet.destroy()
    cleanup()
  })
  await e.init({})

  const { sheetId } = await call(e, 'sheet:create', { title: 'Plans' })
  assert.equal((await call(e, 'sheet:view', { sheetId })).newer, false)
  await call(e, 'sheet:setCell', { sheetId, row: 1, col: 1, input: 'one' })
  await waitFor('the edit shows', async () => (await grid(e, sheetId))['1,1'] === 'one')

  const meta = (await e.sheets.load(sheetId)).guarded.doc.getMap('meta')
  assert.equal(meta.get('version'), model.VERSION)
  meta.set('version', model.VERSION + 1)
  const view = await call(e, 'sheet:view', { sheetId })
  assert.equal(view.newer, true)
  assert.equal(view.myRole, 'owner')
  await assert.rejects(call(e, 'sheet:setCell', { sheetId, row: 1, col: 1, input: 'two' }), /newer version/)
  await assert.rejects(call(e, 'sheet:setFormat', { sheetId, row: 1, col: 1, patch: { b: true } }), /newer version/)
  assert.equal((await grid(e, sheetId))['1,1'], 'one')

  meta.set('version', model.VERSION)
  await call(e, 'sheet:setCell', { sheetId, row: 1, col: 1, input: 'two' })
  await waitFor('the edit shows', async () => (await grid(e, sheetId))['1,1'] === 'two')
})
