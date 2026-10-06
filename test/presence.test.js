// Who has a sheet open (proposals/2026-10-05-presence.md): members see each
// other's cell and typing; a device that is not a member sees nothing and
// cannot pose as one.

const test = require('node:test')
const assert = require('node:assert/strict')
const b4a = require('b4a')
const Hyperswarm = require('hyperswarm')
const Corestore = require('corestore')
const createTestnet = require('@hyperswarm/testnet')
const { signValue } = require('@peerloom/core/records')
const { createSheetEngine } = require('../src/worklet/engine')
const { tmpDir, cleanup, waitFor, call } = require('./helpers')

const hex = (buf) => b4a.toString(buf, 'hex')

test('presence between members, and nothing for anyone else', async (t) => {
  const testnet = await createTestnet(3)
  const mkSwarm = ({ keyPair }) => new Hyperswarm({ keyPair, bootstrap: testnet.bootstrap })
  const engines = []
  async function device (name) {
    const e = createSheetEngine({ corestore: new Corestore(tmpDir()), createSwarm: mkSwarm })
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
  const editor = await device('Editor')
  const stranger = await device('Stranger')
  const { sheetId } = await call(owner, 'sheet:create', { title: 'Plans' })
  const { link } = await call(owner, 'sheet:invite', { sheetId, role: 'editor' })
  await call(editor, 'sheet:join', { link })
  await waitFor('editor joined', async () => (await call(editor, 'sheet:view', { sheetId })).myRole === 'editor')

  const seen = (e) => e.presence.list(sheetId)
  const tab = (await call(owner, 'sheet:view', { sheetId })).tabId

  await t.test('two members see each other\'s cell and typing', async () => {
    await call(owner, 'sheet:presence', { sheetId, open: true, tab, row: 2, col: 3 })
    await call(editor, 'sheet:presence', { sheetId, open: true, tab, row: 5, col: 1 })
    await waitFor('owner sees the editor', async () => seen(owner).some((p) => p.identity === hex(editor.identity.publicKey) && p.row === 5 && p.col === 1))
    await waitFor('editor sees the owner', async () => seen(editor).some((p) => p.identity === hex(owner.identity.publicKey) && p.row === 2 && p.col === 3))
    await call(editor, 'sheet:presence', { sheetId, open: true, tab, row: 6, col: 1, editing: true })
    await waitFor('owner sees typing', async () => seen(owner).some((p) => p.row === 6 && p.editing))
  })

  await t.test('a device that is not a member sees nothing', async () => {
    // Connect the stranger straight to the owner, with the sheet "open".
    stranger.swarm.joinPeer(owner.swarm.keyPair.publicKey)
    await waitFor('connected', async () => [...owner.swarm.connections].some((conn) => b4a.equals(conn.remotePublicKey, stranger.swarm.keyPair.publicKey)))
    await call(stranger, 'sheet:presence', { sheetId, open: true, tab, row: 1, col: 1 })
    await new Promise((resolve) => setTimeout(resolve, 1500))
    assert.deepEqual(seen(stranger), [])
    assert.ok(!seen(owner).some((p) => p.identity === hex(stranger.identity.publicKey)))
  })

  await t.test('a hello that does not prove a member is refused', async () => {
    const connTo = (e, other) => ({ conn: [...e.swarm.connections].find((x) => b4a.equals(x.remotePublicKey, other.swarm.keyPair.publicKey)) })
    const fromStranger = connTo(owner, stranger)
    const fromEditor = connTo(owner, editor)
    const hello = (who, { device = who.swarm.keyPair.publicKey, at = Date.now(), identity = who.identity.publicKey } = {}) =>
      ({ t: 'hello', ...signValue({ purpose: 'pearoffice/presence/v1', sheetId, identity: hex(identity), device: hex(device), at }, who.identity.secretKey) })
    const check = (ch, msg) => owner.presence._checkHello(ch, sheetId, msg)
    assert.equal(await check(fromEditor, hello(editor)), true, 'the real editor passes')
    assert.equal(await check(fromStranger, hello(stranger)), false, 'signed properly, but not a member')
    assert.equal(await check(fromStranger, hello(stranger, { identity: editor.identity.publicKey })), false, 'claims the editor without the editor\'s key')
    assert.equal(await check(fromStranger, hello(editor)), false, 'the editor\'s hello replayed on another connection')
    assert.equal(await check(fromEditor, hello(editor, { at: Date.now() - 3600000 })), false, 'too old')
  })

  await t.test('looking again finds the sheet\'s topic and sees the connected device', async () => {
    assert.equal(await owner.rediscover.refresh(sheetId), true, 'the topic is joined and can be refreshed')
    await waitFor('editor replicates the sheet', async () => owner.bases.get(sheetId).local.peers.length > 0)
  })

  await t.test('closing the sheet takes the person off', async () => {
    await call(editor, 'sheet:presence', { sheetId, open: false })
    await waitFor('editor gone', async () => !seen(owner).some((p) => p.identity === hex(editor.identity.publicKey)))
    await call(editor, 'sheet:presence', { sheetId, open: true, tab, row: 1, col: 2 })
    await waitFor('editor back', async () => seen(owner).some((p) => p.identity === hex(editor.identity.publicKey) && p.col === 2))
  })
})
