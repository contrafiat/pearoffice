// Stopping a join that is still waiting, and giving up after 7 days.

const test = require('node:test')
const assert = require('node:assert/strict')
const Hyperswarm = require('hyperswarm')
const Corestore = require('corestore')
const createTestnet = require('@hyperswarm/testnet')
const { createSheetEngine } = require('../src/worklet/engine')
const { tmpDir, cleanup, call, waitFor } = require('./helpers')

test('stopping a waiting join', async (t) => {
  const testnet = await createTestnet(3)
  const mkSwarm = ({ keyPair }) => new Hyperswarm({ keyPair, bootstrap: testnet.bootstrap })
  const engines = []
  async function device (dir = tmpDir()) {
    const e = createSheetEngine({ corestore: new Corestore(dir), createSwarm: mkSwarm })
    engines.push(e)
    await e.init({})
    return e
  }
  t.after(async () => {
    for (const e of engines) { try { await e.close() } catch {} }
    await testnet.destroy()
    cleanup()
  })

  // The owner makes an invite and goes offline, so nobody can let the joiner in.
  const owner = await device()
  const { sheetId } = await call(owner, 'sheet:create', { title: 'Away' })
  const { link } = await call(owner, 'sheet:invite', { sheetId, role: 'editor' })
  await owner.close()

  const dir = tmpDir()
  let joiner = await device(dir)

  await t.test('the waiting join is listed and can be stopped', async () => {
    await call(joiner, 'sheet:join', { link })
    const entry = (await call(joiner, 'sheet:list')).find((x) => x.sheetId === sheetId)
    assert.equal(entry.waiting, true)
    assert.equal(entry.role, 'editor')
    assert.equal(typeof entry.startedAt, 'number')
    await call(joiner, 'sheet:cancelJoin', { sheetId })
    assert.equal((await call(joiner, 'sheet:list')).find((x) => x.sheetId === sheetId), undefined)
    assert.equal(await joiner.localDb.get('joins:pending:' + sheetId), null)
  })

  await t.test('a join that waited more than 7 days stops on the next start', async () => {
    await call(joiner, 'sheet:join', { link })
    const rec = (await joiner.localDb.get('joins:pending:' + sheetId)).value
    await joiner.close()
    joiner = await device(dir)
    await joiner.localDb.put('joins:pending:' + sheetId, { ...rec, startedAt: Date.now() - 8 * 24 * 3600 * 1000 })
    await joiner.close()
    joiner = await device(dir)
    await waitFor('gave up', async () => !(await joiner.localDb.get('joins:pending:' + sheetId)))
    assert.equal((await call(joiner, 'sheet:list')).find((x) => x.sheetId === sheetId), undefined)
  })
})
