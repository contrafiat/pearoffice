// What the recovery phrase gives back (proposals/2026-10-03-device-linking.md,
// "Restore"): the identity, and nothing else. It holds no file keys, so files
// come back only when someone who can invite sends a new invite, and only a
// file's owner can invite. These tests pin that down, so what the app tells
// people about the phrase stays true.

const test = require('node:test')
const assert = require('node:assert/strict')
const b4a = require('b4a')
const Hyperswarm = require('hyperswarm')
const Corestore = require('corestore')
const createTestnet = require('@hyperswarm/testnet')
const { createSheetEngine } = require('../src/worklet/engine')
const { tmpDir, cleanup, waitFor, call, grid } = require('./helpers')

const hex = (buf) => b4a.toString(buf, 'hex')

test('the recovery phrase brings back the identity, not the files', async (t) => {
  const testnet = await createTestnet(3)
  const mkSwarm = ({ keyPair }) => new Hyperswarm({ keyPair, bootstrap: testnet.bootstrap })
  const open = []
  async function device (name, dir = tmpDir()) {
    const e = createSheetEngine({ corestore: new Corestore(dir), createSwarm: mkSwarm })
    open.push(e)
    await e.init({})
    if (name) await call(e, 'app:setName', { name })
    return e
  }
  t.after(async () => {
    for (const e of open) { try { await e.close() } catch {} }
    await testnet.destroy()
    cleanup()
  })
  const memberNames = async (e, sheetId) => (await call(e, 'sheet:members', { sheetId })).members.map((m) => m.name + ':' + m.role).sort().join(',')

  // Olive owns a file Ed edits; Ed owns a file Olive edits.
  const olive = await device('Olive')
  const ed = await device('Ed')
  const { sheetId: olives } = await call(olive, 'sheet:create', { title: 'Olive owns' })
  await call(olive, 'sheet:setCell', { sheetId: olives, row: 1, col: 1, input: 'from olive' })
  const { sheetId: eds } = await call(ed, 'sheet:create', { title: 'Ed owns' })
  await call(ed, 'sheet:setCell', { sheetId: eds, row: 1, col: 1, input: 'from ed' })
  for (const [owner, other, sheetId] of [[olive, ed, olives], [ed, olive, eds]]) {
    const { link } = await call(owner, 'sheet:invite', { sheetId, role: 'editor' })
    await call(other, 'sheet:join', { link })
    await waitFor('joined', async () => !!other.bases.get(sheetId) && other.bases.get(sheetId).writable)
  }
  await waitFor('olive sees both', async () => (await memberNames(olive, olives)) === 'Ed:editor,Olive:owner')
  const edKey = hex(ed.identity.publicKey)
  const { phrase } = await call(ed, 'link:phrase')

  // Ed loses his only device and restores on a new one.
  await ed.close()
  const dirR = tmpDir()
  let restored = await device(null, dirR)
  assert.equal((await call(restored, 'app:restorePhrase', { phrase })).restart, true)
  await restored.close()
  restored = await device(null, dirR)

  await t.test('the new device is the same person', async () => {
    assert.equal(hex(restored.identity.publicKey), edKey)
  })

  await t.test('it has no files: the phrase holds no file keys', async () => {
    assert.equal((await call(restored, 'file:list')).length, 0)
  })

  await t.test('a file someone else owns: the owner invites again and Ed is back as himself', async () => {
    const { link } = await call(olive, 'sheet:invite', { sheetId: olives, role: 'editor' })
    await call(restored, 'sheet:join', { link })
    await waitFor('back in', async () => !!restored.bases.get(olives) && restored.bases.get(olives).writable, { timeout: 40000 })
    await waitFor('content', async () => (await grid(restored, olives))['1,1'] === 'from olive')
    // The same member, not a second one.
    assert.equal((await call(olive, 'sheet:members', { sheetId: olives })).members.filter((m) => m.identity === edKey).length, 1)
    await call(restored, 'sheet:setCell', { sheetId: olives, row: 2, col: 1, input: 'ed is back' })
    await waitFor('olive sees it', async () => (await grid(olive, olives))['2,1'] === 'ed is back')
  })

  await t.test('his name comes back with the files he rejoins', async () => {
    await waitFor('name', async () => ((await call(restored, 'app:me')).name || '') === 'Ed', { timeout: 20000 })
  })

  await t.test('a file Ed owned: nobody else can invite him back', async () => {
    assert.equal((await call(olive, 'sheet:view', { sheetId: eds })).myRole, 'editor')
    await assert.rejects(call(olive, 'sheet:invite', { sheetId: eds, role: 'editor' }), /Only the owner/)
  })
})
