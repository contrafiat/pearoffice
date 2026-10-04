// Removing someone by moving to a fresh key (proposal section 7): the others
// follow to the new sheet, the removed person cannot open it, the old sheet
// freezes.

const test = require('node:test')
const assert = require('node:assert/strict')
const b4a = require('b4a')
const Hyperswarm = require('hyperswarm')
const Corestore = require('corestore')
const createTestnet = require('@hyperswarm/testnet')
const { createSheetEngine } = require('../src/worklet/engine')
const { tmpDir, cleanup, waitFor, call, grid } = require('./helpers')

const hex = (buf) => b4a.toString(buf, 'hex')

test('removal moves the sheet to fresh keys', async (t) => {
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
  const editor = await device('Editor')
  const viewer = await device('Viewer')
  const gone = await device('Gone')
  const lateDir = tmpDir()
  let late = await device('Late', lateDir)

  const { sheetId: oldId } = await call(owner, 'sheet:create', { title: 'Shared costs' })
  await call(owner, 'sheet:setCell', { sheetId: oldId, row: 1, col: 1, input: '100' })
  for (const [who, role] of [[editor, 'editor'], [viewer, 'viewer'], [gone, 'editor'], [late, 'editor']]) {
    const { link } = await call(owner, 'sheet:invite', { sheetId: oldId, role })
    await call(who, 'sheet:join', { link })
    await waitFor(role + ' joined', async () => (await call(who, 'sheet:view', { sheetId: oldId })).myRole === role)
  }
  await waitFor('gone writable', async () => gone.bases.get(oldId).writable)
  await call(gone, 'sheet:setCell', { sheetId: oldId, row: 2, col: 1, input: '=A1*2' })
  await waitFor('owner has the edit', async () => (await grid(owner, oldId))['2,1'] === '=A1*2 -> 200')

  // Late is offline while the owner removes someone.
  await late.close()
  const { sheetId: newId } = await call(owner, 'sheet:removeMember', { sheetId: oldId, identity: hex(gone.identity.publicKey) })
  assert.notEqual(newId, oldId)

  await t.test('the owner has the content in the new sheet', async () => {
    assert.equal((await grid(owner, newId))['2,1'], '=A1*2 -> 200')
    const { members } = await call(owner, 'sheet:members', { sheetId: newId })
    assert.deepEqual(members.map((x) => x.name + '/' + x.role).sort(), ['Editor/editor', 'Late/editor', 'Owner/owner', 'Viewer/viewer'])
  })

  await t.test('an editor follows and can edit the new sheet', async () => {
    await waitFor('editor moved', async () => {
      const s = await call(editor, 'sheet:list', {})
      return s.some((x) => x.sheetId === newId) && !s.some((x) => x.sheetId === oldId)
    })
    await waitFor('editor writable in new', async () => editor.bases.get(newId).writable && (await call(editor, 'sheet:view', { sheetId: newId })).myRole === 'editor')
    await call(editor, 'sheet:setCell', { sheetId: newId, row: 3, col: 1, input: 'after the move' })
    await waitFor('owner sees it', async () => (await grid(owner, newId))['3,1'] === 'after the move')
  })

  await t.test('a viewer follows and reads the new sheet', async () => {
    await waitFor('viewer has new content', async () => (await grid(viewer, newId).catch(() => ({})))['3,1'] === 'after the move')
    assert.equal((await call(viewer, 'sheet:view', { sheetId: newId })).myRole, 'viewer')
  })

  await t.test('the removed person cannot open the new sheet', async () => {
    await waitFor('gone learns it was removed', async () => {
      const v = await call(gone, 'sheet:view', { sheetId: oldId })
      return v.frozen && v.frozen.removed
    })
    assert.equal(gone.bases.get(newId), undefined)
    assert.equal(await gone.localDb.get('groups:joined:' + newId), null)
    const moved = (await gone.bases.get(oldId).view.get('moved')).value
    assert.ok(!(hex(gone.identity.publicKey) in moved.sealed))
    await assert.rejects(call(gone, 'sheet:setCell', { sheetId: oldId, row: 4, col: 1, input: 'x' }), /frozen/)
  })

  await t.test('a member who was offline during the move follows when back', async () => {
    late = await device('Late', lateDir)
    await waitFor('late follows', async () => late.bases.get(newId) && (await call(late, 'sheet:view', { sheetId: newId })).myRole === 'editor' && late.bases.get(newId).writable, { timeout: 40000 })
    assert.equal((await grid(late, newId))['3,1'], 'after the move')
  })

  await t.test('the old sheet is frozen: ops appended after the move are ignored', async () => {
    const countY = async (e) => { let n = 0; for await (const _ of e.bases.get(oldId).view.createReadStream({ gt: 'y/', lt: 'y/~' })) n++; return n }
    const before = await countY(owner)
    // The removed editor is still a writer in the old base and tries anyway.
    await gone.append(oldId, { type: 'y', data: b4a.from([1, 2, 3]).toString('base64') })
    await new Promise((resolve) => setTimeout(resolve, 1500))
    assert.equal(await countY(owner), before)
  })
})
