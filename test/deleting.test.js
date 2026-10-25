// Deleting sheets (proposals/2026-10-04-deleting-sheets.md).

const test = require('node:test')
const assert = require('node:assert/strict')
const b4a = require('b4a')
const Hyperswarm = require('hyperswarm')
const Corestore = require('corestore')
const createTestnet = require('@hyperswarm/testnet')
const { createSheetEngine } = require('../src/worklet/engine')
const { createSeeder } = require('../src/seeder/seeder')
const m = require('../src/worklet/membership')
const { tmpDir, cleanup, waitFor, call } = require('./helpers')

const hex = (buf) => b4a.toString(buf, 'hex')
const DAY = 24 * 3600 * 1000

test('deleting sheets', async (t) => {
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
  const seeder = await createSeeder({ dataDir: tmpDir(), bootstrap: testnet.bootstrap })
  t.after(async () => {
    for (const e of engines) { try { await e.close() } catch {} }
    try { await seeder.close() } catch {}
    await testnet.destroy()
    cleanup()
  })

  const owner = await device('Owner')
  const dirE = tmpDir()
  let editor = await device('Editor', dirE)
  const viewer = await device('Viewer')
  async function share (sheetId) {
    for (const [who, role] of [[editor, 'editor'], [viewer, 'viewer']]) {
      const { link } = await call(owner, 'sheet:invite', { sheetId, role })
      await call(who, 'sheet:join', { link })
      await waitFor(role + ' in', async () => (await call(who, 'sheet:view', { sheetId })).myRole === role && (role === 'viewer' || who.bases.get(sheetId).writable))
    }
  }

  await t.test('removing a sheet from one device frees it there and nowhere else', async () => {
    const { sheetId } = await call(owner, 'sheet:create', { title: 'Scratch' })
    await call(owner, 'sheet:setCell', { sheetId, row: 1, col: 1, input: 'x' })
    await share(sheetId)
    const ownerCore = owner.bases.get(sheetId).local.key
    await call(editor, 'sheet:removeLocal', { sheetId })
    assert.equal(editor.bases.get(sheetId), undefined)
    assert.equal(await editor.localDb.get('groups:joined:' + sheetId), null)
    const copy = editor.store.get({ key: ownerCore })
    await copy.ready()
    assert.equal(await copy.has(0), false, 'the blocks are gone from this device')
    await copy.close()
    // Still gone after a restart; the owner and viewer are unaffected.
    await editor.close()
    editor = await device('Editor', dirE)
    await new Promise((resolve) => setTimeout(resolve, 500))
    assert.equal(editor.bases.get(sheetId), undefined)
    assert.ok(!(await call(editor, 'sheet:list')).some((s) => s.sheetId === sheetId))
    assert.equal((await call(viewer, 'sheet:view', { sheetId })).cells.length, 1)
  })

  await t.test('the owner deletes for everyone; a forged delete is skipped; the seeder drops it later', async () => {
    const { sheetId } = await call(owner, 'sheet:create', { title: 'Budget 2025' })
    await call(owner, 'sheet:setCell', { sheetId, row: 1, col: 1, input: 'secret' })
    const { link } = seeder.openPairing()
    await call(owner, 'seeder:pair', { link })
    await share(sheetId)
    const bootstrap = hex(owner.bases.get(sheetId).key)
    await waitFor('seeder holds it', async () => seeder.allowedSheets().includes(bootstrap))

    // An editor cannot delete: the op is not signed by the owner.
    const forged = m.deleteOp({ sheetId, owner: editor.identity })
    await editor.append(sheetId, forged)
    await new Promise((resolve) => setTimeout(resolve, 800))
    assert.ok(viewer.bases.get(sheetId), 'still there after a forged delete')

    await call(owner, 'sheet:deleteForEveryone', { sheetId })
    const still = () => Object.entries({ owner, editor, viewer }).filter(([, e]) => e.bases.get(sheetId)).map(([n]) => n)
    await waitFor('editor and viewer removed it', async () => !still().length).catch((err) => { throw new Error(err.message + ' (still on: ' + still().join(', ') + ')') })
    assert.ok(await viewer.localDb.get('deleted:' + sheetId), 'the viewer knows it was deleted by the owner')

    // The seeder scheduled the drop about a week out, and runs it when due.
    await waitFor('drop scheduled', async () => (await seeder.drops()).some((d) => d.sheet === bootstrap))
    const { due } = (await seeder.drops()).find((d) => d.sheet === bootstrap)
    assert.ok(due > Date.now() + 6 * DAY && due < Date.now() + 8 * DAY)
    assert.equal(await seeder.runDrops(Date.now()), 0)
    assert.ok(seeder.allowedSheets().includes(bootstrap), 'kept during the grace period')
    const dropped = await seeder.runDrops(Date.now() + 8 * DAY)
    assert.equal(dropped, 1)
    assert.ok(!seeder.allowedSheets().includes(bootstrap))
  })

  await t.test('after a key move the old copy is dropped from the seeder and removed here a week later', async () => {
    const { sheetId: oldId } = await call(owner, 'sheet:create', { title: 'Shared costs' })
    await call(owner, 'sheet:setCell', { sheetId: oldId, row: 1, col: 1, input: '1' })
    await share(oldId)
    const oldBootstrap = hex(owner.bases.get(oldId).key)
    await waitFor('seeder holds it', async () => seeder.allowedSheets().includes(oldBootstrap))
    await call(owner, 'sheet:removeMember', { sheetId: oldId, identity: hex(viewer.identity.publicKey) })
    await waitFor('old copy drop scheduled', async () => (await seeder.drops()).some((d) => d.sheet === oldBootstrap))
    // A week on, the frozen old copy leaves this device too.
    const rec = (await owner.localDb.get('moves:' + oldId)).value
    await owner.localDb.put('moves:' + oldId, { ...rec, at: Date.now() - 8 * DAY })
    await owner.deleting.resume()
    assert.equal(owner.bases.get(oldId), undefined)
  })

  await t.test('the seeder refuses drops from devices it is not paired with', async () => {
    const { sheetId } = await call(owner, 'sheet:create', { title: 'Kept' })
    await call(owner, 'sheet:setCell', { sheetId, row: 1, col: 1, input: 'k' })
    const bootstrap = hex(owner.bases.get(sheetId).key)
    await waitFor('seeder holds it', async () => seeder.allowedSheets().includes(bootstrap))
    // The viewer claims a pairing the seeder never made.
    await viewer.localDb.put('seeders:' + hex(seeder.seederKey), { seederKey: hex(seeder.seederKey) })
    const results = await viewer.seeding.requestDrop({ bootstrap, seederKeys: [hex(seeder.seederKey)], afterMs: 0 })
    assert.match(results[0].error, /Only paired devices/)
    assert.ok(seeder.allowedSheets().includes(bootstrap))
  })

  await t.test('the seeder refuses drops from a paired device that does not back the file up', async () => {
    const { sheetId } = await call(owner, 'sheet:create', { title: 'Theirs' })
    await call(owner, 'sheet:setCell', { sheetId, row: 1, col: 1, input: 't' })
    const bootstrap = hex(owner.bases.get(sheetId).key)
    await waitFor('seeder holds it', async () => seeder.allowedSheets().includes(bootstrap))
    // Someone else pairs with the same seeder and learns the file's key.
    const other = await device('Other')
    await call(other, 'seeder:pair', { link: seeder.openPairing().link })
    const results = await other.seeding.requestDrop({ bootstrap, seederKeys: [hex(seeder.seederKey)], afterMs: 0 })
    assert.match(results[0].error, /does not back that up here/)
    assert.ok(seeder.allowedSheets().includes(bootstrap))
    assert.equal((await seeder.drops()).some((d) => d.sheet === bootstrap), false)
  })
})

test('a linked device not yet admitted cannot delete for everyone', async () => {
  const { createDeleting } = require('../src/worklet/deleting')
  const identity = { publicKey: b4a.alloc(32, 1) }
  const view = { get: async (key) => key === 'sheet' ? { value: { owner: hex(identity.publicKey) } } : null }
  let appended = false
  const engine = { identity, bases: new Map([['s1', { writable: false, view }]]), append: async () => { appended = true } }
  const deleting = createDeleting({ engine, sheets: {}, getSeeding: () => null, emit: () => {} })
  await assert.rejects(deleting.deleteForEveryone('s1'), /still getting edit access/)
  assert.equal(appended, false)
})
