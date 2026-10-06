// Two PearOffice engines over a local DHT testnet: create, invite, join,
// concurrent edits on both sides, convergence, restart.

const test = require('node:test')
const assert = require('node:assert/strict')
const Hyperswarm = require('hyperswarm')
const createTestnet = require('@hyperswarm/testnet')
const { createSheetEngine } = require('../src/worklet/engine')
const Corestore = require('corestore')
const { tmpDir, cleanup, waitFor, call, grid } = require('./helpers')

test('two devices converge after concurrent offline edits, and survive a restart', async (t) => {
  const testnet = await createTestnet(3)
  const mkSwarm = ({ keyPair }) => new Hyperswarm({ keyPair, bootstrap: testnet.bootstrap })
  const dirA = tmpDir()
  const dbg = (who) => process.env.DEBUG_JOIN ? (msg) => console.log(Date.now() % 100000, who, msg) : undefined
  let A = createSheetEngine({ corestore: new Corestore(dirA), createSwarm: mkSwarm, log: dbg('A') })
  const B = createSheetEngine({ corestore: new Corestore(tmpDir()), createSwarm: mkSwarm, log: dbg('B') })
  t.after(async () => {
    try { await A.close() } catch {}
    try { await B.close() } catch {}
    await testnet.destroy()
    cleanup()
  })

  await A.init({})
  await B.init({})

  const { sheetId } = await call(A, 'sheet:create', { title: 'Budget' })
  await call(A, 'sheet:setCell', { sheetId, row: 1, col: 1, input: 'Rent' })
  await call(A, 'sheet:setCell', { sheetId, row: 1, col: 2, input: '1200' })
  await call(A, 'sheet:setCell', { sheetId, row: 2, col: 1, input: 'Food' })
  await call(A, 'sheet:setCell', { sheetId, row: 2, col: 2, input: '450.5' })
  await call(A, 'sheet:setCell', { sheetId, row: 3, col: 2, input: '=SUM(B1:B2)' })

  const { link } = await call(A, 'sheet:invite', { sheetId, role: 'editor' })
  await call(B, 'sheet:join', { link })

  await waitFor('B sees the sheet', async () => {
    if (!B.bases.get(sheetId)) return false
    const g = await grid(B, sheetId).catch((e) => ({ err: e.message }))
    if (process.env.DEBUG_JOIN) console.log('B grid', JSON.stringify(g))
    return g && g['3,2'] === '=SUM(B1:B2) -> 1650.5'
  })
  await waitFor('B is a writer', async () => B.bases.get(sheetId).writable && (await call(B, 'sheet:view', { sheetId })).myRole === 'editor')

  // Concurrent edits while both are connected but before either sees the
  // other's: same cell, different cells, row inserts.
  await Promise.all([
    call(A, 'sheet:setCell', { sheetId, row: 2, col: 2, input: '500' }),
    call(B, 'sheet:setCell', { sheetId, row: 2, col: 2, input: '510' }),
    call(A, 'sheet:insertRows', { sheetId, at: 1 }),
    call(B, 'sheet:setCell', { sheetId, row: 1, col: 3, input: 'note from B' })
  ])

  let ga, gb
  await waitFor('converged', async () => {
    ga = await grid(A, sheetId)
    gb = await grid(B, sheetId)
    return JSON.stringify(ga) === JSON.stringify(gb) && Object.values(ga).includes('note from B')
  })
  // The SUM moved down a row with the insert and still points at the same cells.
  assert.match(ga['4,2'], /^=SUM\(B2:B3\) -> (1700|1710)$/)

  // Restart A: the document rebuilds from its local view.
  await A.close()
  A = createSheetEngine({ corestore: new Corestore(dirA), createSwarm: mkSwarm })
  await A.init({})
  assert.deepEqual(await grid(A, sheetId), gb)

  // And A can still edit after the restart.
  await call(A, 'sheet:setCell', { sheetId, row: 6, col: 1, input: 'after restart' })
  await waitFor('B sees the post-restart edit', async () => (await grid(B, sheetId))['6,1'] === 'after restart')
})
