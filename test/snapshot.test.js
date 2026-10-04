// Local snapshots: reopening a sheet with a long history loads the saved
// state and replays only what came after; a snapshot from a rewound view is
// ignored.

const test = require('node:test')
const assert = require('node:assert/strict')
const Corestore = require('corestore')
const Hyperswarm = require('hyperswarm')
const createTestnet = require('@hyperswarm/testnet')
const { createSheetEngine } = require('../src/worklet/engine')
const { tmpDir, cleanup, call, grid } = require('./helpers')

test('snapshots speed up reopening without changing the sheet', async (t) => {
  const testnet = await createTestnet(3)
  const dir = tmpDir()
  const mk = () => createSheetEngine({ corestore: new Corestore(dir), createSwarm: ({ keyPair }) => new Hyperswarm({ keyPair, bootstrap: testnet.bootstrap }) })
  let e = mk()
  t.after(async () => { try { await e.close() } catch {} await testnet.destroy(); cleanup() })
  await e.init({})
  const { sheetId } = await call(e, 'sheet:create', { title: 'History' })
  for (let i = 0; i < 2100; i++) await call(e, 'sheet:setCell', { sheetId, row: 1 + (i % 40), col: 1 + (i % 5), input: String(i) })
  await e.sheets.load(sheetId)
  await new Promise((resolve) => setTimeout(resolve, 300))
  const auto = (await e.localDb.get('snap:' + sheetId))?.value
  assert.ok(auto, 'a snapshot was saved after 2,000 updates')
  for (let i = 0; i < 30; i++) await call(e, 'sheet:setCell', { sheetId, row: 50 + i, col: 1, input: 'late ' + i })
  const want = await grid(e, sheetId)
  // Close as a crash would: no final snapshot, so the saved one is older than
  // the view.
  e.sheets.flushSnapshots = async () => {}
  await e.close()

  // The older snapshot plus the entries after it gives the whole sheet.
  e = mk()
  await e.init({})
  assert.equal((await e.localDb.get('snap:' + sheetId)).value.version, auto.version)
  const loaded = await e.sheets.load(sheetId)
  assert.equal(loaded.fromSnapshot, true)
  await e.sheets.load(sheetId)
  await new Promise((resolve) => setTimeout(resolve, 300))
  assert.deepEqual(await grid(e, sheetId), want)
  await e.close()

  // A snapshot whose fork does not match the view is ignored.
  e = mk()
  await e.init({})
  const snap = (await e.localDb.get('snap:' + sheetId)).value
  await e.localDb.put('snap:' + sheetId, { ...snap, fork: snap.fork + 1 })
  const rebuilt = await e.sheets.load(sheetId)
  assert.ok(!rebuilt.fromSnapshot)
  assert.deepEqual(await grid(e, sheetId), want)
})
