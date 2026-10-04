// The sheet list follows changes made on other devices, for sheets this
// device has not opened (Tim, 2026-10-04: "all updates should happen live").

const test = require('node:test')
const assert = require('node:assert/strict')
const Hyperswarm = require('hyperswarm')
const Corestore = require('corestore')
const createTestnet = require('@hyperswarm/testnet')
const { createSheetEngine } = require('../src/worklet/engine')
const { tmpDir, cleanup, waitFor, call } = require('./helpers')

test('a rename on another device reaches the list of a sheet nobody opened here', async (t) => {
  const testnet = await createTestnet(3)
  const mkSwarm = ({ keyPair }) => new Hyperswarm({ keyPair, bootstrap: testnet.bootstrap })
  const engines = []
  async function device (name, dir = tmpDir()) {
    const e = createSheetEngine({ corestore: new Corestore(dir), createSwarm: mkSwarm })
    engines.push(e)
    await e.init({})
    await call(e, 'app:setName', { name })
    return e
  }
  t.after(async () => {
    for (const e of engines) { try { await e.close() } catch {} }
    await testnet.destroy()
    cleanup()
  })

  const owner = await device('Owner')
  const dir = tmpDir()
  let editor = await device('Editor', dir)
  const { sheetId } = await call(owner, 'sheet:create', { title: 'Trip' })
  const { link } = await call(owner, 'sheet:invite', { sheetId, role: 'editor' })
  await call(editor, 'sheet:join', { link })
  await waitFor('editor in', async () => editor.bases.get(sheetId)?.writable)

  // Start the editor afresh, so the sheet is not loaded there.
  await editor.close()
  editor = await device('Editor', dir)
  const titleOn = async (e) => ((await call(e, 'sheet:list')).find((s) => s.sheetId === sheetId) || {}).title
  await waitFor('list shows the title', async () => (await titleOn(editor)) === 'Trip')

  await call(owner, 'sheet:setTitle', { sheetId, title: 'Trip to Lisbon' })
  await waitFor('rename reaches the list', async () => (await titleOn(editor)) === 'Trip to Lisbon')
  assert.equal(await titleOn(editor), 'Trip to Lisbon')
})
